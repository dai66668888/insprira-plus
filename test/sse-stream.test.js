// P1-1 流式工具纯函数单测（不依赖 DB/DOM，宿主无 node_modules 也能跑）：
// ① lib/sse.js 服务端帧编码；
// ② js/stream.js 前端帧解析（parseSseFrames）；
// ③ js/stream.js 局部 JSON 字段抽取（extractPartialJsonField）。
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { sseFrame, sseComment, SSE_HEARTBEAT_MS } = require('../lib/sse');

let parseSseFrames;
let extractPartialJsonField;

before(async () => {
  ({ parseSseFrames, extractPartialJsonField } = await import('../js/stream.js'));
});

test('① sseFrame 输出规范格式，data 保持单行 JSON', () => {
  assert.equal(sseFrame('delta', { content: '你好' }), 'event: delta\ndata: {"content":"你好"}\n\n');
  // data 里的真实换行必须被转义成 \n —— 否则 SSE 规范要求多个 data: 前缀，容易被中间层拆坏
  const frame = sseFrame('delta', { content: 'a\nb' });
  assert.equal(frame.split('\n').filter(line => line.startsWith('data:')).length, 1);
  assert.match(frame, /a\\nb/);
});

test('① sseFrame 剔除事件名里的换行，缺省事件名为 message', () => {
  assert.equal(sseFrame('bad\nname', {}), 'event: badname\ndata: {}\n\n');
  assert.equal(sseFrame('', null), 'event: message\ndata: null\n\n');
});

test('① sseComment 是客户端会忽略的注释帧，心跳间隔为正数', () => {
  assert.equal(sseComment(), ': keep-alive\n\n');
  assert.equal(sseComment('a\nb'), ': a b\n\n');
  assert.ok(SSE_HEARTBEAT_MS > 0);
});

test('② parseSseFrames 切出多帧，未闭合部分留在 rest 并可回喂续接', () => {
  const chunk = 'event: start\ndata: {"a":1}\n\nevent: delta\ndata: {"content":"x"}\n\nevent: del';
  const { frames, rest } = parseSseFrames(chunk);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], { event: 'start', data: { a: 1 } });
  assert.deepEqual(frames[1], { event: 'delta', data: { content: 'x' } });
  assert.equal(rest, 'event: del');
  const next = parseSseFrames(rest + 'ta\ndata: {"content":"y"}\n\n');
  assert.equal(next.rest, '');
  assert.deepEqual(next.frames[0], { event: 'delta', data: { content: 'y' } });
});

test('② 心跳注释块/空行不产生事件，CRLF 同样解析', () => {
  const { frames } = parseSseFrames(': keep-alive\r\n\r\nevent: delta\r\ndata: {"content":"ok"}\r\n\r\n');
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], { event: 'delta', data: { content: 'ok' } });
  assert.deepEqual(parseSseFrames(': ping\n\n').frames, []);
});

test('② 无 event 字段按 message 处理，非 JSON data 原样透传', () => {
  const { frames } = parseSseFrames('data: 纯文本\n\ndata: {"n":1}\n\n');
  assert.deepEqual(frames[0], { event: 'message', data: '纯文本' });
  assert.deepEqual(frames[1], { event: 'message', data: { n: 1 } });
});

test('③ extractPartialJsonField 取出已闭合与未闭合的字段', () => {
  assert.equal(extractPartialJsonField('{"title":"标题","intro":"前言","content":"正文"}', 'content'), '正文');
  const partial = '{"title":"标题","intro":"前言","content":"正文还在';
  assert.equal(extractPartialJsonField(partial, 'content'), '正文还在');
  assert.equal(extractPartialJsonField(partial, 'intro'), '前言');
  assert.equal(extractPartialJsonField(partial, 'missing'), '');
});

test('③ extractPartialJsonField 解转义，且半截转义不吐出残缺字符', () => {
  assert.equal(extractPartialJsonField('{"content":"第一行\\n第二行"}', 'content'), '第一行\n第二行');
  assert.equal(extractPartialJsonField('{"content":"引号\\"与反斜杠\\\\"}', 'content'), '引号"与反斜杠\\');
  assert.equal(extractPartialJsonField('{"content":"\\u4f60\\u597d"}', 'content'), '你好');
  // 帧截断在转义中间：只返回已确定的部分，等下一帧补齐（不会出现半个汉字）
  assert.equal(extractPartialJsonField('{"content":"abc\\', 'content'), 'abc');
  assert.equal(extractPartialJsonField('{"content":"abc\\u4f', 'content'), 'abc');
});

test('③ extractPartialJsonField 跳过正文里的同名字面量', () => {
  const tricky = '{"content":"文章里写了 \\"content\\":\\"x\\" 这个词，正文继续"}';
  assert.equal(extractPartialJsonField(tricky, 'content'), '文章里写了 "content":"x" 这个词，正文继续');
});

test('③ extractPartialJsonField 容忍前置说明文字/空输入/空字段名', () => {
  const noisy = '好的，以下是成稿：\n{"title":"t","content":"正文"}\n希望有帮助';
  assert.equal(extractPartialJsonField(noisy, 'content'), '正文');
  assert.equal(extractPartialJsonField('', 'content'), '');
  assert.equal(extractPartialJsonField('{"content":"x"}', ''), '');
  // 字段名出现在值里但后面没有冒号+引号 → 不算命中
  assert.equal(extractPartialJsonField('{"content":"提到 content 但要取 intro"}', 'intro'), '');
});