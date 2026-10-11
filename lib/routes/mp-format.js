// 路由组：公众号排版助手（方案 §5.3 / PR-2）
// POST /api/_/mp-format/ai-layout —— AI 一键排版：只调结构不改内容的 Markdown 优化
// GET/PUT /api/_/mp-format/draft —— 排版页服务端草稿（P0-4）：localStorage 丢失时的兜底
// 依赖通过 ctx 注入：llm（lib/llm 的 make() 实例）
// SYSTEM_PROMPT 与输入上限（15000 字符）移植自 mspringjade/wechat-formatter（AGPL-3.0）
// 的 app/api/ai-format/route.ts，追加 insprira 约束（图片 URL 保持不变）。
// 注意：LLM 失败统一映射为 502，不占用 401 —— 前端 localApi 把 401 当登录过期处理。
const { json, readBody } = require('../http');
const { getLocalData, setLocalData } = require('../local-data');
const { classifyMpError } = require('../mp-errors');
const { sanitizeMpConfig } = require('../mp-publisher');

const MAX_INPUT_LENGTH = 15000;
// 草稿上限单独放宽：草稿要存完整成稿（可能远大于 AI 排版的输入上限）。
// 上限内仍远小于 lib/http.js 的 MAX_BODY_SIZE(2MB)，不会撞请求体上限。
const MAX_DRAFT_LENGTH = 200000;
const DRAFT_MODULE = 'format-draft';
const DRAFT_KEY = 'default';
const DRAFT_TITLE_MAX = 200;

const SYSTEM_PROMPT = `你是一个微信公众号 Markdown 排版专家。你的任务是优化用户提供的 Markdown 文本的**排版结构**，使其更适合微信公众号阅读体验。

## 你必须遵守的规则

1. **绝不改写原文内容**：不修改任何句子的语义、不增减事实、不润色措辞。
2. **绝不删除任何内容**：所有原文段落、图片、链接、代码块、表格都必须完整保留。
3. **只调整排版结构**，具体包括：
   - 修正标题层级（确保 h1 → h2 → h3 逐级递进，不跳级）
   - 在段落之间补充合理的空行
   - 将松散的列举内容整理为有序/无序列表
   - 为关键词或核心观点添加 **加粗** 标记
   - 适当使用 > 引用来突出金句或重要提示
   - 在内容分界处添加 --- 分隔线
4. **保持原有的 Markdown 语法**：图片 ![alt](url)、链接 [text](url)、代码块 \`\`\`lang ... \`\`\`、表格等原样保留。
5. **只输出最终的 Markdown 文本**，不要输出解释、注释或任何多余内容。不要用代码块包裹整个输出。
6. **保持原文图片链接不变**：所有图片的 URL 与数量必须与原文完全一致（后续同步公众号草稿箱时依赖这些 URL 做图片转存，改动会导致图片丢失）。`;

// 模型偶尔无视「不要用代码块包裹整个输出」：剥掉整体包裹围栏。
// 仅限空语言 / markdown 系语言的围栏，避免误伤「正文恰好是一个代码块」的文章。
function cleanAiMarkdown(raw) {
  let text = String(raw ?? '').trim();
  const wrapped = /^```(markdown|md|mdx)?\s*\n([\s\S]*?)\n?```$/.exec(text);
  if (wrapped) text = wrapped[2].trim();
  return text;
}

// 复用 llm.js 错误语义映射为用户可读文案（思路对齐上游 route.ts 的状态码映射）
function mapLlmError(e) {
  const msg = String((e && e.message) || e || '');
  if (/未配置 LLM_API_KEY/.test(msg)) return '尚未配置 LLM 服务，请到「设置」页填写 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL';
  if (/auth|api key|unauthorized|401/i.test(msg)) return 'LLM API Key 无效或无权限，请检查设置页的 LLM 配置';
  if (/model|not found|404/i.test(msg)) return 'LLM 模型不可用，请检查模型名称是否正确';
  if (/quota|credit|billing|insufficient|payment|429/i.test(msg)) return 'LLM 额度不足或请求过于频繁，请检查服务商账户状态';
  if (/超时|timeout/i.test(msg)) return 'AI 排版超时，请稍后重试或精简内容后再试';
  return msg || 'AI 排版服务异常，请稍后重试';
}

