// lib/llm-stream.js SSE 聚合纯函数单测：content/reasoning 累积、tool_calls 分片、跨 chunk 截断行、脏数据容忍
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createStreamState, absorbSseLine, feedSse, flushSse, toStreamMessage, takeDelta,
} = require('../lib/llm-stream');

test('content 逐 chunk 累积，[DONE] 结束', () => {
  const s = createStreamState();
  feedSse(s, 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
  feedSse(s, 'data: {"choices":[{"delta":{"content":"，世界"},"finish_reason":null}]}\n');
  feedSse(s, 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n');
  feedSse(s, 'data: [DONE]\n');
  flushSse(s);
  assert.equal(s.content, '你好，世界');
  assert.equal(s.finishReason, 'stop');
  assert.equal(s.done, true);
});

test('跨 chunk 截断的行能正确缓冲拼接', () => {
  const s = createStreamState();
  feedSse(s, 'data: {"choices":[{"del');
  feedSse(s, 'ta":{"content":"片段A"}}]}\ndata: {"choi');
  feedSse(s, 'ces":[{"delta":{"content":"片段B"}}]}\n');
  flushSse(s);
  assert.equal(s.content, '片段A片段B');
});

test('reasoning_content 单独累积，不混入 content', () => {
  const s = createStreamState();
  feedSse(s, 'data: {"choices":[{"delta":{"reasoning_content":"先想一下"}}]}\n');
  feedSse(s, 'data: {"choices":[{"delta":{"reasoning_content":"再动笔"}}]}\n');
  feedSse(s, 'data: {"choices":[{"delta":{"content":"最终答案"}}]}\n');
  flushSse(s);
  assert.equal(s.content, '最终答案');
  assert.equal(s.reasoning, '先想一下再动笔');
});

test('tool_calls 分片按 index 拼接 name 与 arguments', () => {
  const s = createStreamState();
  feedSse(s, 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"web_search","arguments":""}}]}}]}\n');
  feedSse(s, 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":"}}]}}]}\n');
  feedSse(s, 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"AI\\"}"}}]}}]}\n');
  flushSse(s);
  const msg = toStreamMessage(s);
  assert.equal(msg.tool_calls.length, 1);
  assert.equal(msg.tool_calls[0].id, 'call_1');
  assert.equal(msg.tool_calls[0].function.name, 'web_search');
  assert.equal(msg.tool_calls[0].function.arguments, '{"query":"AI"}');
});

test('注释心跳行、空行、非 JSON data 行、CRLF 均被容忍', () => {
  const s = createStreamState();
  feedSse(s, ': keep-alive\r\n\r\ndata: not-json\r\ndata: {"choices":[{"delta":{"content":"ok"}}]}\r\n');
  flushSse(s);
  assert.equal(s.content, 'ok');
});

test('顶层 usage 被捕获', () => {
  const s = createStreamState();
  feedSse(s, 'data: {"choices":[{"delta":{"content":"x"}}],"usage":{"total_tokens":10}}\n');
  flushSse(s);
  assert.equal(s.usage.total_tokens, 10);
});

test('toStreamMessage 无工具时不带 tool_calls 字段', () => {
  const s = createStreamState();
  feedSse(s, 'data: {"choices":[{"delta":{"content":"纯文本"}}]}\n');
  flushSse(s);
  const msg = toStreamMessage(s);
  assert.equal(msg.role, 'assistant');
  assert.equal(msg.content, '纯文本');
  assert.equal('tool_calls' in msg, false);
});

test('absorbSseLine 单行处理与空状态安全', () => {
  const s = createStreamState();
  absorbSseLine(s, '');
  absorbSseLine(s, null);
  absorbSseLine(s, ':');
  absorbSseLine(s, 'data:');
  assert.equal(s.content, '');
  absorbSseLine(s, 'data: {"choices":[{"delta":{"content":"a"}}]}');
  assert.equal(s.content, 'a');
});

test('takeDelta 只给新增片段，游标可连续推进（P1-1 流式透传）', () => {
  const s = createStreamState();
  let cursor = { content: 0, reasoning: 0 };
  feedSse(s, 'data: {"choices":[{"delta":{"content":"第一段"}}]}\n');
  let step = takeDelta(s, cursor);
  assert.equal(step.delta.content, '第一段');
  cursor = step.cursor;
  feedSse(s, 'data: {"choices":[{"delta":{"content":"第二段"}}]}\n');
  step = takeDelta(s, cursor);
  assert.equal(step.delta.content, '第二段', '第二次只应给出新增部分，不重复推全量');
  assert.equal(step.delta.reasoning, '');
  cursor = step.cursor;
  // 没有新内容时给出空片段：调用方据此跳过空帧
  step = takeDelta(s, cursor);
  assert.deepEqual(step.delta, { content: '', reasoning: '' });
  assert.deepEqual(step.cursor, { content: 6, reasoning: 0 });
});

test('takeDelta 把 reasoning 与 content 分开，缺省游标从 0 起算', () => {
  const s = createStreamState();
  feedSse(s, 'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}\n');
  feedSse(s, 'data: {"choices":[{"delta":{"content":"再写"}}]}\n');
  const { delta } = takeDelta(s);
  assert.deepEqual(delta, { content: '再写', reasoning: '先想' });
});
