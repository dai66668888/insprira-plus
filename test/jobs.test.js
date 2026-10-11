// lib/jobs.js 纯函数单测（不依赖 DB/DOM）：
// 作业的生命周期、逐项进度、过期清理、上限淘汰、并发判定与"后台执行自动写回成败"。
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeJobStore, DEFAULT_TTL_MS, DEFAULT_MAX_JOBS } = require('../lib/jobs');

// 可控时钟 + 可预测 id
function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}

let seq = 0;
function makeStore({ clock = makeClock(), ...rest } = {}) {
  return makeJobStore({ now: clock.now, idFactory: () => `job${++seq}`, ...rest });
}

test('create：作业初始为 running，字段齐备且 id 形如十六进制', () => {
  const store = makeJobStore({ idFactory: undefined });
  const job = store.create({ kind: 'hot-sync', message: '正在刷新', total: 5, meta: { platform: 'all' } });
  assert.match(job.id, /^[0-9a-f]{16}$/);
  assert.equal(job.status, 'running');
  assert.equal(job.done, 0);
  assert.equal(job.total, 5);
  assert.deepEqual(job.meta, { platform: 'all' });
  assert.equal(job.completedAt, null);
  assert.equal(store.get(job.id).id, job.id);
});

test('get：未知 id / 空 id 一律返回 null（不抛错）', () => {
  const store = makeStore();
  assert.equal(store.get('nope'), null);
  assert.equal(store.get(null), null);
  assert.equal(store.get(''), null);
  assert.equal(store.get(undefined), null);
});

test('update：可改状态与文案，但不能覆盖 id/startedAt', () => {
  const clock = makeClock();
  const store = makeStore({ clock });
  const job = store.create({ kind: 'k' });
  clock.advance(500);
  const updated = store.update(job.id, { message: '进行中', id: 'hacked', startedAt: 0, done: 2 });
  assert.equal(updated.id, job.id);
  assert.equal(updated.startedAt, job.startedAt);
  assert.equal(updated.message, '进行中');
  assert.equal(updated.done, 2);
  assert.equal(store.update('nope', { message: 'x' }), null);
});

test('addItem：逐项累计并同步 done 计数', () => {
  const store = makeStore();
  const job = store.create({ kind: 'hot-sync', total: 3 });
  store.addItem(job.id, { platform: 'dy', status: 'success' });
  store.addItem(job.id, { platform: 'ks', status: 'error' });
  const after = store.get(job.id);
  assert.equal(after.done, 2);
  assert.equal(after.items.length, 2);
  assert.equal(after.items[1].status, 'error');
  assert.equal(store.addItem('nope', {}), null);
});

test('finish/fail：终态写 completedAt，失败同时写 message 与 error', () => {
  const clock = makeClock();
  const store = makeStore({ clock });
  const a = store.create({ kind: 'k' });
  clock.advance(1000);
  const doneJob = store.finish(a.id, { result: { ok: 1 } });
  assert.equal(doneJob.status, 'done');
  assert.equal(doneJob.completedAt, clock.now());
  assert.equal(doneJob.message, '已完成');
  assert.deepEqual(doneJob.result, { ok: 1 });

  const b = store.create({ kind: 'k', message: '正在同步' });
  const failed = store.fail(b.id, new Error('RedFox 401'));
  assert.equal(failed.status, 'error');
  assert.equal(failed.message, 'RedFox 401');
  assert.equal(failed.error, 'RedFox 401');
  // 字符串错误同样支持
  assert.equal(store.fail(store.create({ kind: 'k' }).id, '超时').message, '超时');
});

test('run：成功后 status=done 且带回返回值，失败后 status=error 且不产生未处理拒绝', async () => {
  const store = makeStore();
  const okJob = store.create({ kind: 'k' });
  const value = await store.run(okJob.id, async () => {
    store.update(okJob.id, { message: '跑了一半' });
    return { platforms: 3 };
  });
  assert.deepEqual(value, { platforms: 3 });
  assert.equal(store.get(okJob.id).status, 'done');
  assert.deepEqual(store.get(okJob.id).result, { platforms: 3 });

  const badJob = store.create({ kind: 'k' });
  await store.run(badJob.id, async () => { throw new Error('平台失败'); });
  const failed = store.get(badJob.id);
  assert.equal(failed.status, 'error');
  assert.equal(failed.message, '平台失败');
});

test('prune：终态作业过期即清；运行中的作业永不清理', () => {
  const clock = makeClock();
  const store = makeStore({ clock, ttlMs: 1000 });
  const finished = store.create({ kind: 'k' });
  store.finish(finished.id);
  const running = store.create({ kind: 'k' }); // 一直是 running

  clock.advance(999);
  assert.ok(store.get(finished.id), '未到 ttl 不应清理');
  clock.advance(2);
  assert.equal(store.get(finished.id), null, '超过 ttl 应清理');
  assert.ok(store.get(running.id), '运行中的作业不能被清理');
  assert.equal(DEFAULT_TTL_MS, 30 * 60 * 1000);
});

test('maxJobs：超过上限时从最旧的终态作业开始淘汰，运行中的保留', () => {
  const clock = makeClock();
  const store = makeStore({ clock, maxJobs: 3, ttlMs: 10 ** 9 });
  const running = store.create({ kind: 'k' });
  const a = store.create({ kind: 'k' });
  clock.advance(1); store.finish(a.id);
  const b = store.create({ kind: 'k' });
  clock.advance(1); store.finish(b.id);
  const c = store.create({ kind: 'k' });
  clock.advance(1); store.finish(c.id);
  assert.equal(store.size(), 4);
  store.prune();
  assert.equal(store.size(), 3, '应淘汰到上限');
  assert.equal(store.get(a.id), null, '最旧的终态作业先被淘汰');
  assert.ok(store.get(b.id) && store.get(c.id));
  assert.ok(store.get(running.id), '运行中的作业必须保留');
  assert.ok(DEFAULT_MAX_JOBS >= 10);
});

test('findRunning：按谓词找运行中的作业（路由用它拒绝重复提交）', () => {
  const store = makeStore();
  const one = store.create({ kind: 'hot-sync', meta: { platform: 'dy' } });
  assert.equal(store.findRunning(job => job.kind === 'hot-sync').id, one.id);
  assert.equal(store.findRunning(job => job.kind === 'tracker-sync'), null);
  assert.equal(store.findRunning(job => job.meta.platform === 'ks'), null);
  store.finish(one.id);
  assert.equal(store.findRunning(job => job.kind === 'hot-sync'), null, '终态不算运行中');
});

test('list：按 startedAt 倒序，最新的在前', () => {
  const clock = makeClock();
  const store = makeStore({ clock });
  const first = store.create({ kind: 'k' });
  clock.advance(10);
  const second = store.create({ kind: 'k' });
  const ids = store.list().map(job => job.id);
  assert.deepEqual(ids, [second.id, first.id]);
});