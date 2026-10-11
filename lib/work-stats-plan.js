// 作品指标「同步点」的落库决策（P1-4，纯函数：无 DB、无隐式时间依赖，now 由调用方传入）
//
// 要解决的问题（验收 I1「没涨 vs 没同步」）：原先 recordWorkStats 在「指标与上一个点完全
// 相同」时**直接跳过**，于是「同步跑了但数据没变」与「同步根本没跑」在库里长得一模一样 ——
// 曲线是平的，用户无法判断该不该焦虑（公众号这类数据本来就好几天不动）。
//
// 现在改为：数据没变也**留痕**，但打上 unchanged = 1 标记，并按时间窗限流，
// 避免高频同步（CRON 半小时一轮）把历史表刷成噪声。
const UNCHANGED_MIN_GAP_MS = 60 * 60 * 1000; // 数据未变时，同一作品最多每小时留一个「同步事件」

// 三个指标逐项严格相等（null 按值比较：都没取到算「相同」，一方有值一方 null 算变化）
function metricsEqual(a, b) {
  if (!a || !b) return false;
  return a.reads === b.reads && a.likes === b.likes && a.comments === b.comments;
}

// 决定这一条要不要落库。
// item: { workId, reads, likes, comments }；last: 该作品上一个点（无则 null）或 { reads, likes, comments, capturedAt, unchanged }
// 返回 { write, unchanged, reason }；reason 只用于日志与测试可读性。
function planStatWrite(item, last, now = Date.now(), options = {}) {
  const gapMs = options.unchangedGapMs ?? UNCHANGED_MIN_GAP_MS;
  if (!item || !item.workId) return { write: false, unchanged: false, reason: 'no-work-id' };
  const reads = item.reads ?? null;
  const likes = item.likes ?? null;
  const comments = item.comments ?? null;
  if (reads == null && likes == null && comments == null) return { write: false, unchanged: false, reason: 'no-metrics' };
  if (!last) return { write: true, unchanged: false, reason: 'first-point' };

  const unchanged = metricsEqual({ reads, likes, comments }, last);
  if (!unchanged) return { write: true, unchanged: false, reason: 'changed' };

  // 数据未变：上一个点本身也是「未变点」且还在限流窗口内 → 不落（避免刷屏）
  const withinGap = last.unchanged && last.capturedAt != null && (now - last.capturedAt) < gapMs;
  if (withinGap) return { write: false, unchanged: true, reason: 'unchanged-throttled' };
  return { write: true, unchanged: true, reason: 'unchanged-event' };
}

// 把一组决策汇总成调用方/前端能读的摘要
function summarizeStatWrites(plans = []) {
  const out = { changed: 0, unchanged: 0, throttled: 0, skipped: 0 };
  for (const plan of plans) {
    if (!plan || !plan.write) {
      if (plan?.reason === 'unchanged-throttled') out.throttled += 1;
      else out.skipped += 1;
      continue;
    }
    if (plan.unchanged) out.unchanged += 1;
    else out.changed += 1;
  }
  return { ...out, inserted: out.changed + out.unchanged };
}

module.exports = { UNCHANGED_MIN_GAP_MS, metricsEqual, planStatWrite, summarizeStatWrites };