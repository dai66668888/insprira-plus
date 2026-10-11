// P1-2 前端作业轮询（纯逻辑；取作业的函数由调用方注入 → node 可直接单测）
//
// 用法：
//   const { jobId } = await localApi('hot/sync/jobs', { method: 'POST', body: {} });
//   const job = await pollJob(() => localApi(`jobs/${jobId}`, { abortKey: 'hot-sync' }), {
//     onUpdate: latest => busy.setStage(jobProgressText(latest)),
//   });
//   // 终态才会返回：done → 返回 job；error → 抛错（e.job 带原始作业）
//
// 为什么单次失败不致命：切页/网络抖动会让某次轮询 404 或断连，但服务端作业还在跑，
// 因此容忍连续若干次失败；超过上限才放弃（此时提示用户稍后回来查看，而不是谎报失败）。
const DEFAULT_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 账号诊断要逐篇过 LLM，给足 15 分钟
const DEFAULT_MAX_ERRORS = 5;

// 一行进度文案：作业 message 是服务端给的人话，这里只补「(已做/总数)」
export function jobProgressText(job) {
  if (!job) return '';
  if (job.status === 'error') return job.message || job.error || '执行失败';
  if (job.status === 'done') return job.message || '已完成';
  const message = job.message || '进行中…';
  const done = Number(job.done) || 0;
  const total = Number(job.total) || 0;
  if (total > 0) return `${message}（${done}/${total}）`;
  if (done > 0) return `${message}（已完成 ${done} 项）`;
  return message;
}

function abortError() {
  const error = new Error('已取消');
  error.name = 'AbortError';
  return error;
}

// 可中断的等待：signal 触发时立刻以 AbortError 拒绝（不会留下悬挂定时器）
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const onAbort = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

export async function pollJob(fetchJob, options = {}) {
  const {
    onUpdate,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxErrors = DEFAULT_MAX_ERRORS,
    signal,
    isAbort = error => error?.name === 'AbortError',
    now = Date.now,
  } = options;
  const startedAt = now();
  let consecutiveErrors = 0;

  for (;;) {
    if (signal?.aborted) throw abortError();
    let job = null;
    try {
      job = await fetchJob();
      consecutiveErrors = 0;
    } catch (error) {
      if (isAbort(error)) throw error; // 用户取消/切页：立刻上抛，交给调用方提示
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxErrors) throw error;
    }

    if (job) {
      try { onUpdate?.(job); } catch { /* 渲染异常不影响轮询 */ }
      if (job.status === 'done') return job;
      if (job.status === 'error') {
        const error = new Error(job.error || job.message || '作业执行失败');
        error.job = job;
        throw error;
      }
    }

    if (timeoutMs >= 0 && now() - startedAt >= timeoutMs) {
      const error = new Error('等待超时：任务可能仍在后台执行，稍后可重新打开页面查看结果');
      error.timeout = true;
      throw error;
    }
    await delay(intervalMs, signal);
  }
}