async function tryRoute(req, res, url, ctx) {
  const { llm, logAction, mpPublisher } = ctx;

  if (url.pathname === '/api/_/mp-format/ai-layout' && req.method === 'POST') {
    let data = {};
    try { ({ data } = await readBody(req)); } catch { data = {}; }
    const markdown = typeof data.markdown === 'string' ? data.markdown : '';

    if (!markdown.trim()) {
      json(res, 400, { ok: false, error: '请提供需要排版的 Markdown 内容' });
      return true;
    }
    if (markdown.length > MAX_INPUT_LENGTH) {
      json(res, 400, { ok: false, error: `内容过长（${markdown.length} 字符），请控制在 ${MAX_INPUT_LENGTH} 字符以内` });
      return true;
    }

    try {
      const raw = await llm.callLlm(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: markdown },
        ],
        { temperature: 0.3 }, // 上游同参数：低温保证「只调结构不改内容」
      );
      const cleaned = cleanAiMarkdown(raw);
      if (!cleaned) {
        json(res, 502, { ok: false, error: 'AI 返回了空内容，请重试' });
        return true;
      }
      // 成本归因（P0-5）：AI 排版是第二个最贵的调用，进审计并计 1 次 LLM
      if (typeof logAction === 'function') {
        logAction('mp-format-ai-layout', 'button', 'llm', { length: markdown.length }, 0, 1);
      }
      json(res, 200, { ok: true, data: { markdown: cleaned } });
    } catch (e) {
      json(res, 502, { ok: false, error: mapLlmError(e) });
    }
    return true;
  }

  // ============= 服务端草稿（P0-4） =============
  // GET 回读（无草稿时 data = null）；PUT 覆写。落 local_data 表：
  // module='format-draft', data_key='default'（D2 的验收 SQL 口径）。
  if (url.pathname === '/api/_/mp-format/draft') {
    if (req.method === 'GET') {
      json(res, 200, { ok: true, data: getLocalData(DRAFT_MODULE, DRAFT_KEY) });
      return true;
    }
    if (req.method === 'PUT') {
      let data = {};
      try { ({ data } = await readBody(req)); } catch { data = {}; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        json(res, 400, { ok: false, error: '草稿格式不正确：需要 { title, markdown } 对象' });
        return true;
      }
      if (typeof data.markdown !== 'string') {
        json(res, 400, { ok: false, error: '请提供 markdown 字符串（草稿正文）' });
        return true;
      }
      if (data.markdown.length > MAX_DRAFT_LENGTH) {
        json(res, 400, { ok: false, error: `草稿过长（${data.markdown.length} 字符），请控制在 ${MAX_DRAFT_LENGTH} 字符以内` });
        return true;
      }
      const title = typeof data.title === 'string' ? data.title.slice(0, DRAFT_TITLE_MAX) : '';
      const updatedAt = Date.now();
      setLocalData(DRAFT_MODULE, DRAFT_KEY, { title, markdown: data.markdown, updatedAt });
      // 不回吐完整正文（可能上百 KB），只回执元信息；需要正文时用 GET 回读
      json(res, 200, { ok: true, data: { title, updatedAt, length: data.markdown.length } });
      return true;
    }
  }

  // ============= 公众号草稿箱同步（P1-3 / 方案 PR-3） =============
  // 配置状态：H3 —— 只回报「配没配」，任何字段都不携带 MP_APP_SECRET（连片段都不带）
  if (url.pathname === '/api/_/mp-format/config' && req.method === 'GET') {
    json(res, 200, { ok: true, data: sanitizeMpConfig(mpPublisher ? mpPublisher.getMpConfig() : null) });
    return true;
  }

  // IP 白名单体检：真打一次 token 接口，40164 时把被拒 IP 与引导直接摆出来（H1 的可执行引导件）
  if (url.pathname === '/api/_/mp-format/ip-diagnostic' && req.method === 'GET') {
    if (!mpPublisher) { json(res, 500, { ok: false, error: '草稿箱模块未就绪' }); return true; }
    if (!mpPublisher.getMpConfig()) {
      json(res, 400, { ok: false, error: sanitizeMpConfig(null).hint, code: 'MP_NOT_CONFIGURED' });
      return true;
    }
    try {
      await mpPublisher.getAccessToken(true); // forceRefresh：绕过本地缓存，真正打一次微信接口
      json(res, 200, { ok: true, data: { healthy: true, message: '微信接口已连通，access_token 获取正常' } });
    } catch (e) {
      const info = classifyMpError(e);
      json(res, 200, {
        ok: true,
        data: { healthy: false, errcode: info.code, ip: info.ip, message: info.message, hint: info.hint },
      });
    }
    return true;
  }

  // 一键同步到草稿箱：正文 HTML → 图片转存到微信图床（H2 校验）→ 封面素材 → draft/add
  if (url.pathname === '/api/_/mp-format/sync-draft' && req.method === 'POST') {
    let data = {};
    try { ({ data } = await readBody(req)); } catch { data = {}; }
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const html = typeof data.html === 'string' ? data.html : '';
    if (!html.trim()) {
      json(res, 400, { ok: false, error: '请提供排版后的正文 HTML（排版页「同步到草稿箱」会自动带上）' });
      return true;
    }
    if (html.length > MAX_DRAFT_LENGTH) {
      json(res, 400, { ok: false, error: `正文 HTML 过长（${html.length} 字符），请精简后再同步` });
      return true;
    }
    if (!mpPublisher) { json(res, 500, { ok: false, error: '草稿箱模块未就绪' }); return true; }
    // H1：未配置 → 400 + 可执行引导（而不是含糊的 500）
    if (!mpPublisher.getMpConfig()) {
      json(res, 400, { ok: false, error: sanitizeMpConfig(null).hint, code: 'MP_NOT_CONFIGURED' });
      return true;
    }
    try {
      const result = await mpPublisher.syncDraft({
        title,
        html,
        author: typeof data.author === 'string' ? data.author : '',
        digest: typeof data.digest === 'string' ? data.digest : '',
        cover: typeof data.cover === 'string' ? data.cover : '',
        thumbMediaId: typeof data.thumbMediaId === 'string' ? data.thumbMediaId : '',
      });
      // 审计（P0-5 口径）：草稿同步不花 LLM，但同样留一条动作记录便于回溯
      if (typeof logAction === 'function') {
        logAction('mp-draft-sync', 'button', 'wechat', { title, images: result.imageCount, uploaded: result.uploadedCount }, 0, 0);
      }
      json(res, 200, { ok: true, data: result });
    } catch (e) {
      const info = classifyMpError(e);
      const clientError = ['MP_INVALID_DRAFT', 'MP_UNRESOLVED_IMAGES', 'MP_NO_COVER'].includes(e.code);
      // hint 拼进 error：前端 localApi 只上抛 payload.error，拼进来才不会被丢掉
      const message = info.hint ? `${info.message}（${info.hint}）` : info.message;
      json(res, clientError ? 400 : 502, {
        ok: false, error: message, code: e.code || null, errcode: info.code, ip: info.ip, hint: info.hint,
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  tryRoute, SYSTEM_PROMPT, MAX_INPUT_LENGTH, MAX_DRAFT_LENGTH,
  DRAFT_MODULE, DRAFT_KEY, cleanAiMarkdown, mapLlmError,
};
