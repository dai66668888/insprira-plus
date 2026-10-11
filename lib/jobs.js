// 长任务作业化（P1-2）：把「点一下要等几十秒」的同步/诊断改成
// 「提交即返回 jobId + 轮询拿进度」，HTTP 请求不再长时间挂住（验收 G1）。
//
// 设计取舍：
// 1. 纯内存 Map，**不落库** —— 作业是「这次点击」的上下文，进程重启即丢是可接受的；
//    同时避免把状态塞进 local_data 造成无限增长（计划里点名的风险）。
// 2. 终态作业保留 ttlMs（默认 30 分钟）供前端回看，之后 prune；另有 maxJobs 兜底。
// 3. now / idFactory 可注入 —— 过期、上限、并发判定因此都能离线单测。
const crypto = require('crypto');

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_JOBS = 50;

function makeJobStore({ ttlMs = DEFAULT_TTL_MS, maxJobs = DEFAULT_MAX_JOBS, now = Date.now, idFactory } = {}) {
  const jobs = new Map();
  const newId = idFactory || (() => crypto.randomBytes(8).toString('hex'));

  // 清理：过期终态 + 超过上限时从最旧的终态作业开始丢。运行中的作业永不清理（它还要写回自己）。
  function prune() {
    const t = now();
    for (const [id, job] of jobs) {
      if (job.status === 'running') continue;
      const endedAt = job.completedAt || job.startedAt;
      if (t - endedAt > ttlMs) jobs.delete(id);
    }
    if (jobs.size > maxJobs) {
      const finished = [...jobs.values()]
        .filter(job => job.status !== 'running')
        .sort((a, b) => a.startedAt - b.startedAt);
      for (const job of finished) {
        if (jobs.size <= maxJobs) break;
        jobs.delete(job.id);
      }
    }
  }

  function create({ kind = 'task', message = '', total = 0, meta = {} } = {}) {
    prune();
    const job = {
      id: newId(),
      kind,
      status: 'running', // running | done | error
      message,
      meta,
      done: 0,
      total,
      items: [],         // 逐项进度（如每个平台的同步结果）
      result: null,      // 终态产物（同步汇总 / 诊断报告）
      error: null,
      startedAt: now(),
      completedAt: null,
    };
    jobs.set(job.id, job);
    return job;
  }

  function get(id) {
    prune();
    return jobs.get(String(id || '')) || null;
  }

  function list() {
    prune();
    return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  function findRunning(predicate = () => true) {
    prune();
    return [...jobs.values()].find(job => job.status === 'running' && predicate(job)) || null;
  }

  // 局部更新：id / startedAt 不可被覆盖（防止 update 意外改写身份）
  function update(id, patch = {}) {
    const job = jobs.get(String(id || ''));
    if (!job) return null;
    const { id: _ignoredId, startedAt: _ignoredStartedAt, ...rest } = patch || {};
    Object.assign(job, rest);
    return job;
  }

  function addItem(id, item) {
    const job = jobs.get(String(id || ''));
    if (!job) return null;
    job.items = [...job.items, item];
    job.done = job.items.length;
    return job;
  }

  function finish(id, patch = {}) {
    const job = update(id, { ...patch, status: 'done', completedAt: now() });
    if (job && !job.message) job.message = '已完成';
    return job;
  }

  function fail(id, error) {
    const message = typeof error === 'string' ? error : (error?.message || '执行失败');
    return update(id, { status: 'error', message, error: message, completedAt: now() });
  }

  // 后台执行：fn 里可继续用 store.update/addItem 报进度；成败都会写回 job。
  // 返回的 Promise 已消化拒绝，因此调用方不需要（也不应该）再 catch —— 否则会变成未处理拒绝。
  function run(id, fn) {
    return Promise.resolve()
      .then(() => fn())
      .then(result => { finish(id, { result: result ?? null }); return result; })
      .catch(error => { fail(id, error); return null; });
  }

  return { create, get, list, findRunning, update, addItem, finish, fail, run, prune, size: () => jobs.size };
}

module.exports = { makeJobStore, DEFAULT_TTL_MS, DEFAULT_MAX_JOBS };