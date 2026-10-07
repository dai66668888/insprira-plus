// ============= single-flight 纯函数测试 =============
// 不经过 server.js / 数据库：lib/single-flight.js 只依赖 crypto 与 lib/utils.stableObject。
// 覆盖「连点/双开不再重复烧预算」的关键语义：
//   ① 同 key 并发只执行一次；② 不同 key 各自执行；③ 结束后释放 key（顺序调用不共享）；
//   ④ 窗口过期允许重新发起；⑤ 失败原样抛给所有调用者且释放 key；⑥ 请求键归一化。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSingleFlight, requestKey } = require('../lib/single-flight');

const nextTick = () => new Promise(resolve => setImmediate(resolve));

test('① 同 key 并发只执行一次，第二个调用复用同一条 Promise', async () => {
  const flight = createSingleFlight(5000);
  let calls = 0;
  const task = async () => { calls++; await nextTick(); return { calls }; };
  const first = flight.run('k', task);
  const second = flight.run('k', task);
  assert.equal(first.deduplicated, false, '首个调用是自己执行');
  assert.equal(second.deduplicated, true, '第二个调用命中复用');
  assert.equal(first.promise, second.promise, '必须复用同一条 Promise');
  assert.deepEqual(await first.promise, { calls: 1 });
  assert.deepEqual(await second.promise, { calls: 1 });
  assert.equal(calls, 1, '任务只能执行一次');
});

test('② 不同 key 各自执行', async () => {
  const flight = createSingleFlight(5000);
  let calls = 0;
  const task = async value => { calls++; await nextTick(); return value; };
  const a = flight.run('a', () => task('A'));
  const b = flight.run('b', () => task('B'));
  assert.equal(a.deduplicated, false);
  assert.equal(b.deduplicated, false);
  assert.equal(await a.promise, 'A');
  assert.equal(await b.promise, 'B');
  assert.equal(calls, 2);
});

test('③ 任务结束后立即释放 key：顺序调用不共享结果', async () => {
  const flight = createSingleFlight(5000);
  let calls = 0;
  const task = async () => { calls++; return calls; };
  assert.equal(await flight.run('k', task).promise, 1);
  assert.equal(flight.size(), 0, '结束后不应残留 entry');
  const again = flight.run('k', task);
  assert.equal(again.deduplicated, false, '顺序的第二次调用必须重新执行');
  assert.equal(await again.promise, 2);
});

test('④ 窗口过期后允许重新发起（旧 entry 不误删新 entry）', async () => {
  let clock = 1000;
  const flight = createSingleFlight(5000, { now: () => clock });
  let calls = 0;
  const task = () => new Promise(resolve => setTimeout(() => { calls++; resolve(calls); }, 20));
  const first = flight.run('k', task);
  clock = 7000; // 超过 5s 窗口，但上一个任务仍在飞
  const second = flight.run('k', task);
  assert.equal(second.deduplicated, false, '窗口过期应允许重新发起');
  assert.notEqual(first.promise, second.promise);
  assert.equal(await first.promise, 1);
  assert.equal(await second.promise, 2);
  assert.equal(calls, 2);
  assert.equal(flight.size(), 0, '两个 entry 都要被清理');
});

test('⑤ 失败原样抛给所有调用者，并释放 key 允许重试', async () => {
  const flight = createSingleFlight(5000);
  let calls = 0;
  const boom = () => { calls++; return Promise.reject(new Error('LLM 调用失败')); };
  const first = flight.run('k', boom);
  const second = flight.run('k', boom);
  await assert.rejects(first.promise, /LLM 调用失败/);
  await assert.rejects(second.promise, /LLM 调用失败/);
  assert.equal(calls, 1, '并发失败也只执行一次');
  assert.equal(flight.size(), 0, '失败后必须释放 key，否则一次失败会卡住后续重试');
  const retry = flight.run('k', boom);
  assert.equal(retry.deduplicated, false, '失败后重试必须真的重新执行');
  await assert.rejects(retry.promise, /LLM 调用失败/);
  assert.equal(calls, 2);
});

test('⑥ requestKey 键序无关、内容不同则键不同', () => {
  assert.equal(requestKey({ a: 1, b: { c: 2, d: 3 } }), requestKey({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(requestKey({ a: 1 }), requestKey({ a: 2 }));
  // undefined 字段等同于省略（JSON.stringify 语义）：显式传 undefined 与不传命中同一条
  assert.equal(requestKey({ a: 1 }), requestKey({ a: 1, b: undefined }));
  assert.notEqual(requestKey({ a: 1 }), requestKey({ a: null }));
  assert.equal(typeof requestKey(undefined), 'string');
  assert.equal(requestKey(undefined), requestKey({}));
});