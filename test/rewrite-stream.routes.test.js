// P1-1 SSE 流式改写的路由级用例（需要 better-sqlite3 → 容器内跑）：
// ① 未登录仍是 401（鉴权在 server.js 全局，先于路由）；
// ② 登录后：响应头必须是 text/event-stream + X-Accel-Buffering: no（否则反向代理会把流缓冲成整包）；
//    且 LLM 未配置时给的是 error 帧而不是 500/JSON —— 前端据此回落整包接口。
// _server.js 已屏蔽 LLM_API_KEY，所以这条路径必定走到「LLM 未配置」，无需真实模型。
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

test('P1-1：/api/_/rewrite/stream 未登录返回 401', async () => {
  const r = await req('/api/_/rewrite/stream', { method: 'POST', body: { text: '素材' } });
  assert.equal(r.status, 401);
});

test('P1-1：登录后返回 SSE 响应头，LLM 未配置时给出 error 帧并正常收尾', async () => {
  const r = await req('/api/_/rewrite/stream', {
    method: 'POST',
    headers: { Cookie: authCookie, Accept: 'text/event-stream' },
    body: { text: '测试素材', platform: 'wechat', tone: '专业', mode: 'create' },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
  assert.equal(r.headers.get('x-accel-buffering'), 'no');
  assert.match(r.headers.get('cache-control') || '', /no-cache/);
  // start 帧先到（前端即时进入「已连接」状态），随后才是 error 帧
  assert.match(r.body, /event: start/);
  assert.match(r.body, /"model":/);
  assert.match(r.body, /event: error/);
  assert.match(r.body, /LLM_API_KEY/);
  // 只应有一帧 error：不能既报 error 又报 cancelled
  assert.equal((r.body.match(/event: error/g) || []).length, 1);
  assert.equal((r.body.match(/event: cancelled/g) || []).length, 0);
});