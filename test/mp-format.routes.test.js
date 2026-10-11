// mp-format 路由测试（方案 §7 PR-2 + P0-4 服务端草稿）：AI 一键排版的 401 边界、输入校验、
// LLM 失败映射与提示词契约；以及草稿 GET/PUT 的一致性与上限（D2 的 SQL 口径）。
// _server.js 已屏蔽 LLM_API_KEY，因此登录后调用必然走「LLM 未配置」错误映射，无需真实模型
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, close, req } = require('./_server');
const { SYSTEM_PROMPT, MAX_INPUT_LENGTH, MAX_DRAFT_LENGTH, cleanAiMarkdown } = require('../lib/routes/mp-format');

let started = false;
test.before(async () => {
  await boot();
  started = true;
});
test.after(async () => {
  if (started) await close();
});

// ============= 401 边界（鉴权在 server.js 全局，先于路由） =============
test('POST /api/_/mp-format/ai-layout 未登录返回 401', async () => {
  const r = await req('/api/_/mp-format/ai-layout', { method: 'POST', body: { markdown: '# 标题' } });
  assert.equal(r.status, 401);
});

// ============= 输入校验 =============
let authCookie = null;
test('登录获取会话（默认 admin/123456）', async () => {
  const r = await req('/api/_/login', {
    method: 'POST',
    body: { username: 'admin', password: '123456' },
  });
  assert.equal(r.status, 200);
  authCookie = r.headers.get('set-cookie').split(';')[0];
  assert.ok(authCookie, '应下发会话 cookie');
});

test('ai-layout 缺失/空白 markdown 返回 400', async () => {
  const empty = await req('/api/_/mp-format/ai-layout', {
    method: 'POST', body: {}, headers: { Cookie: authCookie },
  });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /Markdown/);
  const blank = await req('/api/_/mp-format/ai-layout', {
    method: 'POST', body: { markdown: '   \n\t ' }, headers: { Cookie: authCookie },
  });
  assert.equal(blank.status, 400);
  const wrongType = await req('/api/_/mp-format/ai-layout', {
    method: 'POST', body: { markdown: 123 }, headers: { Cookie: authCookie },
  });
  assert.equal(wrongType.status, 400);
});

test(`ai-layout 超过 ${MAX_INPUT_LENGTH} 字符返回 400 且报出上限`, async () => {
  const r = await req('/api/_/mp-format/ai-layout', {
    method: 'POST',
    body: { markdown: '字'.repeat(MAX_INPUT_LENGTH + 1) },
    headers: { Cookie: authCookie },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, new RegExp(String(MAX_INPUT_LENGTH)));
});

// ============= LLM 失败映射（LLM_API_KEY 已被 _server.js 置空） =============
test('ai-layout LLM 未配置时返回 502 与可读错误（不占用 401，避免前端误判登录过期）', async () => {
  const r = await req('/api/_/mp-format/ai-layout', {
    method: 'POST',
    body: { markdown: '# 标题\n\n段落。' },
    headers: { Cookie: authCookie },
  });
  assert.equal(r.status, 502);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /LLM/);
});

// ============= 纯函数契约 =============
test('SYSTEM_PROMPT 锁定关键约束（不改写 / 只输出 Markdown / 图片 URL 保持不变）', () => {
  assert.match(SYSTEM_PROMPT, /绝不改写原文内容/);
  assert.match(SYSTEM_PROMPT, /绝不删除任何内容/);
  assert.match(SYSTEM_PROMPT, /只输出最终的 Markdown/);
  assert.match(SYSTEM_PROMPT, /图片/);
  assert.match(SYSTEM_PROMPT, /URL.*不变|保持原文图片/);
});

test('cleanAiMarkdown 只剥整体包裹围栏，内部代码块原样保留', () => {
  assert.equal(cleanAiMarkdown('```markdown\n# 标题\n\n段落\n```'), '# 标题\n\n段落');
  assert.equal(cleanAiMarkdown('```\n# 标题\n```'), '# 标题');
  // 内部代码块不能被误伤
  const withCode = '# 标题\n\n```js\nconsole.log(1)\n```';
  assert.equal(cleanAiMarkdown(withCode), withCode);
  // lang 非 markdown 的整体围栏（正文恰为一个代码块）不剥
  assert.equal(cleanAiMarkdown('```js\nconsole.log(1)\n```'), '```js\nconsole.log(1)\n```');
  assert.equal(cleanAiMarkdown('  \n# 直出\n  '), '# 直出');
  assert.equal(cleanAiMarkdown(null), '');
  assert.equal(cleanAiMarkdown(''), '');
});

// ============= 服务端草稿（P0-4） =============
test('draft 未登录返回 401（鉴权在 server.js 全局，先于路由）', async () => {
  const put = await req('/api/_/mp-format/draft', { method: 'PUT', body: { markdown: '# 标题' } });
  assert.equal(put.status, 401);
  const get = await req('/api/_/mp-format/draft');
  assert.equal(get.status, 401);
});

