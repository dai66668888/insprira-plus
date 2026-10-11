// P1-2 长任务作业化的路由级用例（需要 better-sqlite3 → 容器内跑）：
// ① 作业接口同样受全局鉴权保护（未登录 401）；
// ② 提交作业**立刻**返回 jobId（验收 G1：不再让一个 HTTP 请求挂几十秒）；
// ③ 通用轮询接口的形状：running/done/error 三态 + kind/meta 可辨认；未知 id 404；
// ④ 平台参数校验；⑤ 作业体自己吞掉失败（请求不 500、失败信息进作业状态）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, close, req } = require('./_server');

let started = false;
let authCookie = null;

test.before(async () => {
  await boot();
  started = true;
  const r = await req('/api/_/login', { method: 'POST', body: { username: 'admin', password: '123456' } });
  assert.ok(r.headers.get('set-cookie'), '应下发会话 cookie');
  authCookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(async () => {
  if (started) await close();
});

const withCookie = extra => ({ Cookie: authCookie, ...extra });

test('P1-2：作业接口未登录返回 401', async () => {
  const post = await req('/api/_/hot/sync/jobs', { method: 'POST', body: {} });
  const list = await req('/api/_/jobs');
  assert.equal(post.status, 401);
  assert.equal(list.status, 401);
});

test('P1-2：提交热点刷新作业立刻拿到 jobId，且能轮询到作业状态', async () => {
  const t0 = Date.now();
  const started_ = await req('/api/_/hot/sync/jobs', { method: 'POST', headers: withCookie(), body: {} });
  const elapsed = Date.now() - t0;
  assert.equal(started_.status, 200);
  assert.equal(started_.json.ok, true);
  const { jobId, reused } = started_.json.data;
  assert.match(jobId, /^[0-9a-f]{16}$/);
  assert.equal(typeof reused, 'boolean');
  // G1 的核心：提交必须立刻返回（真实同步在后台跑）。给足冷启动余量，但绝不该等到分钟级。
  assert.ok(elapsed < 5000, `作业提交应立刻返回，实际耗时 ${elapsed}ms`);

  const polled = await req(`/api/_/jobs/${jobId}`, { headers: withCookie() });
  assert.equal(polled.status, 200);
  const job = polled.json.data;
  assert.equal(job.id, jobId);
  assert.equal(job.kind, 'hot-sync');
  assert.equal(job.meta.platform, 'all');
  assert.ok(['running', 'done', 'error'].includes(job.status), `未知状态 ${job.status}`);
  assert.equal(typeof job.message, 'string');
  assert.ok(Array.isArray(job.items));
  assert.equal(job.startedAt > 0, true);
});

test('P1-2：未知/过期作业返回 404，不存在的平台返回 400', async () => {
  const missing = await req('/api/_/jobs/0123456789abcdef', { headers: withCookie() });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.ok, false);

  const badPlatform = await req('/api/_/hot/sync/jobs?platform=不存在的平台', { method: 'POST', headers: withCookie(), body: {} });
  assert.equal(badPlatform.status, 400);
});

test('P1-2：作业把失败写进状态而不是让请求报错（账号不存在也不 500）', async () => {
  const started_ = await req('/api/_/trackers/__no_such_account__/sync-jobs', {
    method: 'POST', headers: withCookie(), body: {},
  });
  assert.equal(started_.status, 200, '提交阶段就应该成功返回 jobId');
  const jobId = started_.json.data.jobId;
  assert.match(jobId, /^[0-9a-f]{16}$/);

  // 轮询若干次直到终态（无 RedFox 密钥时失败很快，但给足重试次数避免偶发）
  let job = null;
  for (let i = 0; i < 20; i += 1) {
    const polled = await req(`/api/_/jobs/${jobId}`, { headers: withCookie() });
    assert.equal(polled.status, 200);
    job = polled.json.data;
    if (job.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(job.kind, 'tracker-sync');
  assert.equal(job.meta.id, '__no_such_account__');
  assert.ok(['done', 'error'].includes(job.status), `作业应进入终态，实际 ${job.status}`);
});

test('P1-2：作业列表接口返回数组（前端切页回来后恢复进度用）', async () => {
  const list = await req('/api/_/jobs', { headers: withCookie() });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.data.jobs));
});