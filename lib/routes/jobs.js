// 路由组：作业状态轮询（P1-2 长任务作业化）
// 依赖通过 ctx 注入：jobs（lib/jobs.js 的 makeJobStore 实例）
//
// 前端「点了要等几十秒」的三个动作（热点刷新 / 账号同步 / 账号诊断）现在都是：
// POST 对应 /xxx-jobs 接口 → 立刻拿到 jobId → 轮询 GET /api/_/jobs/:id 拿进度。
// 这样一个 HTTP 请求都不会长时间挂住（验收 G1），也不会被中间层/浏览器超时掐断。
const { json } = require('../http');

async function tryRoute(req, res, url, ctx) {
  const { jobs } = ctx;
  // 未创建作业存储时不认领任何路径，避免影响其它路由组与测试桩
  if (!jobs) return false;

  // 作业列表：前端切页回来后据此恢复进行中的进度条
  if (url.pathname === '/api/_/jobs' && req.method === 'GET') {
    json(res, 200, { ok: true, data: { jobs: jobs.list() } });
    return true;
  }

  const match = url.pathname.match(/^\/api\/_\/jobs\/([0-9a-f]{8,32})$/);
  if (match && req.method === 'GET') {
    const job = jobs.get(match[1]);
    if (!job) {
      json(res, 404, { ok: false, error: '作业不存在或已过期' });
      return true;
    }
    json(res, 200, { ok: true, data: job });
    return true;
  }

  return false;
}

module.exports = { tryRoute };