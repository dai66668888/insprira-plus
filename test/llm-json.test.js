// lib/llm.js parseLlmJson 容错单测：模型常把真实换行直接写进 JSON 字符串，
// 必须先按「字符串内部」转义为合法序列再解析，否则整篇已生成内容会因
// "Bad control character in string literal" 作废（见 POST /api/_/rewrite 线上报错）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 与其他测试一致：DATA_DIR 指到临时目录，避免 lib/db 落到真实 data/cache.db
const TMP_DATA_DIR = path.join(os.tmpdir(), `insprira-llmjson-test-${process.pid}`);
fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
process.env.DATA_DIR = TMP_DATA_DIR;
process.env.ENABLE_SCHEDULER = 'false';
process.env.ENV_FILE_PATH = path.join(TMP_DATA_DIR, '.env.test-absent');

const { parseLlmJson } = require('../lib/llm');

test('字符串内的裸换行/回车/tab 被转义后解析成功', () => {
  const raw = '{"title":"Swisse铅超标","intro":"第一段' + '\n\n' + '第二段","content":"a\tb\r\nc"}';
  const out = parseLlmJson(raw);
  assert.equal(out.title, 'Swisse铅超标');
  assert.equal(out.intro, '第一段\n\n第二段');
  assert.equal(out.content, 'a\tb\r\nc');
});

test('已转义的字面量（\\n / \\" / \\\\）不会被二次转义', () => {
  const raw = '{"content":"他说：\\"别慌\\"，路径 C:\\\\tmp\\n下一行"}';
  const out = parseLlmJson(raw);
  assert.equal(out.content, '他说："别慌"，路径 C:\\tmp\n下一行');
});

test('反斜杠后紧跟裸换行（非法转义）按换行修复', () => {
  const raw = '{"a":"x' + '\\' + '\n' + 'y"}';
  assert.equal(parseLlmJson(raw).a, 'x\ny');
});

test('超长中文正文（含多个空行）不再因控制字符整体失败', () => {
  const body = Array.from({ length: 12 }, (_, i) => `第${i + 1}段：` + '这是一段用于模拟模型输出的中文正文，'.repeat(4)).join('\n\n');
  assert.ok(body.length > 500);
  const out = parseLlmJson('{"title":"标题","intro":"前言","content":"' + body + '"}');
  assert.equal(out.content, body);
  assert.equal(out.title, '标题');
  assert.equal(out.intro, '前言');
});

test('合法 JSON（字符串外换行/缩进）行为不变', () => {
  const out = parseLlmJson('{\n  "a": "x",\n  "b": [1, 2]\n}');
  assert.deepEqual(out, { a: 'x', b: [1, 2] });
});

test('代码围栏 + 前缀说明 + 裸换行混用仍能解析', () => {
  const raw = '以下是改写结果：\n```json\n{"title":"t","content":"第一行\n第二行"}\n```';
  const out = parseLlmJson(raw);
  assert.equal(out.content, '第一行\n第二行');
});

test('真正的坏 JSON 仍报错，不做过度修复', () => {
  assert.throws(() => parseLlmJson('{"a":1,}'), /JSON 解析失败/);
  assert.throws(() => parseLlmJson('{"a": "x'), /JSON 解析失败/);
  assert.throws(() => parseLlmJson('   '), /LLM 返回内容为空/);
});

test('裸换行 + 截断：先转义再按截断逻辑报错，而非误报控制字符', () => {
  assert.throws(
    () => parseLlmJson('{"title":"t","content":"第一行' + '\n' + '第二行'),
    (err) => err.message.startsWith('JSON 解析失败')
      && !/Bad control character|control character/i.test(err.message),
  );
});