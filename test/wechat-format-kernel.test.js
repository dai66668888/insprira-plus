// ============= 公众号排版内核测试（方案 §7） =============
// 引导：不经过 _helper.js（纯前端函数，不碰 server 与数据库）。
// 动态 import 浏览器 ESM 内核 —— js/package.json 声明 "type": "module" 后 Node 可直接加载；
// marked 用 npm 版（devDependencies，v15）注入，与 vendor/marked.min.js 同版本：
// 浏览器运行时用 vendor 那份 UMD，测试用 npm 这份，同一份内核代码两侧共享。
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { Marked, Renderer } = require('marked');

let engine;

before(async () => {
  const { makeEngine } = await import('../js/core/wechat-format/engine.js');
  engine = makeEngine({ Marked, Renderer });
});

// 覆盖全部元素类型的示例 Markdown（上游 sampleText 精简版）
const SAMPLE = [
  '# 标题一',
  '',
  '段落文字，包含 **加粗**、*斜体*、~~删除线~~、==高亮==、上标 x^10^、下标 N~13~、`行内代码` 和 [链接](https://example.com)。',
  '',
  '> 引用一行',
  '',
  '## 小节二',
  '',
  '- 无序一',
  '- 无序二',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '- [ ] 任务项',
  '',
  '### 小节三',
  '',
  '| 表头A | 表头B |',
  '| --- | --- |',
  '| 甲 | 乙 |',
  '',
  '![单图](https://example.com/a.png)',
  '',
  '![图一](https://example.com/1.png) ![图二](https://example.com/2.png)',
  '',
  '---',
  '',
  '```html',
  '<script>alert(1)</script>',
  '```',
  '',
  '结尾段落。',
].join('\n');

function tweaks(overrides = {}) {
  return { ...engine.DEFAULT_TWEAKS, ...overrides };
}

function render(markdown, templateId, overrides = {}) {
  const tpl = engine.allTemplates.find(t => t.id === templateId);
  assert.ok(tpl, `模板 ${templateId} 应存在`);
  return engine.renderArticle(markdown, tpl, tweaks(overrides));
}

test('① 模板总数 72，6 分类各 12，id 唯一', () => {
  assert.equal(engine.allTemplates.length, 72);
  assert.equal(engine.groupedTemplates.length, 6);
  for (const group of engine.groupedTemplates) {
    assert.equal(group.templates.length, 12, `分类 ${group.id} 应有 12 套模板`);
    for (const tpl of group.templates) assert.equal(tpl.category, group.id);
  }
  assert.equal(new Set(engine.allTemplates.map(t => t.id)).size, 72, '模板 id 应唯一');
});

test('② 产物零 class、零 <style>，样式全部内联在 style="，72 套全过', () => {
  for (const tpl of engine.allTemplates) {
    const html = engine.renderArticle(SAMPLE, tpl, tweaks());
    assert.equal(/class=/i.test(html), false, `${tpl.id} 不应出现 class 属性`);
    assert.equal(/<style[\s>]/i.test(html), false, `${tpl.id} 不应出现 <style> 标签`);
    assert.equal(/<input/i.test(html), false, `${tpl.id} 任务列表复选框应画成 section 而非 input`);
    assert.ok(html.includes('style="'), `${tpl.id} 应包含内联 style`);
    // 每个 <section> 开标签都必须带 style（微信粘贴剥样式时逐块兜底的前提）
    const nakedSection = /<section(?![^>]*\sstyle=)/i.exec(html);
    assert.equal(nakedSection, null, `${tpl.id} 存在无 style 的 section: ${nakedSection && nakedSection[0]}`);
  }
});

