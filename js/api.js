import { API_CONF } from './config.js';
import { parseSseFrames } from './stream.js';

let unauthorizedHandler = null;
const controllers = new Map();

export function cancelApi(key) {
  const c = controllers.get(key);
  if (c) { c.abort(); controllers.delete(key); }
}

export function cancelAllApi() {
  controllers.forEach(c => c.abort());
  controllers.clear();
}

// 区分「用户取消 / 切页中断」与真实失败：abortKey 或外部 signal 触发时 fetch 抛 AbortError。
// 页面据此提示「已取消」而不是把中断当异常报错，也不覆盖已有结果。
export function isAbortError(error) {
  return Boolean(error) && error.name === 'AbortError';
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

function handleUnauthorized() {
  if (unauthorizedHandler) {
    unauthorizedHandler();
  } else {
    location.hash = '#login';
  }
}

async function parseResponse(response) {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(text || `服务端返回非 JSON（HTTP ${response.status}）`);
  }
  return response.json();
}

export class ApiError extends Error {
  constructor(message, { status, code, endpoint } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

export async function api(endpoint, body = {}, options = {}) {
  const conf = API_CONF[endpoint];
  if (!conf) throw new ApiError(`未知 API 端点: ${endpoint}`, { endpoint });
  const { signal, abortKey } = options;
  let abortSignal = signal;
  let ownedController = null;
  if (abortKey) {
    cancelApi(abortKey);
    ownedController = new AbortController();
    controllers.set(abortKey, ownedController);
    abortSignal = signal ? AbortSignal.any([signal, ownedController.signal]) : ownedController.signal;
  }
  const releaseController = () => {
    if (abortKey && controllers.get(abortKey) === ownedController) controllers.delete(abortKey);
  };
  try {
    const r = await fetch('/api/' + conf.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: conf.source, ...body }),
      signal: abortSignal,
    });
    releaseController();
    if (r.status === 401) {
      handleUnauthorized();
      throw new ApiError('登录已过期，请重新登录', { status: 401, endpoint });
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new ApiError(`请求失败（HTTP ${r.status}）${text ? ': ' + text : ''}`, { status: r.status, endpoint });
    }
    const j = await r.json();
    if (![200, 2000].includes(j.code)) {
      throw new ApiError(j.message || `业务错误（code ${j.code}）`, { code: j.code, endpoint });
    }
    return j.data;
  } catch (e) {
    releaseController();
    if (e.name === 'AbortError') throw e;
    if (e instanceof ApiError) throw e;
    throw new ApiError(`网络错误: ${e.message}`, { endpoint });
  }
}

export async function localApi(path, options = {}) {
  const { method = 'GET', body, signal, abortKey } = options;
  let response;
  let abortSignal = signal;
  let ownedController = null;
  if (abortKey) {
    cancelApi(abortKey);
    ownedController = new AbortController();
    controllers.set(abortKey, ownedController);
    abortSignal = signal ? AbortSignal.any([signal, ownedController.signal]) : ownedController.signal;
  }
  const releaseController = () => {
    if (abortKey && controllers.get(abortKey) === ownedController) controllers.delete(abortKey);
  };
  try {
    response = await fetch('/api/_/' + path.replace(/^\/+/, ''), {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: abortSignal,
    });
    releaseController();
  } catch (e) {
    releaseController();
    if (e.name === 'AbortError') throw e;
    throw new Error(`网络错误: ${e.message}`);
  }

  if (response.status === 401) {
    const payload = await parseResponse(response).catch(() => null);
    const isLoginRequest = path.replace(/^\/+/, '') === 'login';
    if (!isLoginRequest) handleUnauthorized();
    throw new Error(payload?.error || (isLoginRequest ? '用户名或密码错误' : '登录已过期，请重新登录'));
  }

  const payload = await parseResponse(response);
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `本地服务请求失败（HTTP ${response.status}）`);
  }
  return unwrapLocalPayload(payload);
}

