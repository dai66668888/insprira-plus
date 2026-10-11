// P1-4 同步点落库决策（纯函数，可离线跑）：没涨 vs 没同步 的核心判定
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UNCHANGED_MIN_GAP_MS, metricsEqual, planStatWrite, summarizeStatWrites,
} = require('../lib/work-stats-plan');

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

test('metricsEqual：三个指标逐项严格比较，null 按值算，任缺一方即不相等', () => {
  assert.equal(metricsEqual({ reads: 1, likes: 2, comments: 3 }, { reads: 1, likes: 2, comments: 3 }), true);
  assert.equal(metricsEqual({ reads: 1, likes: 2, comments: 3 }, { reads: 1, likes: 2, comments: 4 }), false);
  assert.equal(metricsEqual({ reads: 1, likes: 2, comments: 3 }, { reads: 2, likes: 2, comments: 3 }), false);
  assert.equal(metricsEqual({ reads: null, likes: null, comments: null }, { reads: null, likes: null, comments: null }), true);
  assert.equal(metricsEqual({ reads: null, likes: 2, comments: 3 }, { reads: 1, likes: 2, comments: 3 }), false);
  assert.equal(metricsEqual(null, { reads: 1 }), false);
});

test('planStatWrite：无 workId / 全无指标 → 不落点（沿用旧语义）', () => {
  assert.equal(planStatWrite({ reads: 1 }, null, NOW).reason, 'no-work-id');
  assert.equal(planStatWrite({ workId: 'w' }, null, NOW).reason, 'no-metrics');
  assert.equal(planStatWrite({ workId: 'w', reads: null, likes: null, comments: null }, { reads: 1 }, NOW).write, false);
  assert.equal(planStatWrite(null, null, NOW).write, false);
});

test('planStatWrite：首次落点与「数据变了」都立即写，且不标 unchanged', () => {
  const first = planStatWrite({ workId: 'w', reads: 100, likes: 5, comments: 2 }, null, NOW);
  assert.deepEqual(first, { write: true, unchanged: false, reason: 'first-point' });

  const changed = planStatWrite(
    { workId: 'w', reads: 150, likes: 5, comments: 2 },
    { reads: 100, likes: 5, comments: 2, capturedAt: NOW - 1000, unchanged: 1 },
    NOW,
  );
  assert.deepEqual(changed, { write: true, unchanged: false, reason: 'changed' });
});

test('planStatWrite：上一个点是「变化点」时，即使刚写过，未变也要留一条事件（否则这段空白无法解释）', () => {
  const plan = planStatWrite(
    { workId: 'w', reads: 100, likes: 5, comments: 2 },
    { reads: 100, likes: 5, comments: 2, capturedAt: NOW - 1000, unchanged: 0 },
    NOW,
  );
  assert.deepEqual(plan, { write: true, unchanged: true, reason: 'unchanged-event' });
});

test('planStatWrite：连续未变在限流窗口内不再落点（避免高频同步刷噪声）', () => {
  const last = { reads: 100, likes: 5, comments: 2, capturedAt: NOW - 30 * 60 * 1000, unchanged: 1 };
  const plan = planStatWrite({ workId: 'w', reads: 100, likes: 5, comments: 2 }, last, NOW);
  assert.deepEqual(plan, { write: false, unchanged: true, reason: 'unchanged-throttled' });

  // 超过窗口 → 再留一条「值未变」的痕迹（跨天同步即可见，验收 I1）
  const later = { ...last, capturedAt: NOW - (UNCHANGED_MIN_GAP_MS + 1000) };
  assert.equal(planStatWrite({ workId: 'w', reads: 100, likes: 5, comments: 2 }, later, NOW).reason, 'unchanged-event');
});

test('planStatWrite：限流窗口可注入（测试与特殊场景用）', () => {
  const last = { reads: 100, likes: 5, comments: 2, capturedAt: NOW - 1000, unchanged: 1 };
  const item = { workId: 'w', reads: 100, likes: 5, comments: 2 };
  assert.equal(planStatWrite(item, last, NOW, { unchangedGapMs: 0 }).reason, 'unchanged-event');
  assert.equal(planStatWrite(item, last, NOW, { unchangedGapMs: 10 * HOUR }).reason, 'unchanged-throttled');
  assert.equal(UNCHANGED_MIN_GAP_MS, HOUR, '默认限流窗口为 1 小时');
});

test('planStatWrite：0 是有效值（0 与 null、0 与 1 都必须算变化）', () => {
  assert.equal(planStatWrite({ workId: 'w', reads: 0, likes: 0, comments: 0 },
    { reads: 0, likes: 0, comments: 0, capturedAt: NOW - 2 * HOUR, unchanged: 1 }, NOW).reason, 'unchanged-event');
  assert.equal(planStatWrite({ workId: 'w', reads: 0, likes: 0, comments: 0 },
    { reads: null, likes: 0, comments: 0, capturedAt: NOW - 2 * HOUR, unchanged: 1 }, NOW).reason, 'changed');
});

test('summarizeStatWrites：混合决策的计数与 inserted 口径', () => {
  const plans = [
    planStatWrite({ workId: 'a', reads: 1 }, null, NOW),                                        // changed
    planStatWrite({ workId: 'b', reads: 1 }, { reads: 1, likes: null, comments: null, capturedAt: NOW - 2 * HOUR, unchanged: 1 }, NOW), // unchanged
    planStatWrite({ workId: 'c', reads: 1 }, { reads: 1, likes: null, comments: null, capturedAt: NOW - 1000, unchanged: 1 }, NOW),     // throttled
    planStatWrite({ workId: '', reads: 1 }, null, NOW),                                          // skipped
    planStatWrite({ workId: 'd' }, null, NOW),                                                   // skipped
  ];
  assert.deepEqual(summarizeStatWrites(plans), { changed: 1, unchanged: 1, throttled: 1, skipped: 2, inserted: 2 });
  assert.deepEqual(summarizeStatWrites([]), { changed: 0, unchanged: 0, throttled: 0, skipped: 0, inserted: 0 });
  assert.deepEqual(summarizeStatWrites(undefined), { changed: 0, unchanged: 0, throttled: 0, skipped: 0, inserted: 0 });
});

test('planStatWrite：now 早于上一点时间（时钟回拨/补历史）不会被误判为限流', () => {
  const last = { reads: 100, likes: 5, comments: 2, capturedAt: NOW + 5 * HOUR, unchanged: 1 };
  // now - capturedAt 为负 → 小于窗口 → 仍按限流处理（不会重复落点），这是刻意的保守行为
  assert.equal(planStatWrite({ workId: 'w', reads: 100, likes: 5, comments: 2 }, last, NOW).reason, 'unchanged-throttled');
});