test('③ 标题三层 section 嵌套（普通块级与 inline-block 两分支）', () => {
  // 普通分支：minimalist-0 的 h1（外层 margin/text-align → 中层模板样式 → 内层重置）
  const h1 = render('# 标题一', 'minimalist-0');
  assert.match(h1, /<section style="margin: 24px 0 16px; text-align: center;">\s*<section style="[^"]+">\s*<section style="margin: 0; padding: 0; font-size: 1em; font-weight: inherit; line-height: 1.4; background: none; border: none; color: inherit;">\s*标题一\s*<\/section>/);
  // inline-block 分支：business-0 的 h2 自带 display: inline-block
  const h2 = render('## 小节二', 'business-0');
  assert.match(h2, /<section style="margin: 24px 0 16px 0; text-align: left;">\s*<section style="[^"]*display: inline-block; text-align: left;">\s*<section style="margin: 0; padding: 0; font-size: 1em;/);
});

test('④ 列表用 float 布局且带清浮动；有序/任务列表各自成结构', () => {
  const ul = render('- 无序一\n- 无序二', 'minimalist-0');
  assert.match(ul, /<section style="float: left; width: 24px; box-sizing: border-box;">/);
  assert.match(ul, /<section style="margin-left: 24px; box-sizing: border-box; overflow: hidden;">/);
  assert.match(ul, /<section style="display: block; clear: both; height: 0; line-height: 0; font-size: 0; overflow: hidden;"><\/section>/);
  // 有序：编号进图标位
  const ol = render('1. 有序一\n2. 有序二', 'minimalist-0');
  assert.match(ol, /<section style="display: inline-block; color: #3b82f6; font-weight: bold; font-family: sans-serif;">1\.<\/section>/);
  // 任务列表：复选框是内联 section（√ 与空框）
  const task = render('- [ ] 待办\n- [x] 完成', 'minimalist-0');
  assert.match(task, /border: 2px solid #000000; background-color: #ffffff; margin-top: 4px;/);
  assert.match(task, /background-color: #10b981; color: #000000; font-size: 10px; font-weight: bold; margin-top: 4px;/);
  assert.equal(/<input/i.test(task), false);
  // 新粗野风有序列表用 32px 方块编号
  const nb = render('1. 有序一', 'neo-brutalism-0');
  assert.match(nb, /<section style="float: left; width: 32px; box-sizing: border-box;">/);
  assert.match(nb, /background-color: #ff6f9f; color: #000000; border: 2px solid #000000; font-size: 12px; font-weight: 900;/);
});

test('⑤ 同段多图自动等分多排布局，单图走常规 img 样式', () => {
  const multi = render('![图一](https://example.com/1.png) ![图二](https://example.com/2.png)', 'minimalist-0');
  assert.match(multi, /<section style="text-align: center; margin: 0 0 16px 0; line-height: 0;">/);
  assert.match(multi, /display: inline-block; width: 48\.5%; padding: 0 4px; box-sizing: border-box; vertical-align: top;/);
  assert.match(multi, /<img[^>]*style="width: 100%; height: auto; object-fit: cover;/);
  const single = render('![单图](https://example.com/a.png)', 'minimalist-0');
  assert.match(single, /<img src="https:\/\/example\.com\/a\.png" alt="单图" style="[^"]*border-radius: 8px;/);
  assert.doesNotMatch(single, /width: 48\.5%/);
});

test('⑥ 表格带 cellpadding/cellspacing 归零与 td/th bgcolor 兜底', () => {
  const html = render('| 表头A | 表头B |\n| --- | --- |\n| 甲 | 乙 |', 'minimalist-0');
  assert.match(html, /<table cellpadding="0" cellspacing="0" border="0" style="/);
  assert.match(html, /<th bgcolor="#/);
  assert.match(html, /<td bgcolor="#/);
});

test('⑦ tweaks 全字段落到产物（字号/行高/段距/缩进/四向留白/字间距/圆角/对齐）', () => {
  const html = render('# 标题\n\n段落内容。', 'minimalist-0', {
    fontSize: 18,
    lineHeight: 2,
    paragraphSpacing: 30,
    firstLineIndent: true,
    pagePaddingTop: 10,
    pagePaddingRight: 11,
    pagePaddingBottom: 12,
    pagePaddingLeft: 13,
    letterSpacing: 1,
    imageRadius: 2,
    h1Layout: 'left',
  });
  assert.match(html, /font-size: 18px;/);
  assert.match(html, /padding: 10px 11px 12px 13px;/);
  assert.match(html, /line-height: 2;/);
  assert.match(html, /letter-spacing: 1px;/);
  assert.match(html, /text-indent: 2em;/);
  assert.match(html, /margin: 0 0 30px 0/);
  // imageRadius 覆盖单图圆角
  const img = render('![单图](https://example.com/a.png)', 'minimalist-0', { imageRadius: 2 });
  assert.match(img, /<img[^>]*style="[^"]*border-radius: 2px;/);
  // h1Layout 覆盖外层对齐
  assert.match(html, /<section style="margin: 24px 0 16px; text-align: left;">/);
  // h2Layout 覆盖：center 时外层 text-align: center
  const h2c = render('## 小节', 'business-0', { h2Layout: 'center' });
  assert.match(h2c, /<section style="margin: 24px 0 16px 0; text-align: center;">/);
});

test('⑧ 扩展语法 ==高亮== / ^上标^ / ~下标~', () => {
  const tpl = engine.allTemplates.find(t => t.id === 'minimalist-0');
  const html = engine.renderArticle('==高亮== 与 x^10^ 与 N~13~', tpl, tweaks());
  assert.match(html, /<mark style="background-color: rgba\(59, 130, 246, 0\.5\); color: inherit; padding: 0 2px;">高亮<\/mark>/);
  assert.match(html, /<sup>10<\/sup>/);
  assert.match(html, /<sub>13<\/sub>/);
});

test('⑨ 代码块实体转义 + Mac 三色圆点头部，<script> 不出现', () => {
  const html = render('```html\n<script>alert(1)</script>\n```', 'minimalist-0');
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<svg width="42" height="12" viewBox="0 0 42 12"/);
});

test('⑩ 六分类视觉基线快照（抽样锁回归）+ 自定义主题色重生成', () => {
  const baseline = {
    'neo-brutalism-0': ['#ff6f9f', '#ffffff', 'box-shadow: 8px 8px 0px #000000'],
    'minimalist-0': ['#3b82f6', '#ffffff', 'border-left: 4px solid #3b82f6'],
    'business-0': ['#1e40af', '#ffffff', 'border-bottom: 3px solid #1e40af'],
    'literary-0': ['#059669', '#fdfcfb', 'letter-spacing: 4px'],
    'tech-0': ['#2563eb', '#0f172a', 'border-left: 6px solid #2563eb'],
    'festive-0': ['#ef4444', '#fffbeb', 'border: 4px solid #ef4444'],
  };
  for (const [id, [themeColor, backgroundColor, fragment]] of Object.entries(baseline)) {
    const html = render('# 标题\n\n## 小节\n\n段落。', id);
    assert.ok(html.includes(themeColor), `${id} 应包含主题色 ${themeColor}`);
    assert.ok(html.includes(backgroundColor), `${id} 应包含底色 ${backgroundColor}`);
    assert.ok(html.includes(fragment), `${id} 应包含基线样式片段 ${fragment}`);
  }
  // 自定义主题色：按分类整体重生成，旧色不应残留
  const themed = render('# 标题\n\n## 小节', 'minimalist-0', { themeColor: '#123456' });
  assert.ok(themed.includes('border-left: 4px solid #123456'));
  assert.doesNotMatch(themed, /#3b82f6/);
});

test('DEFAULT_TWEAKS 与方案 §5.1 约定一致', () => {
  assert.deepEqual(engine.DEFAULT_TWEAKS, {
    fontSize: 15,
    lineHeight: 1.8,
    paragraphSpacing: 16,
    firstLineIndent: false,
    pagePaddingTop: 24,
    pagePaddingRight: 24,
    pagePaddingBottom: 24,
    pagePaddingLeft: 24,
    letterSpacing: 0,
    imageRadius: 8,
    themeColor: '',
    h1Layout: 'center',
    h2Layout: 'left',
  });
});

// ============= ⑪-⑭ 防爆栈护栏回归 =============
// 修复前的表现：页面报
//   「渲染失败：Maximum call stack size exceeded Please report this to https://github.com/markedjs/marked.」
// 那句尾巴是 marked 的 Marked.onError 给任何解析期异常加的，真实原因是 V8 调用栈耗尽。

test('⑪ 定界符风暴与超深引用不再爆栈（本次 bug 的直接回归）', () => {
  // 行内：几千对 ** 会让 Parser.parseInline 逐层递归
  const storm = render(
    `![图](https://example.com/a.png)\n\n${'**'.repeat(4000)}x${'**'.repeat(4000)}`,
    'minimalist-0',
  );
  assert.ok(storm.includes('<img src="https://example.com/a.png"'), '图片仍应正常渲染');
  assert.ok(storm.includes('x'), '文字内容不能丢');
  // 块级：单行几千个 > 会让 Lexer.blockTokens 递归
  const quotes = render(`${'>'.repeat(20000)} x`, 'minimalist-0');
  assert.ok(quotes.length > 0);
});

test('⑫ 畸形图片标签（未闭合 / URL 与 alt 含定界符）被修好而不是漏回正文', () => {
  const unclosed = render('![图](https://example.com/a.png', 'minimalist-0');
  assert.match(unclosed, /<img src="https:\/\/example\.com\/a\.png"/, '未闭合图片应补上右括号后正常渲染');
  const dirty = render(`![图*片](https://example.com/${'*'.repeat(2000)}.png)`, 'minimalist-0');
  assert.match(dirty, /<img src="https:\/\/example\.com\//, 'URL 里的定界符不应破坏图片');
  assert.ok(dirty.includes('alt="图*片"'), `alt 转义后展示应保持原文：${dirty.slice(0, 200)}`);
});

test('⑬ dataURL 图片不进解析器，产物仍回填完整 dataURL', async () => {
  const { makeEngine } = await import('../js/core/wechat-format/engine.js');
  const seen = [];
  // 记录真正交给 marked.parse 的源码（构造函数返回对象可覆盖 new 的结果）
  function SpyMarked(...args) {
    const instance = new Marked(...args);
    const originalParse = instance.parse;
    instance.parse = (src, opts) => {
      seen.push(src);
      return originalParse.call(instance, src, opts);
    };
    return instance;
  }
  const spyEngine = makeEngine({ Marked: SpyMarked, Renderer });
  const tpl = spyEngine.allTemplates.find(t => t.id === 'minimalist-0');
  const dataUrl = `data:image/png;base64,${'A'.repeat(4096)}==`;
  const html = spyEngine.renderArticle(`![截图](${dataUrl})`, tpl, { ...spyEngine.DEFAULT_TWEAKS });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].includes('base64'), false, 'marked 不应看到 dataURL（几百 KB 的无断点 token）');
  assert.ok(html.includes(dataUrl), '渲染产物必须回填完整 dataURL');
  assert.match(html, /alt="截图"/);
});

test('⑭ renderArticleSafe 解析异常时降级纯文本，不抛异常、不显示 marked 的尾巴', async () => {
  const { makeEngine } = await import('../js/core/wechat-format/engine.js');
  const MARKED_TAIL = 'Maximum call stack size exceeded\nPlease report this to https://github.com/markedjs/marked.';
  function ThrowingMarked() {
    const instance = new Marked();
    instance.parse = () => { throw new RangeError(MARKED_TAIL); };
    return instance;
  }
  const safeEngine = makeEngine({ Marked: ThrowingMarked, Renderer });
  const tpl = safeEngine.allTemplates.find(t => t.id === 'minimalist-0');

  const degraded = safeEngine.renderArticleSafe('# 标题\n\n正文段落。', tpl, { ...safeEngine.DEFAULT_TWEAKS });
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.reason, 'Maximum call stack size exceeded', '应剥掉 marked 追加的尾巴');
  assert.ok(degraded.html.includes('# 标题'), '降级产物要保留原文');
  assert.equal(degraded.html.includes('markedjs/marked'), false);

  // 正常输入不降级
  const ok = engine.renderArticleSafe('正文段落。', engine.allTemplates.find(t => t.id === 'minimalist-0'), tweaks());
  assert.equal(ok.degraded, false);
  assert.equal(ok.reason, '');
});
