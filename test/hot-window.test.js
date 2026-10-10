// 趋势窗口归一化：`GET /api/_/hot/trends` 与 `POST /api/_/hot/trends/analyze` 必须共用同一套规则，
// 否则「前端传 30、后端按 14 取数」这类口径漂移会静默发生（P0-3 / 验收 C1）。
// 纯函数测试：只依赖 lib/utils.js，不需要 better-sqlite3 与 DB。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTrendDays } = require('../lib/utils');

test('① 窗口 7：数字 7 与字符串 "7" 都归一到 7', () => {
  assert.equal(normalizeTrendDays(7), 7);
  assert.equal(normalizeTrendDays('7'), 7, '路由拿到的是 searchParams 字符串，必须同样归一');
});

test('② 其余一律归一为 14（非法值兜底，不允许出现 0 / 30 / NaN 这类窗口）', () => {
  const values = [14, '14', 30, '30', 0, '0', -1, 7.5, null, undefined, '', 'abc', NaN, Infinity, {}];
  for (const value of values) {
    assert.equal(normalizeTrendDays(value), 14, `normalizeTrendDays(${String(value)}) 应为 14`);
  }
});

test('③ 返回值只可能是 7 或 14', () => {
  for (let i = -5; i <= 40; i++) {
    assert.ok([7, 14].includes(normalizeTrendDays(i)), `normalizeTrendDays(${i}) 越界`);
  }
});