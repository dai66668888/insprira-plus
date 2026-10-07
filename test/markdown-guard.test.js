// ============= Markdown 解析护栏测试 =============
// 纯函数（js/core/markdown-guard.js），不依赖 server.js / 数据库 / marked，
// 因此 node --test test/markdown-guard.test.js 在没装 node_modules 时也能跑。
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let guard;

before(async () => {
  guard = await import('../js/core/markdown-guard.js');
});

test('① dataURL 图片抽成短占位符，回填后与原文完全一致', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(5000)}==`;
  const source = `![截图](${dataUrl})`;
  const { markdown, count, restore } = guard.extractDataUrls(source);
  assert.equal(count, 1);
  assert.equal(markdown.includes('base64'), false, '交给 marked 的文本里不应再有 base64');
  assert.equal(markdown, '![截图](wfdataimg0x)');
  assert.equal(restore(markdown), source, '渲染后必须能原样回填');
});

test('② 畸形图片标签：补右括号、alt 定界符转义、超长 alt 截断', () => {
  assert.equal(guard.repairImageLine('![图](https://e.com/a.png'), '![图](https://e.com/a.png)');
  assert.equal(
    guard.repairImageLine('![图*片_甲](https://e.com/a.png)'),
    '![图\\*片\\_甲](https://e.com/a.png)',
  );
  const longAlt = guard.repairImageLine(`![${'a'.repeat(500)}](u)`);
  assert.ok(longAlt.startsWith(`![${'a'.repeat(guard.MAX_IMAGE_ALT)}…](`), 'alt 应截断到上限并保留省略号');
  assert.ok(longAlt.endsWith('](u)'), '图片语法结构应保持完整');
  // 语法正常的图片不受影响（幂等）
  const normal = '![图一](https://e.com/1.png) ![图二](https://e.com/2.png)';
  assert.equal(guard.repairImageLine(normal), normal);
});

test('③ 超长定界符串被折叠为字面量，且不动代码', () => {
  const storm = '*'.repeat(50);
  const collapsed = guard.collapseDelimiterRuns(storm);
  assert.equal(/[*_~^=`]{9}/.test(collapsed), false, '不应留下 9 个以上未转义定界符');
  assert.equal(collapsed.replace(/\\/g, ''), storm, '可见字符不能丢');
  // 围栏代码块原样保留
  const fenced = `\`\`\`js\n${storm}\n\`\`\``;
  assert.equal(guard.collapseDelimiterRuns(fenced), fenced);
  // 行内代码原样保留
  const inline = `说明 \`${storm}\` 结束`;
  assert.equal(guard.collapseDelimiterRuns(inline), inline);
  // 链接/图片目标串里的定界符不动（URL 不能改）
  const url = `![图](https://e.com/${'*'.repeat(20)}.png)`;
  assert.equal(guard.collapseDelimiterRuns(url), url);
});

test('④ 引用/列表嵌套封顶，但可见字符全部保留', () => {
  const quotes = '>'.repeat(50) + ' x';
  const capped = guard.capBlockNesting(quotes);
  assert.ok(capped.startsWith('>'.repeat(guard.MAX_BLOCK_DEPTH) + '\\>'), `实际：${capped.slice(0, 20)}`);
  assert.equal(capped.replace(/\\/g, ''), quotes, '去掉转义符后应与原文一致');
  // 带空格的引用写法同样生效
  const spaced = '> '.repeat(30) + 'x';
  assert.equal(guard.capBlockNesting(spaced).replace(/\\/g, ''), spaced);
  // 列表缩进超限被裁到上限
  const deep = ' '.repeat(200) + '- 项';
  assert.equal(guard.capBlockNesting(deep), ' '.repeat(guard.MAX_LIST_INDENT) + '- 项');
  // 浅嵌套不动
  assert.equal(guard.capBlockNesting('> 一层引用\n\n- 普通列表'), '> 一层引用\n\n- 普通列表');
});

test('⑤ normalizeMarkdown 是「保守清洗」：正常文档逐字节不变', () => {
  const normal = [
    '# 标题一',
    '',
    '段落含 **加粗**、*斜体*、~~删除线~~、==高亮==、上标 x^10^、下标 N~13~ 与 `code`。',
    '',
    '> 引用一行',
    '',
    '- 列表项一',
    '- 列表项二',
    '',
    '| 表头A | 表头B |',
    '| --- | --- |',
    '| 甲 | 乙 |',
    '',
    '![图一](https://e.com/1.png) ![图二](https://e.com/2.png)',
    '',
    '```js',
    'const stars = "********";',
    '```',
    '',
  ].join('\n');
  assert.equal(guard.normalizeMarkdown(normal), normal);
  assert.equal(guard.normalizeMarkdown(''), '');
});

test('⑥ 纯文本降级：丢掉 dataURL、超长内容截断', () => {
  // 除 dataURL 外的原文逐字保留（用户能直接复制走），只把巨长的 base64 换成占位说明
  const text = guard.markdownToPlainText('![图](data:image/png;base64,AAAA)');
  assert.equal(text, '![图]([图片：dataURL 已省略])');
  assert.equal(text.includes('base64'), false);
  const truncated = guard.markdownToPlainText('x'.repeat(100), 10);
  assert.ok(truncated.startsWith('x'.repeat(10)));
  assert.match(truncated, /已截断显示/);
});

test('⑦ cleanParseError 剥掉 marked 的「Please report this to …」尾巴', () => {
  const err = new Error('Maximum call stack size exceeded\nPlease report this to https://github.com/markedjs/marked.');
  assert.equal(guard.cleanParseError(err), 'Maximum call stack size exceeded');
  assert.equal(guard.cleanParseError('随便一个错'), '随便一个错');
  assert.equal(guard.cleanParseError(null), '未知错误');
});

test('⑧ 被吞掉右括号的图片占位符会被补回来（否则整张图丢失）', () => {
  assert.equal(guard.repairPlaceholderImageSyntax('![图](#img-1'), '![图](#img-1)');
  assert.equal(guard.repairPlaceholderImageSyntax('![图](#img-12)\n\n正文'), '![图](#img-12)\n\n正文');
  assert.equal(guard.repairPlaceholderImageSyntax('![图](#img-1\n\n正文'), '![图](#img-1)\n\n正文');
  // 普通图片不做改动
  assert.equal(guard.repairPlaceholderImageSyntax('![图](https://e.com/a.png)'), '![图](https://e.com/a.png)');
});