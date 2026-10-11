// 单篇作品指标时间序列：增长曲线与「发布 24h 增速 vs 账号典型增速」评价口径
// 每次 tracker 同步 / 插件上报 / XHS MCP 拉取都经 recordWorkStats 追加一个点
const { db } = require('./db');
const { toNumber } = require('./utils');
const { planStatWrite, summarizeStatWrites, UNCHANGED_MIN_GAP_MS } = require('./work-stats-plan');

const DAY_MS = 24 * 60 * 60 * 1000;

// 从作品原始数据提取指标（各平台字段不同，多字段回退；与 article-analysis 口径保持一致）
function workReads(work) {
  return toNumber(work.readCount ?? work.clicksCount ?? work.viewCount ?? work.playCount ?? work.reads ?? work['阅读数']) || 0;
}

function workLikes(work) {
  return toNumber(work.likeCount ?? work.diggCount ?? work.likes ?? work['点赞数']) || 0;
}

function workComments(work) {
  return toNumber(work.commentsCount ?? work.commentCount ?? work.comments ?? work['评论数']) || 0;
}

// 追加历史点。items: [{ workId, reads, likes, comments }]
// P1-4：数据没变也**留痕**（unchanged = 1，默认同一作品每小时最多一条），
// 这样「同步跑了但没涨」与「同步根本没跑」在库里是可区分的（验收 I1）。
// 返回 { inserted, changed, unchanged, throttled, skipped }（调用方历史上忽略返回值，改为结构化摘要）
function recordWorkStats(accountId, plat, items, now = Date.now(), options = {}) {
  const lastStmt = db.prepare(`
    SELECT reads, likes, comments, captured_at AS capturedAt, unchanged FROM work_stats_history
    WHERE account_id = ? AND work_id = ?
    ORDER BY captured_at DESC, id DESC LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO work_stats_history (account_id, plat, work_id, reads, likes, comments, captured_at, unchanged)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const writeAll = db.transaction((rows) => {
    for (const row of rows) insert.run(...row);
  });

  const plans = [];
  const rows = [];
  for (const item of items) {
    const last = item?.workId ? lastStmt.get(accountId, String(item.workId)) : null;
    const plan = planStatWrite(item, last, now, options);
    plans.push(plan);
    if (!plan.write) continue;
    rows.push([
      accountId, plat, String(item.workId),
      item.reads ?? null, item.likes ?? null, item.comments ?? null,
      now, plan.unchanged ? 1 : 0,
    ]);
  }
  if (rows.length) writeAll(rows);
  return summarizeStatWrites(plans);
}

// 单篇增长曲线（时间升序）。unchanged = 1 表示这一点是「同步已跑、值未变」的留痕点
function getGrowthCurve(accountId, workId, limit = 50) {
  return db.prepare(`
    SELECT reads, likes, comments, captured_at AS capturedAt, unchanged
    FROM work_stats_history
    WHERE account_id = ? AND work_id = ?
    ORDER BY captured_at ASC LIMIT ?
  `).all(accountId, String(workId), limit);
}

// 发布 24h 内的阅读增量：窗口内至少 2 个点才算得出（首点往往已带延迟数据，不能当 0 起点）
function getFirst24hGrowth(accountId, workId, publishAt) {
  if (!publishAt) return null;
  const points = db.prepare(`
    SELECT reads FROM work_stats_history
    WHERE account_id = ? AND work_id = ? AND captured_at BETWEEN ? AND ?
    ORDER BY captured_at ASC
  `).all(accountId, String(workId), publishAt, publishAt + DAY_MS)
    .map(p => p.reads).filter(v => v != null);
  if (points.length < 2) return null;
  return points[points.length - 1] - points[0];
}

// 账号典型 24h 增速：账号内所有能算出 24h 增量作品的中位数；样本 <3 返回 null（不足采信）
function getAccountTypical24h(accountId) {
  const works = db.prepare(`
    SELECT work_id, publish_at FROM account_works
    WHERE account_id = ? AND publish_at IS NOT NULL
  `).all(accountId);
  const growths = [];
  for (const w of works) {
    const g = getFirst24hGrowth(accountId, w.work_id, w.publish_at);
    if (g != null && g >= 0) growths.push(g);
  }
  if (growths.length < 3) return null;
  growths.sort((a, b) => a - b);
  const mid = Math.floor(growths.length / 2);
  const median = growths.length % 2 ? growths[mid] : Math.round((growths[mid - 1] + growths[mid]) / 2);
  return { median, samples: growths.length };
}

module.exports = {
  DAY_MS,
  UNCHANGED_MIN_GAP_MS,
  workReads,
  workLikes,
  workComments,
  recordWorkStats,
  getGrowthCurve,
  getFirst24hGrowth,
  getAccountTypical24h,
};
