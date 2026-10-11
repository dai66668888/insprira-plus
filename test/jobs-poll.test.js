// js/jobs.js 纯函数单测（取作业的函数是注入的，因此不需要浏览器/网络）：
// 进度文案、终态返回、失败上抛、容错上限、取消与超时。
const { test } = require('node:test');
const assert = require('node:assert/strict');

let jobProgressText;
let pollJob;
let delay;

test.before(async () => {
  ({ jobProgressText, pollJob, delay } = await import('../js/jobs.js'));
});

// 依次返回预设的作业快照；取完后一直返回最后一个
function stubFetcher(snapshots) {
  let index = 0;
  return async () => snapshots[Math.min(index++, snapshots.length - 1)];
}

test('jobProgressText：运行中补「(已做/总数)」，终态直接用服务端文案', () => {
  assert.equal(jobProgressText(null), '');
  assert.equal(jobProgressText({ status: 'running', message: '正在刷新全网热点…', done: 2, total: 5 }),
    '正在刷新全网热点…（2/5）');
  assert.equal(jobProgressText({ status: 'running', message: '正在同步', done: 3, total: 0 }),
    '正在同步（已完成 3 项）');
  assert.equal(jobProgressText({ status: 'running' }), '进行中…');
  assert.equal(jobProgressText({ status: 'done', message: '刷新完成：3 个平台' }), '刷新完成：3 个平台');
  assert.equal(jobProgressText({ status: 'done' }), '已完成');
  assert.equal(jobProgressText({ status: 'error', message: 'RedFox 401' }), 'RedFox 401');
});

test('pollJob：每轮回调，done 时返回作业本体', async () => {
  const seen = [];
  const job = await pollJob(stubFetcher([
    { status: 'running', message: 'a', done: 0, total: 2 },
    { status: 'running', message: 'b', done: 1, total: 2 },
    { status: 'done', message: '全部完成' },
  ]), { intervalMs: 1, onUpdate: latest => seen.push(latest.message) });
  assert.equal(job.status, 'done');
  assert.equal(job.message, '全部完成');
  assert.deepEqual(seen, ['a', 'b', '全部完成']);
});

test('pollJob：error 终态抛错，并带上原始作业（e.job）', async () => {
  await assert.rejects(
    () => pollJob(stubFetcher([{ status: 'error', message: '平台接口 401', error: '平台接口 401' }]), { intervalMs: 1 }),
    error => {
      assert.equal(error.message, '平台接口 401');
      assert.equal(error.job.status, 'error');
      return true;
    },
  );
});

test('pollJob：单次取作业失败可容忍，连续超过上限才放弃', async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls <= 2) throw new Error('网络错误: 连接被重置');
    return { status: 'done', message: '恢复了' };
  };
  const job = await pollJob(flaky, { intervalMs: 1, maxErrors: 5 });
  assert.equal(job.status, 'done');
  assert.equal(calls, 3, '前两次失败后应继续轮询');

  let failures = 0;
  await assert.rejects(
    () => pollJob(async () => { failures += 1; throw new Error('一直失败'); }, { intervalMs: 1, maxErrors: 2 }),
    /一直失败/,
  );
  assert.equal(failures, 2, '达到上限即停止，不再空转');
});

test('pollJob：AbortError 立刻上抛，不被当成「可容忍的网络抖动」', async () => {
  let calls = 0;
  await assert.rejects(
    () => pollJob(async () => {
      calls += 1;
      const error = new Error('已取消');
      error.name = 'AbortError';
      throw error;
    }, { intervalMs: 1 }),
    error => { assert.equal(error.name, 'AbortError'); return true; },
  );
  assert.equal(calls, 1);
});

test('pollJob：超时抛错并标记 timeout，signal 中止也能立刻结束等待', async () => {
  await assert.rejects(
    () => pollJob(async () => ({ status: 'running', message: '跑不完' }), { intervalMs: 1, timeoutMs: 0 }),
    error => { assert.equal(error.timeout, true); return true; },
  );

  const controller = new AbortController();
  const pending = pollJob(async () => ({ status: 'running', message: '进行中' }), {
    intervalMs: 50,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(() => pending, error => { assert.equal(error.name, 'AbortError'); return true; });

  // 已经 aborted 的 signal：进循环前就拒绝
  await assert.rejects(() => pollJob(async () => ({ status: 'done' }), { signal: AbortSignal.abort() }),
    error => { assert.equal(error.name, 'AbortError'); return true; });
});

test('delay：正常等待可 resolve；带已中止的 signal 时立刻拒绝', async () => {
  const t0 = Date.now();
  await delay(10);
  assert.ok(Date.now() - t0 >= 8);
  await assert.rejects(() => delay(1000, AbortSignal.abort()),
    error => { assert.equal(error.name, 'AbortError'); return true; });
});