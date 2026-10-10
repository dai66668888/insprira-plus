// 热榜趋势可信化（P0-3 / 验收 C1-C3）：窗口生效 + 重分析幂等 + 批次完整度。
//
// 引导：test/_helper.js —— DATA_DIR 指向本进程独立临时目录，不污染生产 data/cache.db。
// LLM 用桩注入 lib/hot.js 的 make(deps)：既能精确统计「LLM 到底被调用了几次」，
// 又不依赖真实 LLM 密钥。无密钥环境下「桩调用次数不增加」等价于验收 C2 的「llm_usage 不新增」。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { db } = require('./_helper');
const { dateDaysAgo } = require('../lib/utils');
const hotLib = require('../lib/hot');

const MIN_ROWS = 10; // 与 lib/hot.js 的 minRows 一致：每日至少 10 条真实热榜才算可用

function makeHot() {
  const prompts = [];
  const api = hotLib.make({
    callLlmJson: async messages => {
      prompts.push(messages);
      // 返回形状与真实约定一致（keywords[].name/aliases/titleIds + summary）
      return { keywords: [{ name: '测试热点', aliases: ['测试热点'], titleIds: [1, 2] }], summary: '桩：本批概述' };
    },
    broadcastNotification: () => {},
  });
  return { ...api, prompts };
}

