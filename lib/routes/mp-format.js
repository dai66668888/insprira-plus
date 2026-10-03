// 路由组：公众号排版助手（方案 §5.3 / PR-2）
// POST /api/_/mp-format/ai-layout —— AI 一键排版：只调结构不改内容的 Markdown 优化
// 依赖通过 ctx 注入：llm（lib/llm 的 make() 实例）
// SYSTEM_PROMPT 与输入上限（15000 字符）移植自 mspringjade/wechat-formatter（AGPL-3.0）
// 的 app/api/ai-format/route.ts，追加 insprira 约束（图片 URL 保持不变）。
// 注意：LLM 失败统一映射为 502，不占用 401 —— 前端 localApi 把 401 当登录过期处理。
const { json, readBody } = require('../http');

const MAX_INPUT_LENGTH = 15000;

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
  const { llm } = ctx;

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
      json(res, 200, { ok: true, data: { markdown: cleaned } });
    } catch (e) {
      json(res, 502, { ok: false, error: mapLlmError(e) });
    }
    return true;
  }

  return false;
}

module.exports = { tryRoute, SYSTEM_PROMPT, MAX_INPUT_LENGTH, cleanAiMarkdown, mapLlmError };
