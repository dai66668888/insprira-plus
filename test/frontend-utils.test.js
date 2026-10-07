// ============= 前端通用工具纯函数测试 =============
// 不经过 server.js / 数据库：直接 import js/utils.js 与 js/api.js（两者模块顶层都没有 DOM 依赖）。
// 覆盖长任务等待态（P0-1）依赖的两个纯函数：
//   ① formatElapsed：等待期计时文案，含 NaN / 负数 / Infinity 等非法值的兜底；
//   ② isAbortError：区分「用户取消 / 切页中断」与真实失败，避免把中断当异常报错。
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let formatElapsed;
let isAbortError;

before(async () => {
  ({ formatElapsed } = await import('../js/utils.js'));
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