// 构造「某天有 N 条成功日榜」的真实数据形态（dailyHotSourceRows 读的正是这两张表）
function seedDaily(dataDate, count = MIN_ROWS, platform = 'dy') {
  const batchId = `test-${platform}-${dataDate}`;
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO hot_batches
      (id, platform, data_date, snapshot_kind, endpoint, request_json, response_json,
       status, item_count, started_at, completed_at, error)
    VALUES (?, ?, ?, 'daily', 'test', '{}', NULL, 'success', ?, ?, ?, NULL)
  `).run(batchId, platform, dataDate, count, now, now);
  db.prepare('DELETE FROM hot_batch_items WHERE batch_id = ?').run(batchId);
  const insert = db.prepare(`
    INSERT INTO hot_batch_items (batch_id, rank, item_key, title, score, raw_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (let i = 1; i <= count; i++) {
    insert.run(batchId, i, `k${i}`, `测试标题 ${i} 号`, 100 - i, JSON.stringify({}));
  }
}

// 直接写入一份已完成的关键词报告（用于验证读取侧：窗口范围与 batchStats 透出）
function seedReport(dataDate, { total = 4, failed = 0, generatedAt = Date.now() } = {}) {
  const result = {
    dataDate,
    keywords: [{
      name: '测试热点', aliases: ['测试热点'], mentions: 2, platforms: ['dy'], strength: 30, topTitles: [],
    }],
    summary: '桩：报告概述',
    sourceCount: MIN_ROWS,
    generatedAt,
    batchStats: { total, failed },
  };
  db.prepare(`
    INSERT OR REPLACE INTO hot_daily_keywords (data_date, source_fingerprint, result_json, generated_at)
    VALUES (?, ?, ?, ?)
  `).run(dataDate, `fp-${dataDate}`, JSON.stringify(result), generatedAt);
  return result;
}

function resetTrendTables() {
  db.prepare('DELETE FROM hot_daily_keywords').run();
  db.prepare('DELETE FROM hot_batch_items').run();
  db.prepare('DELETE FROM hot_batches').run();
}

beforeEach(resetTrendTables);

test('① 同一份热榜数据二次分析不再触达 LLM（等价 llm_usage 不新增）', async () => {
  const target = dateDaysAgo(1);
  seedDaily(target, MIN_ROWS);
  const hot = makeHot();

  const first = await hot.analyzeDailyHotKeywords(target, false, 7);
  assert.equal(hot.prompts.length, 1, '首次分析应调用 1 次 LLM（10 条 → 1 批）');
  const rowAfterFirst = db.prepare('SELECT data_date, generated_at FROM hot_daily_keywords WHERE data_date = ?').get(first.dataDate);
  assert.ok(rowAfterFirst, '首次分析必须落库');

  // force=false 且指纹未变 → 直接复用已生成报告
  const second = await hot.analyzeDailyHotKeywords(target, false, 7);
  assert.equal(hot.prompts.length, 1, '同一份数据第二次分析不得再调用 LLM');
  assert.deepEqual(second, first, '复用时应返回同一份报告');
  const rowAfterSecond = db.prepare('SELECT generated_at FROM hot_daily_keywords WHERE data_date = ?').get(first.dataDate);
  assert.equal(rowAfterSecond.generated_at, rowAfterFirst.generated_at, 'generated_at 不应变化（没有重算）');

  // force=true 才真正重算
  await hot.analyzeDailyHotKeywords(target, true, 7);
  assert.equal(hot.prompts.length, 2, 'force=true 必须真的重算');
});

test('② 窗口生效：windowDays 决定回溯深度，getHotTrends 只读窗口内的报告', async () => {
  const hot = makeHot();
  const old = dateDaysAgo(10);
  seedDaily(old, MIN_ROWS); // 只有 10 天前的数据

  // 窗口 7 天：回溯不到 10 天前 → 必须报「数据不足」而不是伪造趋势
  await assert.rejects(() => hot.analyzeDailyHotKeywords(dateDaysAgo(1), false, 7), /都没有足够的真实热榜数据/);
  assert.equal(hot.prompts.length, 0, '数据不足时不得调用 LLM');

  // 窗口 14 天：能回溯到 10 天前那天，并用它的数据生成报告
  const report = await hot.analyzeDailyHotKeywords(dateDaysAgo(1), false, 14);
  assert.equal(report.dataDate, old, '应把 10 天前那天当作实际分析日');
  assert.equal(hot.prompts.length, 1);

  seedReport(dateDaysAgo(3), { generatedAt: 1700000000000 });
  const trends7 = hot.getHotTrends(7);
  const trends14 = hot.getHotTrends(14);
  assert.equal(trends7.analyzedDays, 7);
  assert.equal(trends14.analyzedDays, 14);
  assert.match(trends7.summary, /至少积累 2 天/, '7 天窗口只看到 1 份报告（3 天前那份）');
  assert.match(trends14.summary, /2 个已完成的每日 LLM 关键词报告/, '14 天窗口应看到 2 份报告');
});

test('③ 批次完整度随最新报告带出，且与库中 json_extract 一致（验收 C3 口径）', async () => {
  const hot = makeHot();
  seedReport(dateDaysAgo(3), { total: 4, failed: 2, generatedAt: 1700000000000 });
  seedReport(dateDaysAgo(2), { total: 4, failed: 0, generatedAt: 1700000100000 });

  const latestOk = hot.getHotTrends(7);
  assert.deepEqual(latestOk.batchStats, { total: 4, failed: 0 }, '应取最新一份报告的批次完整度');

  // 最新一份出现失败批 → 前端据此显示「批次 N/M 失败」
  seedReport(dateDaysAgo(2), { total: 4, failed: 1, generatedAt: 1700000200000 });
  const withFailure = hot.getHotTrends(7);
  assert.equal(withFailure.batchStats.failed, 1);
  assert.equal(withFailure.batchStats.total, 4);
  const dbValue = db.prepare(`
    SELECT json_extract(result_json, '$.batchStats.failed') AS failed
    FROM hot_daily_keywords ORDER BY data_date DESC LIMIT 1
  `).get();
  assert.equal(withFailure.batchStats.failed, dbValue.failed, '上屏值必须等于库里的最新值');

  // 窗口内没有任何报告时不得抛错，batchStats 为 null（前端不渲染该字段）
  resetTrendTables();
  const empty = hot.getHotTrends(7);
  assert.equal(empty.batchStats, null);
  assert.equal(empty.analyzedDays, 7);
  assert.deepEqual(empty.themes, []);
});