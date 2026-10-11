// 单篇指标时间序列：历史点记录 / 24h 增量 / 账号典型增速
// 经 _helper 引导（独立 DATA_DIR、关闭调度器），不碰真实 data/cache.db
require('./_helper');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../lib/db');
const {
  recordWorkStats, getGrowthCurve, getFirst24hGrowth, getAccountTypical24h,
} = require('../lib/work-stats');

const ACC = 'test-ws-acc';
const DAY = 86400000;

function cleanup() {
  db.prepare('DELETE FROM work_stats_history WHERE account_id = ?').run(ACC);
  db.prepare('DELETE FROM account_works WHERE account_id = ?').run(ACC);
}

test('recordWorkStats 追加历史点；数据未变也留痕并标 unchanged（P1-4 新契约）', () => {
  cleanup();
  const now = Date.now();
  const r1 = recordWorkStats(ACC, 'gzh', [{ workId: 'w1', reads: 100, likes: 5, comments: 2 }], now);
  assert.deepEqual(
    { inserted: r1.inserted, changed: r1.changed, unchanged: r1.unchanged },
    { inserted: 1, changed: 1, unchanged: 0 },
  );
  // 同一小时内再同步、数据没变 → 仍在限流窗口内，不重复落点（不制造噪声）
  const r2 = recordWorkStats(ACC, 'gzh', [{ workId: 'w1', reads: 100, likes: 5, comments: 2 }], now + 1000);
  assert.equal(r2.inserted, 0);
  assert.equal(r2.throttled, 1);
  // 数据变了 → 不受限流影响
  const r3 = recordWorkStats(ACC, 'gzh', [{ workId: 'w1', reads: 150, likes: 6, comments: 2 }], now + 2000);
  assert.equal(r3.changed, 1);
  const curve = getGrowthCurve(ACC, 'w1');
  assert.equal(curve.length, 2);
  assert.equal(curve[0].reads, 100);
  assert.equal(curve[1].reads, 150);
  cleanup();
});

test('I1：连续两天同步但数据不变 → 历史表 ≥2 个点，且能区分「值未变」', () => {
  cleanup();
  const day1 = Date.now() - 2 * DAY;
  const day2 = Date.now() - DAY;
  recordWorkStats(ACC, 'gzh', [{ workId: 'w1', reads: 300, likes: 9, comments: 4 }], day1);
  const second = recordWorkStats(ACC, 'gzh', [{ workId: 'w1', reads: 300, likes: 9, comments: 4 }], day2);
  assert.equal(second.inserted, 1);
  assert.equal(second.unchanged, 1, '第二天数据未变 → 落一个 unchanged=1 的同步事件');

  const rows = db.prepare(`
    SELECT reads, likes, comments, captured_at, unchanged FROM work_stats_history
    WHERE account_id = ? AND work_id = ? ORDER BY captured_at ASC
  `).all(ACC, 'w1');
  assert.equal(rows.length, 2, '两天各留一个点');
  assert.deepEqual(rows.map(r => r.unchanged), [0, 1], '第 1 个点是变化点，第 2 个点是「值未变」留痕');
  assert.equal(rows[0].reads, rows[1].reads, '值确实没涨');
  assert.ok(rows[1].captured_at - rows[0].captured_at >= DAY - 1000, '两个点跨天');

  // 增长曲线同样能看出「这一点没涨但同步过」：曲线口径不受影响（reads 相同）
  const curve = getGrowthCurve(ACC, 'w1');
  assert.deepEqual(curve.map(p => [p.reads, p.unchanged]), [[300, 0], [300, 1]]);
  cleanup();
});

test('recordWorkStats 忽略无 workId 或全无指标的项', () => {
  cleanup();
  const n = recordWorkStats(ACC, 'gzh', [
    { workId: '', reads: 100 },
    { workId: 'w2' },
    { workId: 'w3', reads: 0, likes: 0, comments: 0 }, // 0 是有效值
  ]);
  assert.equal(n.inserted, 1);
  assert.equal(n.changed, 1);
  assert.equal(n.skipped, 2);
  cleanup();
});

test('getFirst24hGrowth 窗口内至少两点才算增量', () => {
  cleanup();
  const now = Date.now();
  const publishAt = now - 3 * DAY;
  recordWorkStats(ACC, 'gzh', [{ workId: 'w1', reads: 500 }], publishAt + 3600000);
  // 只有 1 个点 → null
  assert.equal(getFirst24hGrowth(ACC, 'w1', publishAt), null);
  recordWorkStats(ACC, 'gzh', [{ workId: 'w1', reads: 900 }], publishAt + 20 * 3600000);
  assert.equal(getFirst24hGrowth(ACC, 'w1', publishAt), 400);
  // 无 publishAt → null
  assert.equal(getFirst24hGrowth(ACC, 'w1', 0), null);
  cleanup();
});

test('getAccountTypical24h 样本不足 3 返回 null，足够取中位数', () => {
  cleanup();
  const now = Date.now();
  // 4 篇作品，各两个历史点，24h 增量分别为 100/200/300/400
  [100, 200, 300, 400].forEach((growth, i) => {
    const workId = `w${i}`;
    const publishAt = now - (10 + i) * DAY;
    db.prepare(`
      INSERT INTO account_works (account_id, plat, work_id, work_data, synced_at, publish_at, content_key)
      VALUES (?, 'gzh', ?, '{}', ?, ?, ?)
    `).run(ACC, workId, now, publishAt, `k${i}`);
    recordWorkStats(ACC, 'gzh', [{ workId, reads: 1000 }], publishAt + 3600000);
    recordWorkStats(ACC, 'gzh', [{ workId, reads: 1000 + growth }], publishAt + 20 * 3600000);
  });
  const typical = getAccountTypical24h(ACC);
  assert.equal(typical.samples, 4);
  assert.equal(typical.median, 250); // (200+300)/2
  // 删掉两篇后样本不足
  db.prepare("DELETE FROM account_works WHERE account_id = ? AND work_id IN ('w0','w1')").run(ACC);
  assert.equal(getAccountTypical24h(ACC), null);
  cleanup();
});
