// ============= 前端 renderMarkdown 兜底测试 =============
// 不经过 server.js / 数据库：用 vendor/marked.min.js（与浏览器同一份 UMD，v15）
// 伪造 window/marked/DOMPurify 全局，验证 js/utils.js 的解析护栏与降级分支：
//   ① 定界符风暴不再抛「Maximum call stack size exceeded」；
//   ② dataURL 图片渲染后原样回填；
//   ③ marked 抛异常时降级为 <pre> 纯文本（转义后），绝不上抛。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const marked = require('../vendor/marked.min.js');

let renderMarkdown;

before(async () => {
  // 模拟 index.html 里 <script src="vendor/marked.min.js"> 之后的浏览器全局
  globalThis.window = { marked, DOMPurify: { sanitize: (html) => html } };
  globalThis.marked = marked;
  globalThis.DOMPurify = globalThis.window.DOMPurify;
  ({ renderMarkdown } = await import('../js/utils.js'));
});

after(() => {
  delete globalThis.window;
  delete globalThis.marked;
  delete globalThis.DOMPurify;
});

test('① 定界符风暴（修复前必爆栈）现在能正常渲染', () => {
  const html = renderMarkdown(`${'**'.repeat(4000)}x${'**'.repeat(4000)}`);
  assert.ok(html.length > 0);
  assert.equal(html.includes('Maximum call stack'), false);
});

test('② dataURL 图片渲染后回填完整 URL，marked 只见到短占位符', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(2048)}==`;
  const html = renderMarkdown(`![截图](${dataUrl})`);
  assert.ok(html.includes(dataUrl), '产物必须回填 dataURL');
  assert.match(html, /alt="截图"/);
});

test('③ marked 抛解析异常时降级为转义后的纯文本', () => {
  const original = { marked: globalThis.marked, windowMarked: globalThis.window.marked };
  const boom = 'Maximum call stack size exceeded\nPlease report this to https://github.com/markedjs/marked.';
  const stub = { parse: () => { throw new RangeError(boom); } };
  globalThis.marked = stub;
  globalThis.window.marked = stub;
  try {
    const html = renderMarkdown('# 标题\n\n<script>alert(1)</script>');
    assert.match(html, /^<pre class="whitespace-pre-wrap">/);
    assert.equal(html.includes('<script>'), false, '降级输出必须实体转义');
    assert.ok(html.includes('# 标题'), '原文要保留，方便用户复制');
  } finally {
    globalThis.marked = original.marked;
    globalThis.window.marked = original.windowMarked;
  }
});

test('④ 空内容与正常内容行为不变', () => {
  assert.equal(renderMarkdown(''), '<p class="text-gray-500">（无内容）</p>');
  assert.match(renderMarkdown('**加粗**'), /<strong>加粗<\/strong>/);
});