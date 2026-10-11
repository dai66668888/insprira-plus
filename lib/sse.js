// 服务端 SSE（text/event-stream）输出：帧编码 + 响应头 + 心跳
// 帧编码是纯函数（可单测）；res 相关封装只在路由里调用。
// 用途：P1-1 把 LLM 增量实时推给前端 —— 长文创作几十秒的"黑箱等待"变成可见进度。

// 心跳间隔：反向代理与 Docker 常按空闲时长掐连接，定期发一行注释保活
const SSE_HEARTBEAT_MS = 15000;

// 单帧编码：event + JSON data。
// data 一律编码成单行 JSON（内部换行由 JSON.stringify 转义为 \n），
// 因为 SSE 规范里多行 data 需要每个换行前都加 data: 前缀，单行最不容易被中间层破坏。
function sseFrame(event, data) {
  const name = String(event || 'message').replace(/[\r\n]/g, '');
  return `event: ${name}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
}

// 注释帧（心跳）：形如 ": keep-alive\n\n"，客户端解析器会静默忽略
function sseComment(text = 'keep-alive') {
  return `: ${String(text).replace(/[\r\n]/g, ' ')}\n\n`;
}

// 写流式响应头。
// X-Accel-Buffering: no 是关键：Nginx 默认会缓冲整个响应体，缓冲后前端要等全部生成完
// 才一次收到，流式退化成整包；Cache-Control 的 no-transform 同理防止中间层改写。
function initSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

// 启动心跳，返回 stop()。写失败（对端已断开）时自行停止，避免定时器空转。
function startSseHeartbeat(res, intervalMs = SSE_HEARTBEAT_MS) {
  const timer = setInterval(() => {
    try {
      res.write(sseComment());
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

module.exports = { SSE_HEARTBEAT_MS, sseFrame, sseComment, initSse, startSseHeartbeat };