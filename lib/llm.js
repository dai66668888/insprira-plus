// OpenAI 兼容 chat.completions 调用 + JSON 解析容错
// make(toolFunctions) 工厂注入工具分发，避免硬耦合业务函数
//
// v2 改造（对应 docs/optimization-plan.md Phase 1）：
// 1. 非工具路径走 SSE 流式（lib/llm-stream.js 聚合），三级超时替代"整包生成完才返回"的硬超时，
//    根治 GLM 思考型模型长文创作超时（token 已消耗但拿不到文章）问题；
// 2. 失败自动重试 + 指数退避（err.status 参与判定），带工具路径同样接入 fallback；
// 3. LLM_THINKING / LLM_MAX_TOKENS / LLM_MAX_CONCURRENCY 等配置化；
// 4. 全局并发闸（信号量）保护手动创作与 cron 任务不互相踩踏；
// 5. 每次调用记录 llm_usage 表，支持每日预算熔断。
const { db } = require('./db');
const {
  createStreamState, feedSse, flushSse, toStreamMessage, takeDelta,
} = require('./llm-stream');

const WEB_SEARCH_TOOL = [{
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Use Doubao WebSearch to look up latest information. Call this whenever you need current data, product features, news, user reviews, or anything the LLM training data may not cover or that may be outdated.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords; be specific (e.g. product name + feature)' },
      },
      required: ['query'],
    },
  },
}];

// 有效正文判定：剥掉 <think> 思考块后是否还有实际内容
// （GLM 等思考型模型可能把全部输出放在 <think> 块里、正文一个字没写，或思考占满 token 预算）
function meaningfulContent(content) {
  return String(content || '')
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    .trim();
}

// 模型常把真实换行直接写进 JSON 字符串（规范要求写成 \n 两个字符），JSON.parse 会报
// "Bad control character in string literal" 并把整篇已生成的内容作废。这里用状态机只在
// 「字符串字面量内部」把裸控制字符（\n \r \t 及其他 < 0x20）转义为合法序列；已转义的
// 字面量（\n、\\、\" 等）原样保留，字符串外的换行等空白不动。单次遍历，长文开销可忽略。
function controlCharEscape(ch) {
  switch (ch) {
    case '\n': return '\\n';
    case '\r': return '\\r';
    case '\t': return '\\t';
    case '\b': return '\\b';
    case '\f': return '\\f';
    default: return '\\u' + ch.codePointAt(0).toString(16).padStart(4, '0');
  }
}

function escapeControlCharsInStrings(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of String(text || '')) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      // 反斜杠后跟裸控制字符是非法转义（如行尾的 "\<换行>"）：丢掉孤立反斜杠、按控制字符修复
      out += ch.codePointAt(0) < 0x20 ? controlCharEscape(ch) : '\\' + ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { out += ch; inString = false; continue; }
    out += ch.codePointAt(0) < 0x20 ? controlCharEscape(ch) : ch;
  }
  // 文本以孤立反斜杠结尾时原样补回（保持原串长度语义，交给上层报截断错误）
  if (escaped) out += '\\';
  return out;
}

