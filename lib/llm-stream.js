// SSE 流式响应解析/聚合（纯函数，供 lib/llm.js 流式调用与单测使用）
// 兼容 OpenAI 兼容接口（含智谱 GLM）的 chat.completions 流式格式：
//   data: {"choices":[{"delta":{"content":"...","reasoning_content":"...","tool_calls":[...]}}]}
//   data: [DONE]
// 容忍：注释/心跳行（`: keep-alive`）、空行、非 JSON 的 data 行、CRLF、跨 chunk 截断的行。

// 创建一个聚合状态；_buf 保存跨 chunk 的不完整行缓冲
function createStreamState() {
  return {
    content: '',        // 最终回答文本（delta.content 累积）
    reasoning: '',      // 思考过程文本（delta.reasoning_content 累积，GLM/DeepSeek 等思考型模型）
    toolCalls: [],      // 按 index 拼接的工具调用
    finishReason: null, // 最后一次出现的 finish_reason
    usage: null,        // 部分服务在最后一个 chunk 携带的 usage 统计
    done: false,        // 是否收到 [DONE]
    _buf: '',
  };
}

// 处理一行完整的 SSE 文本；无法识别的行静默忽略（流式容错优先，不让单行脏数据毁掉整次生成）
function absorbSseLine(state, rawLine) {
  const line = String(rawLine || '').replace(/\r$/, '').trim();
  if (!line || line.startsWith(':')) return state;
  if (!line.startsWith('data:')) return state;
  const payload = line.slice(5).trim();
  if (!payload) return state;
  if (payload === '[DONE]') {
    state.done = true;
    return state;
  }
  let json;
  try { json = JSON.parse(payload); } catch { return state; }
  // 部分（非标准）实现把 usage 放在事件对象顶层
  if (json.usage && typeof json.usage === 'object') state.usage = json.usage;
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  if (!choice) return state;
  const delta = choice.delta || choice.message || {};
  if (typeof delta.content === 'string' && delta.content) state.content += delta.content;
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) state.reasoning += delta.reasoning_content;
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const idx = Number.isInteger(tc?.index) ? tc.index : state.toolCalls.length;
      if (!state.toolCalls[idx]) {
        state.toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
      }
      const slot = state.toolCalls[idx];
      if (typeof tc?.id === 'string' && tc.id) slot.id = tc.id;
      if (typeof tc?.type === 'string' && tc.type) slot.type = tc.type;
      if (typeof tc?.function?.name === 'string' && tc.function.name) slot.function.name += tc.function.name;
      if (typeof tc?.function?.arguments === 'string' && tc.function.arguments) slot.function.arguments += tc.function.arguments;
    }
  }
  if (choice.finish_reason) state.finishReason = choice.finish_reason;
  return state;
}

// 喂入一段原始文本（可能包含多行或不完整行），自动缓冲截断的行
function feedSse(state, text) {
  if (!text) return state;
  state._buf += String(text);
  let nl;
  while ((nl = state._buf.indexOf('\n')) >= 0) {
    const line = state._buf.slice(0, nl);
    state._buf = state._buf.slice(nl + 1);
    absorbSseLine(state, line);
  }
  return state;
}

// 流结束时冲刷残留缓冲（部分实现最后一个事件不带换行）
function flushSse(state) {
  if (state._buf) {
    const rest = state._buf;
    state._buf = '';
    absorbSseLine(state, rest);
  }
  return state;
}

// 把聚合结果转成与非流式 response.choices[0].message 对齐的结构
function toStreamMessage(state) {
  const message = { role: 'assistant', content: state.content };
  const toolCalls = state.toolCalls.filter(Boolean);
  if (toolCalls.length) {
    message.tool_calls = toolCalls.map(tc => ({
      id: tc.id,
      type: tc.type || 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
  }
  return message;
}

// 增量游标：切出「本次之后新增的 content/reasoning」（P1-1 流式透传用）。
// cursor 只记长度，不复制全量文本 —— 长文逐 chunk 回调不会变成 O(n²)。
// 返回 { delta, cursor }，cursor 可贯穿多次调用（第一次传 createStreamState() 的初始游标即可）。
function takeDelta(state, cursor = { content: 0, reasoning: 0 }) {
  return {
    delta: {
      content: state.content.slice(cursor.content || 0),
      reasoning: state.reasoning.slice(cursor.reasoning || 0),
    },
    cursor: { content: state.content.length, reasoning: state.reasoning.length },
  };
}

module.exports = { createStreamState, absorbSseLine, feedSse, flushSse, toStreamMessage, takeDelta };
