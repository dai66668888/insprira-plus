// ============= 前端通用工具纯函数测试 =============
// 不经过 server.js / 数据库：直接 import js/utils.js 与 js/api.js（两者模块顶层都没有 DOM 依赖）。
// 覆盖长任务等待态（P0-1）依赖的两个纯函数：
//   ① formatElapsed：等待期计时文案，含 NaN / 负数 / Infinity 等非法值的兜底；
//   ② isAbortError：区分「用户取消 / 切页中断」与真实失败，避免把中断当异常报错。
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let formatElapsed;
let isAbortError;
let workPublishTs;
let countObservingWorks;
let OBSERVE_WINDOW_MS;

before(async () => {
  ({ formatElapsed, workPublishTs, countObservingWorks, OBSERVE_WINDOW_MS } = await import('../js/utils.js'));
  ({ isAbortError } = await import('../js/api.js'));
});

test('① formatElapsed 按秒/分格式化', () => {
  assert.equal(formatElapsed(0), '0 秒');
  assert.equal(formatElapsed(999), '0 秒');
  assert.equal(formatElapsed(1000), '1 秒');
  assert.equal(formatElapsed(59999), '59 秒');
  assert.equal(formatElapsed(60000), '1 分 00 秒');
  assert.equal(formatElapsed(65000), '1 分 05 秒');
  assert.equal(formatElapsed(3600000), '60 分 00 秒');
});

test('② formatElapsed 非法输入兜底为 0 秒（等待期不出现「NaN 秒」）', () => {
  assert.equal(formatElapsed(NaN), '0 秒');
  assert.equal(formatElapsed(-5000), '0 秒');
  assert.equal(formatElapsed(null), '0 秒');
  assert.equal(formatElapsed(undefined), '0 秒');
  assert.equal(formatElapsed('abc'), '0 秒');
  assert.equal(formatElapsed(Infinity), '0 秒');
});

test('③ isAbortError 只认 AbortError（取消 ≠ 失败）', () => {
  const abort = new Error('The user aborted a request.');
  abort.name = 'AbortError';
  assert.equal(isAbortError(abort), true);
  assert.equal(isAbortError(new Error('网络错误')), false);
  assert.equal(isAbortError(new RangeError('Maximum call stack size exceeded')), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError(undefined), false);
  assert.equal(isAbortError('AbortError'), false);
});

// ============= P1-4：「观察中」篇数（没涨 vs 没同步 的展示口径） =============
test('④ workPublishTs 吃各平台字段与秒/毫秒两种时间戳，拿不到就返回 0', () => {
  const ms = Date.UTC(2024, 2, 1, 2, 0, 0);
  assert.equal(workPublishTs({ publishTime: ms }), ms);
  assert.equal(workPublishTs({ publishTime: Math.floor(ms / 1000) }), ms, '10 位秒级自动升位');
  assert.equal(workPublishTs({ publish_at: ms }), ms, '后端归一化字段优先');
  assert.equal(workPublishTs({ publicTime: '2024-03-01 10:00' }), new Date('2024/03/01 10:00').getTime());
  assert.equal(workPublishTs({ createTime: '1710000000000' }), 1710000000000);
  assert.equal(workPublishTs({ workPublishTime: `${ms}` }), ms);
  // 拿不到 / 非法值一律 0（调用方据此排除，而不是当成「刚发布」）
  assert.equal(workPublishTs({}), 0);
  assert.equal(workPublishTs(null), 0);
  assert.equal(workPublishTs({ publishTime: '' }), 0);
  assert.equal(workPublishTs({ publishTime: '不是时间' }), 0);
  assert.equal(workPublishTs({ publishTime: Infinity }), 0);
});

test('⑤ countObservingWorks 按 48h 窗口计数（边界与字段回退）', () => {
  assert.equal(OBSERVE_WINDOW_MS, 48 * 60 * 60 * 1000);
  const now = Date.UTC(2024, 2, 10, 12, 0, 0);
  const works = [
    { publishTime: now - 60 * 60 * 1000 },              // 1 小时前 → 观察中
    { createTime: now - 47 * 60 * 60 * 1000 },          // 47 小时前 → 观察中
    { publicTime: now - 48 * 60 * 60 * 1000 },          // 恰好 48 小时 → 不算（窗口是「未满」）
    { publishTime: now - 72 * 60 * 60 * 1000 },         // 3 天前 → 不算
    { publishTime: now + 60 * 60 * 1000 },              // 未来时间（时钟偏差）→ 观察中
    {},                                                 // 无时间 → 不算
    { publishTime: 0 },                                 // 0 → 不算
  ];
  assert.equal(countObservingWorks(works, now), 3);
  assert.equal(countObservingWorks([], now), 0);
  assert.equal(countObservingWorks(null, now), 0);
  assert.equal(countObservingWorks(works.slice(0, 4), now, 0), 0, '窗口可注入（0 → 都不算观察中）');
  assert.equal(countObservingWorks(works, now, 100 * 24 * 60 * 60 * 1000), 5, '放宽窗口后连 48h 前的也算');
});