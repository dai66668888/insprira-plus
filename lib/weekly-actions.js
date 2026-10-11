// 周行动项的「锚点」与「不重复」规则（P1-5，纯函数：无 DB、无 LLM 调用）
//
// 背景：以前 LLM 只产出纯文本行动项（actions: ["…", "…"]），前端除了勾选完成无处可去，
// 也说不清这条建议是冲哪个账号/哪篇作品去的；而「已完成的不原样重复」只是 system prompt
// 里的一句请求，没有任何代码约束（模型不听就重复了）。这里把两件事变成可测的纯逻辑：
//   ① normalizeActionAnchors：把 LLM 给的 accountId/workId 校验回**真实账号**
//      （宁可丢掉锚点，也不接受编造的 id），并允许模型只报账号名（按名字回填 id）。
//      这是 J1「≥80% 行动项带 account_id」的达成口径，也是它的度量口径。
//   ② dedupeAgainstHistory：把「与上周已完成项原样重复」和批次内自我重复的建议丢掉（J3）。
// 输出沿用 weekly_actions 表的字段名（account_id / work_id），前端两条渲染路径共用一个形状。
const NONE_LIKE = new Set(['', 'null', 'undefined', 'none', 'n/a', '-', '无']);

// 文本归一：去掉空白与常见标点，用于「原样重复」判定（只差一个句号不算新建议）
function normalizeActionText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：！？,.!?;:'"“”‘’「」『』（）()【】\[\]{}<>《》—–~～·…]/g, '');
}

function cleanId(value) {
  const text = String(value ?? '').trim();
  return NONE_LIKE.has(text.toLowerCase()) ? '' : text;
}

// 解析一条行动项（兼容「纯字符串」的老格式）
function parseAction(action) {
  if (typeof action === 'string') return { text: action.trim(), rawAccountId: '', rawWorkId: '' };
  if (!action || typeof action !== 'object') return { text: '', rawAccountId: '', rawWorkId: '' };
  return {
    text: String(action.text ?? action.action ?? action.title ?? '').trim(),
    rawAccountId: cleanId(action.accountId ?? action.account_id),
    rawWorkId: cleanId(action.workId ?? action.work_id ?? action.contentKey ?? action.content_key),
  };
}

// accountId 校验：先精确匹配 id，再按账号名回填（忽略空白与大小写）；都匹配不上就丢锚点
function resolveAccountId(rawAccountId, accounts = []) {
  if (!rawAccountId) return '';
  const list = Array.isArray(accounts) ? accounts : [];
  if (list.some(a => String(a.id) === rawAccountId)) return rawAccountId;
  const target = rawAccountId.replace(/\s+/g, '').toLowerCase();
  if (!target) return '';
  const byName = list.find(a => String(a.name || '').replace(/\s+/g, '').toLowerCase() === target);
  return byName ? String(byName.id) : '';
}

// 归一化一批行动项 → [{ text, account_id, work_id, anchored }]；空文本丢弃
function normalizeActionAnchors(actions = [], accounts = []) {
  const list = Array.isArray(actions) ? actions : [];
  const out = [];
  for (const action of list) {
    const { text, rawAccountId, rawWorkId } = parseAction(action);
    if (!text) continue;
    const accountId = resolveAccountId(rawAccountId, accounts);
    // 账号锚点回填不上时，作品锚点一并丢掉（否则前端会跳到一个没头没尾的详情去）
    const workId = accountId ? rawWorkId : '';
    out.push({ text, account_id: accountId, work_id: workId, anchored: !!accountId });
  }
  return out;
}

// J1 度量：带账号锚点的比例（无行动项时 ratio 记 0，不假装 100%）
function actionAnchorRatio(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const anchored = list.filter(row => row?.anchored || row?.account_id || row?.accountId).length;
  return { total: list.length, anchored, ratio: list.length ? anchored / list.length : 0 };
}

// J3：丢掉「与上周已完成项原样重复」以及批次内自我重复的建议。
// history: 上周行动项 [{ text, status }] —— 只拿 status === 'done' 的当禁令；
// pending（还没做，本来就该重提）不拦，「未奏效的换打法」由 prompt 负责。
function dedupeAgainstHistory(rows = [], history = []) {
  const list = Array.isArray(rows) ? rows : [];
  const doneTexts = new Set(
    (Array.isArray(history) ? history : [])
      .filter(h => h?.status === 'done')
      .map(h => normalizeActionText(h.text))
      .filter(Boolean),
  );
  const seen = new Set();
  const kept = [];
  const dropped = [];
  for (const row of list) {
    const key = normalizeActionText(row?.text);
    if (!key) continue;
    if (doneTexts.has(key)) { dropped.push({ ...row, droppedBy: 'done-last-week' }); continue; }
    if (seen.has(key)) { dropped.push({ ...row, droppedBy: 'duplicate-in-batch' }); continue; }
    seen.add(key);
    kept.push(row);
  }
  return { kept, dropped };
}

module.exports = {
  normalizeActionText,
  normalizeActionAnchors,
  actionAnchorRatio,
  dedupeAgainstHistory,
};