function parseLlmJson(content) {
  let cleaned = String(content || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    .replace(/<think>[\s\S]*?<think>/gi, '')
    .trim();
  // 容忍围栏/说明文字/零宽字符等杂质：从首个 JSON 起始符截取，并去掉尾部残留围栏
  const start = cleaned.search(/[[{]/);
  if (start > 0) cleaned = cleaned.slice(start);
  cleaned = cleaned.replace(/```\s*$/, '').trim();
  if (!cleaned) {
    // 空内容单独报错：此前报"JSON 解析失败: Unexpected end"误导排查方向
    throw new Error('LLM 返回内容为空（可能思考占满 token 预算、正文被安全策略过滤，或仅输出思考块）；建议配置 LLM_THINKING=disabled 或提高 LLM_MAX_TOKENS');
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // 裸控制字符（模型把真实换行写进字符串）先转义再解析：对合法 JSON 是恒等变换，
    // 所以失败路径统一在转义后的文本上继续做截断修复。
    const repaired = escapeControlCharsInStrings(cleaned);
    try {
      const r = JSON.parse(repaired);
      const pos = (err.message.match(/position (\d+)/) || [])[1] || '?';
      console.warn('[parseLlmJson] 裸控制字符修复成功 pos=' + pos);
      return r;
    } catch (err2) {
      if (err2.message.includes('Unterminated') || err2.message.includes('Unexpected end')) {
        for (let i = repaired.length - 1; i >= 0; i--) {
          if (repaired[i] === '}') {
            try {
              const r = JSON.parse(repaired.slice(0, i + 1));
              console.warn('[parseLlmJson] JSON 截断修复 pos=' + i);
              return r;
            } catch {}
          }
        }
      }
      throw new Error('JSON 解析失败: ' + err2.message + ' | 内容片段: ' + cleaned.slice(0, 200));
    }
  }
}

// ============ 错误分类 ============
// 视为可重试的 HTTP 状态码（429 限流 / 5xx 服务端异常 / 408 请求超时 / 529 容量饱和等）
const RETRIABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

function makeLlmError(message, extra = {}) {
  const err = new Error(message);
  err.isLlmError = true;
  Object.assign(err, extra);
  return err;
}

// 可重试判定：客户端取消 > 超时/中止 > err.status（此前只看 message 正则，中文报错匹配不上导致不重试）
function isRetriableError(err) {
  if (!err) return false;
  // 客户端主动取消（P1-1 流式取消/切页）：不重试、不切备用模型，也不写 llm_usage
  if (err.isClientAbort) return false;
  if (err.isLlmTimeout || err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const status = Number(err.status);
  if (Number.isInteger(status) && RETRIABLE_STATUS.has(status)) return true;
  return /network|ECONN|fetch failed|socket hang up|connection (reset|closed)|429|rate|rate limit|超时|限流|访问量过大|请稍后再试|过载|繁忙|capacity/i
    .test(String(err.message || ''));
}

// 是否值得切备用模型：可重试类错误，或模型相关错误（404 模型不存在等）；
// 400/401/403 属于请求本身或鉴权问题，换模型也没用，不浪费 fallback 调用
function shouldTryFallback(err) {
  if (err?.isClientAbort) return false;
  if (isRetriableError(err)) return true;
  const status = Number(err?.status);
  return Number.isInteger(status) && status >= 400 && ![400, 401, 403].includes(status);
}

// P1-1：把新增的 content/reasoning 片段回调给上层（SSE 路由据此实时推给前端）。
// 未传 onDelta 时零开销（直接返回原游标）；回调内部异常不影响本次生成。
function emitStreamDelta(options, state, cursor) {
  if (typeof options.onDelta !== 'function') return cursor;
  const { delta, cursor: next } = takeDelta(state, cursor);
  if (delta.content || delta.reasoning) {
    try { options.onDelta(delta); } catch { /* 回调异常不影响本次生成 */ }
  }
  return next;
}

// ============ 全局并发闸 ============
// 动态读取 LLM_MAX_CONCURRENCY（支持 .env 热加载）；超出并发的调用排队等待
function makeSemaphore(getLimit) {
  let active = 0;
  const waiters = [];
  function tryWake() {
    while (active < getLimit() && waiters.length) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      active += 1;
      waiter.resolve();
    }
  }
  return {
    stats: () => ({ active, queued: waiters.length, limit: getLimit() }),
    acquire(queueTimeoutMs) {
      if (active < getLimit()) {
        active += 1;
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const idx = waiters.indexOf(waiter);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(makeLlmError(`模型并发已满，排队 ${Math.round(queueTimeoutMs / 1000)}s 后超时，请稍后重试`, { status: 429 }));
        }, queueTimeoutMs);
        waiters.push(waiter);
      });
    },
    release() {
      active = Math.max(0, active - 1);
      tryWake();
    },
  };
}

// ============ 用量记录与预算（llm_usage 表，见 lib/db.js） ============
function todayStartMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function logLlmUsage(model, statusCode, usage = null) {
  try {
    db.prepare(`
      INSERT INTO llm_usage (model, status_code, prompt_tokens, completion_tokens, total_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      String(model || ''),
      Number(statusCode) || 0,
      Number(usage?.prompt_tokens) || null,
      Number(usage?.completion_tokens) || null,
      Number(usage?.total_tokens) || null,
      Date.now(),
    );
  } catch { /* 用量记录失败不影响主流程 */ }
}

function checkLlmBudget() {
  const limit = Number(process.env.LLM_DAILY_CALL_LIMIT) || 0;
  if (limit <= 0) return;
  let used = 0;
  try {
    used = db.prepare('SELECT COUNT(*) AS n FROM llm_usage WHERE created_at >= ?').get(todayStartMs()).n;
  } catch { /* 表缺失等异常视为未超限 */ }
  if (used >= limit) {
    throw makeLlmError(
      `今日 LLM 调用已达上限（${used}/${limit} 次），明日自动恢复；可在 .env 调整 LLM_DAILY_CALL_LIMIT`,
      { status: 429 },
    );
  }
}

function make(toolFunctions = {}) {
  const semaphore = makeSemaphore(() => Math.max(1, Number(process.env.LLM_MAX_CONCURRENCY) || 2));

  async function callLlm(messages, options = {}) {
    const apiKey = process.env.LLM_API_KEY;
    const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const primaryModel = process.env.LLM_MODEL || 'gpt-4.1-mini';
    const fallbackModel = process.env.LLM_FALLBACK_MODEL || '';
    if (!apiKey) throw new Error('未配置 LLM_API_KEY');
    const tools = Array.isArray(options.tools) && options.tools.length ? options.tools : null;
    const maxToolRounds = options.maxToolRounds ?? 3;

    // 流式三级超时（毫秒）：首包覆盖 GLM 深度思考慢启动；chunk 间隔兜底生成中断
    const firstTokenTimeoutMs = Number(options.firstTokenTimeoutMs ?? process.env.LLM_FIRST_TOKEN_TIMEOUT_MS) || 90000;
    const idleTimeoutMs = Number(options.idleTimeoutMs ?? process.env.LLM_IDLE_TIMEOUT_MS) || 45000;
    // 单次尝试总时长：兼容旧 options.timeoutMs 传参
    const totalTimeoutMs = Number(options.totalTimeoutMs ?? options.timeoutMs ?? process.env.LLM_TOTAL_TIMEOUT_MS) || 300000;
    // 重试次数：默认非流式 2 次、带工具 1 次（工具链单轮更慢，避免成倍拉长总时长）
    const retriesOpt = Number(options.retries ?? process.env.LLM_RETRIES);
    const retries = Number.isFinite(retriesOpt) && retriesOpt >= 0 ? retriesOpt : (tools ? 1 : 2);
    const maxTokens = options.maxTokens ?? (Number(process.env.LLM_MAX_TOKENS) || 4096);
    const queueTimeoutMs = Number(process.env.LLM_QUEUE_TIMEOUT_MS) || 120000;
    // 思考开关：LLM_THINKING=disabled|enabled 时下发 thinking 参数（GLM 等思考型模型），
    // 留空不下发，兼容不支持该参数的 OpenAI 兼容服务
    const thinking = String(process.env.LLM_THINKING || '').trim().toLowerCase();

    // 预算检查放在排队前：超限时快速失败，不占用并发名额
    checkLlmBudget();

    await semaphore.acquire(queueTimeoutMs);
    try {
      return await runCall();
    } finally {
      semaphore.release();
    }

    // ---- 单次 HTTP 尝试 ----
    async function doCall(modelName, { attemptMessages, useStream, timeoutCapMs, attemptMaxTokens }) {
      const body = {
        model: modelName,
        messages: attemptMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: attemptMaxTokens,
      };
      if (tools) {
        body.tools = tools;
        body.tool_choice = options.toolChoice || 'auto';
      } else if (options.json) {
        body.response_format = { type: 'json_object' };
      }
      if (thinking === 'disabled' || thinking === 'enabled') {
        body.thinking = { type: thinking };
      }

      // 流式：自管 controller 实现首包/空闲细粒度中断；非流式：直接总时长硬超时
      const controller = new AbortController();
      let timeoutLabel = null;
      let firstTimer = null;
      let idleTimer = null;
      let clientAborted = false;
      // 外部 signal（P1-1：SSE 路由在客户端断连时 abort）：转成「取消」语义中断上游，
      // 与超时区分开 —— 取消不重试、不切备用模型，也不会写 llm_usage（F3 的口径）
      const onExternalAbort = () => {
        clientAborted = true;
        timeoutLabel = null;
        try { controller.abort(); } catch {}
      };
      if (options.signal) {
        if (options.signal.aborted) onExternalAbort();
        else options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
      const totalTimer = setTimeout(() => {
        timeoutLabel = `总时长超时（>${Math.round(timeoutCapMs / 1000)}s）`;
        try { controller.abort(); } catch {}
      }, timeoutCapMs);
      // 统一收尾：清三个计时器 + 摘掉外部 signal 监听（多条早退路径都走它，避免漏清）
      const finish = () => {
        clearTimeout(totalTimer);
        if (firstTimer) clearTimeout(firstTimer);
        if (idleTimer) clearTimeout(idleTimer);
        if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
      };
      if (useStream) {
        firstTimer = setTimeout(() => {
          timeoutLabel = `首包超时（>${Math.round(firstTokenTimeoutMs / 1000)}s，模型思考或连接过慢）`;
          try { controller.abort(); } catch {}
        }, firstTokenTimeoutMs);
      }

      let response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        finish();
        if (clientAborted) throw makeLlmError('已取消生成', { status: 499, isClientAbort: true });
        if (timeoutLabel) throw makeLlmError(`LLM ${timeoutLabel}: ${modelName}`, { isLlmTimeout: true });
        throw err;
      }

      if (!response.ok) {
        finish();
        const payload = await response.json().catch(() => null);
        const errMsg = payload?.error?.message || payload?.message || `LLM HTTP ${response.status}`;
        const err = makeLlmError(errMsg, { status: response.status });
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
        throw err;
      }

      if (!useStream) {
        try {
          const payload = await response.json();
          finish();
          const message = payload.choices?.[0]?.message || {};
          // 非流式（带工具路径或流式降级）同样兜底空内容；工具路径可能只返回 tool_calls，放行
          if (!tools && !message.tool_calls?.length && !meaningfulContent(message.content)) {
            throw makeLlmError('LLM 未返回有效正文（content 为空或仅为思考块）', { status: 502 });
          }
          return { message, usage: payload.usage || null };
        } catch (err) {
          finish();
          if (clientAborted) throw makeLlmError('已取消生成', { status: 499, isClientAbort: true });
          throw err;
        }
      }

      // ---- 流式读取与聚合 ----
      const contentType = String(response.headers?.get?.('content-type') || '');
      if (!contentType.includes('text/event-stream')) {
        // 服务端/网关不支持流式（忽略 stream 参数返回整包 JSON）：按非流式解析
        finish();
        const payload = await response.json();
        const message = payload.choices?.[0]?.message || {};
        if (!tools && !message.tool_calls?.length && !meaningfulContent(message.content)) {
          throw makeLlmError('LLM 未返回有效正文（content 为空或仅为思考块）', { status: 502 });
        }
        return { message, usage: payload.usage || null };
      }
      const state = createStreamState();
      const decoder = new TextDecoder();
      let cursor = { content: 0, reasoning: 0 }; // P1-1 增量游标
      try {
        for await (const chunk of response.body) {
          const text = decoder.decode(chunk, { stream: true });
          if (text) {
            if (firstTimer) {
              // 首包到达：切换到"chunk 间隔"计时
              clearTimeout(firstTimer);
              firstTimer = null;
              idleTimer = setTimeout(() => {
                timeoutLabel = `生成中断超时（chunk 间隔 >${Math.round(idleTimeoutMs / 1000)}s）`;
                try { controller.abort(); } catch {}
              }, idleTimeoutMs);
            } else if (idleTimer) {
              clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                timeoutLabel = `生成中断超时（chunk 间隔 >${Math.round(idleTimeoutMs / 1000)}s）`;
                try { controller.abort(); } catch {}
              }, idleTimeoutMs);
            }
          }
          feedSse(state, text);
          cursor = emitStreamDelta(options, state, cursor);
          if (state.done) break;
        }
        // 冲刷 TextDecoder 中可能残留的多字节字符尾部，再冲刷 SSE 未换行的最后一行
        const tail = decoder.decode();
        if (tail) { feedSse(state, tail); cursor = emitStreamDelta(options, state, cursor); }
        flushSse(state);
        emitStreamDelta(options, state, cursor);
      } catch (err) {
        if (timeoutLabel) throw makeLlmError(`LLM ${timeoutLabel}: ${modelName}`, { isLlmTimeout: true });
        if (clientAborted) throw makeLlmError('已取消生成', { status: 499, isClientAbort: true });
        throw err;
      } finally {
        finish();
      }
      const message = toStreamMessage(state);
      if (!message.tool_calls?.length && !meaningfulContent(message.content)) {
        // content 字面非空但剥掉思考块后为空（思考占满预算/被过滤），与真正空内容同样处理
        const thinkOnly = Boolean(message.content) && !state.reasoning;
        const hint = state.reasoning
          ? `（模型仅输出思考过程未给正文，思考片段：${state.reasoning.slice(0, 120)}…）`
          : thinkOnly
            ? `（content 仅为思考块：${String(message.content).slice(0, 120)}…）`
            : '';
        if (state.finishReason === 'length') {
          // length 多为确定性失败（思考吃满预算），快速失败并给出配置指引；400 不重试
          throw makeLlmError(
            `生成被 max_tokens 上限截断且无有效正文${hint}；建议配置 LLM_THINKING=disabled 或提高 LLM_MAX_TOKENS`,
            { status: 400 },
          );
        }
        // 其余情况可能是偶发，502 参与重试
        throw makeLlmError(`LLM 未返回有效正文（可能被安全策略过滤或仅有思考过程）${hint}`, { status: 502 });
      }
      return { message, usage: state.usage || null };
    }

    // ---- 带重试/退避的调用封装 ----
    // 服务端明确不支持流式（HTTP 400 + 报错含 stream）时立刻降级非流式，不计入退避次数
    async function attemptCall(modelName, attemptMessages, preferStream, attemptMaxTokens) {
      let useStream = preferStream;
      let lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        // P1-1：每次尝试开始前通知上层。前端据此清空上一轮的流式缓冲，
        // 避免"第 1 次流到一半失败、重试又从头流"时文本被拼接错乱。
        if (typeof options.onAttempt === 'function') {
          try { options.onAttempt({ attempt, model: modelName }); } catch { /* 回调异常不影响调用 */ }
        }
        try {
          const result = await doCall(modelName, {
            attemptMessages,
            useStream,
            timeoutCapMs: useStream
              ? totalTimeoutMs
              : (tools ? (options.timeoutMs ?? 100000) : totalTimeoutMs),
            attemptMaxTokens,
          });
          logLlmUsage(modelName, 200, result.usage);
          return result.message;
        } catch (err) {
          lastErr = err;
          // 服务端不支持流式：立刻降级为非流式重试（不计入退避）
          if (useStream && Number(err.status) === 400 && /stream/i.test(String(err.message || ''))) {
            console.warn(`[callLlm] ${modelName} 不支持流式（${err.message}），降级为非流式`);
            useStream = false;
            continue;
          }
          if (attempt >= retries || !isRetriableError(err)) break;
          const delay = err.retryAfterMs
            || Math.min(8000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
          console.warn(`[callLlm] ${modelName} 第 ${attempt + 1} 次调用失败，${Math.round(delay / 1000)}s 后重试：${err.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      throw lastErr;
    }

    async function runCall() {
      // 非工具路径：流式 + 重试，失败按规则切备用模型
      if (!tools) {
        try {
          const msg = await attemptCall(primaryModel, messages, true, maxTokens);
          return msg.content || '';
        } catch (primaryErr) {
          if (!fallbackModel || fallbackModel === primaryModel || !shouldTryFallback(primaryErr)) throw primaryErr;
          console.warn(`[callLlm] 主模型失败切 fallback: ${primaryModel} -> ${fallbackModel}: ${primaryErr.message}`);
          const msg = await attemptCall(fallbackModel, messages, true, maxTokens);
          return msg.content || '';
        }
      }

      // 工具路径（联网创作等）：非流式 + 重试 + fallback；工具执行逻辑与 v1 保持一致
      const currentMessages = [...messages];
      for (let round = 0; round <= maxToolRounds; round++) {
        let msg;
        try {
          msg = await attemptCall(primaryModel, currentMessages, false, maxTokens);
        } catch (err) {
          if (fallbackModel && fallbackModel !== primaryModel && shouldTryFallback(err)) {
            console.warn(`[callLlm] tool round 失败切 fallback round=${round} model=${primaryModel} -> ${fallbackModel}: ${err.message}`);
            msg = await attemptCall(fallbackModel, currentMessages, false, maxTokens);
          } else {
            console.warn(`[callLlm] tool round 失败 round=${round} model=${primaryModel}: ${err.message}`);
            throw err;
          }
        }
        const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        if (!toolCalls.length) {
          return msg.content || '';
        }
        currentMessages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function?.name, arguments: tc.function?.arguments },
          })),
        });
        for (const tc of toolCalls) {
          const fnName = tc.function?.name;
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
          const handler = toolFunctions[fnName];
          let result;
          if (!handler) {
            result = JSON.stringify({ error: `未知工具 ${fnName}` });
          } else {
            try { result = await handler(args); } catch (e) { result = JSON.stringify({ error: e.message }); }
          }
          currentMessages.push({ role: 'tool', tool_call_id: tc.id, name: fnName, content: result });
        }
      }
      throw new Error('工具调用轮次超限');
    }
  }

  async function callLlmJson(messages, options = {}) {
    const callOptions = { ...options, json: true };
    if (callOptions.tools) delete callOptions.json;
    const content = await callLlm(messages, callOptions);
    return parseLlmJson(content);
  }

  return { callLlm, callLlmJson, stats: () => semaphore.stats() };
}

module.exports = { make, parseLlmJson, WEB_SEARCH_TOOL };