// P1-1：SSE 流式本地接口。与 localApi 共用 abortKey/controllers（取消按钮可中断连接），
// 逐帧回调 onEvent({ event, data })，返回 done 帧拆信封后的结果。
// 非 2xx、非 text/event-stream（端点不存在/被中间层降级）都直接抛错，交由调用方回落整包接口。
export async function localApiStream(path, options = {}) {
  const { method = 'POST', body, signal, abortKey, onEvent } = options;
  let abortSignal = signal;
  let ownedController = null;
  if (abortKey) {
    cancelApi(abortKey);
    ownedController = new AbortController();
    controllers.set(abortKey, ownedController);
    abortSignal = signal ? AbortSignal.any([signal, ownedController.signal]) : ownedController.signal;
  }
  const releaseController = () => {
    if (abortKey && controllers.get(abortKey) === ownedController) controllers.delete(abortKey);
  };
  let response;
  try {
    response = await fetch('/api/_/' + path.replace(/^\/+/, ''), {
      method,
      credentials: 'include',
      headers: { Accept: 'text/event-stream', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: abortSignal,
    });
  } catch (e) {
    releaseController();
    if (e.name === 'AbortError') throw e;
    throw new Error(`网络错误: ${e.message}`);
  }
  if (response.status === 401) {
    releaseController();
    handleUnauthorized();
    throw new Error('登录已过期，请重新登录');
  }
  const contentType = response.headers.get('Content-Type') || '';
  if (!response.ok || !contentType.includes('text/event-stream')) {
    releaseController();
    const text = await response.text().catch(() => '');
    throw new Error(text || `流式接口不可用（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload = null;
  let failure = null;
  const dispatch = frames => {
    for (const frame of frames) {
      if (onEvent) { try { onEvent(frame); } catch { /* 渲染异常不中断读取 */ } }
      if (frame.event === 'done') donePayload = frame.data;
      else if (frame.event === 'error') failure = new Error(frame.data?.error || '生成失败');
      else if (frame.event === 'cancelled' && !failure) failure = Object.assign(new Error('已取消生成'), { name: 'AbortError' });
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseFrames(buffer);
      buffer = parsed.rest;
      dispatch(parsed.frames);
    }
    const tail = decoder.decode();
    if (tail) buffer += tail;
    dispatch(parseSseFrames(buffer).frames);
  } finally {
    releaseController();
  }
  if (failure) throw failure;
  if (!donePayload) throw new Error('流式连接中断（未收到完成事件）');
  if (!donePayload.ok || donePayload.error) throw new Error(donePayload.error || '生成失败');
  return unwrapLocalPayload(donePayload);
}

// 拆掉 { ok, data } 信封并透传约定好的顶层元数据。
// 无 data 包装的端点（/version /status /redfox/apply /stats 等）原样返回整个 payload；
// 注意：hot/list 类端点必须用 { data: hotListPayload(...) }，不能用 spread，
// 否则这里会把数组当 data 拆走，丢失 sourceMode/dataDate/cronExpr 等元数据。
function unwrapLocalPayload(payload) {
  if (payload.data === undefined) return payload;

  const data = payload.data;
  if (payload.stale !== undefined) data.stale = payload.stale;
  if (payload.snapshotDate !== undefined) data.snapshotDate = payload.snapshotDate;
  if (payload.capturedAt !== undefined) data.capturedAt = payload.capturedAt;
  if (payload.syncedAt !== undefined) data.syncedAt = payload.syncedAt;
  // 注意：需要透传给前端的**顶层**字段必须列在这里，否则只返回 payload.data 会被丢掉。
  // deduplicated 是服务端 single-flight 的命中标记（lib/single-flight.js）。
  ['sourceMode', 'sourceLabel', 'dataDate', 'expectedDate', 'latestAttempt', 'analyzed',
    'cronEnabled', 'cronExpr', 'lastRun', 'deduplicated'].forEach(key => {
    if (payload[key] !== undefined) data[key] = payload[key];
  });
  return data;
}