test('draft：PUT 后 GET 回读一致，并落到 local_data（D2 的 SQL 口径）', async () => {
  const markdown = '# 标题\n\n正文段落。\n\n```js\nconsole.log(1);\n```\n\n![图](https://example.com/a.png)';
  const put = await req('/api/_/mp-format/draft', {
    method: 'PUT',
    body: { title: '标题甲', markdown },
    headers: { Cookie: authCookie },
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.data.length, markdown.length);
  assert.match(put.json.data.title, /标题甲/);

  const get = await req('/api/_/mp-format/draft', { headers: { Cookie: authCookie } });
  assert.equal(get.status, 200);
  assert.equal(get.json.data.markdown, markdown);
  assert.equal(get.json.data.title, '标题甲');
  assert.ok(get.json.data.updatedAt > 0, '应带 updatedAt 时间戳');

  const { getLocalData } = require('../lib/local-data');
  assert.equal(getLocalData('format-draft', 'default').markdown, markdown);
});

test('draft：markdown 缺失或非字符串返回 400（不落库）', async () => {
  for (const body of [{}, { markdown: 123 }, { markdown: null }, { title: '只有标题' }]) {
    const r = await req('/api/_/mp-format/draft', {
      method: 'PUT', body, headers: { Cookie: authCookie },
    });
    assert.equal(r.status, 400);
  }
});

test(`draft：超过 ${MAX_DRAFT_LENGTH} 字符返回 400 且报出上限`, async () => {
  const r = await req('/api/_/mp-format/draft', {
    method: 'PUT',
    body: { markdown: '字'.repeat(MAX_DRAFT_LENGTH + 1) },
    headers: { Cookie: authCookie },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, new RegExp(String(MAX_DRAFT_LENGTH)));
});

// ============= 公众号草稿箱同步（P1-3 / 方案 PR-3） =============
// 这里只测「不需要真实公众号」的部分：鉴权、H1（未配置 → 400 + 引导）、H3（不泄露 secret）、
// 输入校验。真链路（图片转存 + draft/add）在 test/mp-publisher.test.js 用 fake fetch 覆盖。
function withoutMpEnv(fn) {
  const saved = {
    id: process.env.MP_APP_ID,
    secret: process.env.MP_APP_SECRET,
    name: process.env.MP_ACCOUNT_NAME,
  };
  delete process.env.MP_APP_ID;
  delete process.env.MP_APP_SECRET;
  delete process.env.MP_ACCOUNT_NAME;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of [['MP_APP_ID', saved.id], ['MP_APP_SECRET', saved.secret], ['MP_ACCOUNT_NAME', saved.name]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    });
}

test('sync-draft 未登录返回 401（鉴权在 server.js 全局，先于路由）', async () => {
  const r = await req('/api/_/mp-format/sync-draft', {
    method: 'POST', body: { title: '标题', html: '<p>正文</p>' },
  });
  assert.equal(r.status, 401);
  const diag = await req('/api/_/mp-format/ip-diagnostic');
  assert.equal(diag.status, 401);
});

test('config：H3 —— 只回报「配没配」，响应体里绝不出现 MP_APP_SECRET', async () => {
  const secret = process.env.MP_APP_SECRET || '';
  const r = await req('/api/_/mp-format/config', { headers: { Cookie: authCookie } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(typeof r.json.data.configured, 'boolean');
  assert.equal(typeof r.json.data.secretConfigured, 'boolean');
  assert.equal('appSecret' in r.json.data, false, '响应对象不得有 appSecret 字段');
  if (secret) {
    assert.equal(r.body.includes(secret), false, '响应体不得包含真实 appSecret');
  }
  assert.equal(JSON.stringify(r.json.data).includes('SECRET'), false);
});

test('sync-draft：未配置公众号 → 400 + 可执行引导（H1），而非 500 或含糊报错', async () => {
  await withoutMpEnv(async () => {
    const r = await req('/api/_/mp-format/sync-draft', {
      method: 'POST', body: { title: '标题', html: '<p>正文</p>' }, headers: { Cookie: authCookie },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'MP_NOT_CONFIGURED');
    assert.match(r.json.error, /MP_APP_ID/);
    assert.match(r.json.error, /白名单/);

    const diag = await req('/api/_/mp-format/ip-diagnostic', { headers: { Cookie: authCookie } });
    assert.equal(diag.status, 400);
    assert.equal(diag.json.code, 'MP_NOT_CONFIGURED');
  });
});

test('sync-draft：正文缺失/超长返回 400（在联网之前拦下）', async () => {
  const empty = await req('/api/_/mp-format/sync-draft', {
    method: 'POST', body: { title: '标题' }, headers: { Cookie: authCookie },
  });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /正文 HTML/);

  const tooLong = await req('/api/_/mp-format/sync-draft', {
    method: 'POST', body: { title: '标题', html: 'x'.repeat(MAX_DRAFT_LENGTH + 1) }, headers: { Cookie: authCookie },
  });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.json.error, new RegExp(String(MAX_DRAFT_LENGTH)));
});
