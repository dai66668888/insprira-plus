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
