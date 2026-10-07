// ============= 相同请求 single-flight =============
// 目的：昂贵的调用（LLM 生成 / RedFox 抓取）在「同请求仍在进行中」时复用同一条 Promise，
// 避免连点、双开标签页并行发起重复调用 —— 既重复消耗预算，也互相触发上游限流。
//
// 用法：
//   const flight = createSingleFlight(5000);
//   const { promise, deduplicated } = flight.run(requestKey(data), () => 真正的生成(data));
//   json(res, 200, { ok: true, data: await promise, ...(deduplicated ? { deduplicated: true } : {}) });
//
// 语义（与 lib/routes/misc.js 里 /rewrite 的既有实现一致）：
//   - 窗口内且仍在进行中 → 复用同一条 Promise，deduplicated = true，任务不会重复执行；
//   - 任务结束（成功或失败）后立刻释放 key，因此 5s 窗口只对**并发**生效：
//     顺序的两次调用永远各自执行。若想「N 秒内不重跑」，那是缓存（见 lib/db.js 的 local_data），
//     不要用本模块；
//   - 失败原样抛给所有调用者，不吞异常、不返回假成功；
//   - 窗口过期但任务仍在飞时，允许重新发起（Map 中换新 entry，旧 entry 的 finally 不会误删新 entry）。
const crypto = require('crypto');
const { stableObject } = require('./utils');

// 请求体归一化哈希：键序无关（stableObject），保证 {a,b} 与 {b,a} 命中同一条
function requestKey(data) {
  return crypto.createHash('sha1').update(JSON.stringify(stableObject(data || {}))).digest('hex');
}

function createSingleFlight(windowMs = 5000, { now = Date.now } = {}) {
  const inflight = new Map(); // key -> { promise, startedAt }

  return {
    // 仅用于测试与诊断：当前在飞的任务数
    size: () => inflight.size,

    run(key, task) {
      const startedAt = now();
      const existing = inflight.get(key);
      if (existing && startedAt - existing.startedAt < windowMs) {
        return { promise: existing.promise, deduplicated: true };
      }
      const entry = { promise: null, startedAt };
      entry.promise = Promise.resolve()
        .then(task)
        .finally(() => {
          // 只有仍是当前 entry 时才清理，避免「窗口过期后重新发起」把新 entry 删掉
          if (inflight.get(key) === entry) inflight.delete(key);
        });
      inflight.set(key, entry);
      return { promise: entry.promise, deduplicated: false };
    },
  };
}

module.exports = { createSingleFlight, requestKey };