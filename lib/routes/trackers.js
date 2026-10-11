// 路由组：账号追踪（tracked_accounts）
// 依赖通过 ctx 注入：listTrackers/saveTracker/syncTracker/listTrackerWorks/
// diagnoseAndStoreTracker/listAccountSnapshots/getLocalData
const { db } = require('../db');
const { json, readBody } = require('../http');

async function tryRoute(req, res, url, ctx) {
  const {
    listTrackers, saveTracker, syncTracker, listTrackerWorks,
    diagnoseAndStoreTracker, listAccountSnapshots, getLocalData, jobs,
  } = ctx;

  if (url.pathname === '/api/_/trackers' && req.method === 'GET') {
    json(res, 200, { ok: true, data: listTrackers() });
    return true;
  }

  if (url.pathname === '/api/_/trackers' && req.method === 'POST') {
    const { data } = await readBody(req);
    json(res, 200, { ok: true, data: saveTracker(data) });
    return true;
  }

  const trackerMatch = url.pathname.match(/^\/api\/_\/trackers\/([^/]+)(?:\/(sync|sync-jobs|works|diagnose|diagnose-jobs|trend))?$/);
  if (trackerMatch) {
    const id = decodeURIComponent(trackerMatch[1]);
    const action = trackerMatch[2];

    if (!action && req.method === 'DELETE') {
      db.prepare('DELETE FROM tracked_accounts WHERE id = ?').run(id);
      db.prepare('DELETE FROM account_works WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM account_snapshots WHERE account_id = ?').run(id);
      json(res, 200, { ok: true });
      return true;
    }

    if (action === 'sync' && req.method === 'POST') {
      json(res, 200, { ok: true, data: await syncTracker(id) });
      return true;
    }

    // P1-2 作业化：账号同步可能要拉几百篇作品，提交即返回 jobId（验收 G1）
    if (action === 'sync-jobs' && req.method === 'POST') {
      if (!jobs) { json(res, 500, { ok: false, error: '作业存储未就绪' }); return true; }
      const running = jobs.findRunning(job => job.kind === 'tracker-sync' && job.meta.id === id);
      if (running) { json(res, 200, { ok: true, data: { jobId: running.id, reused: true } }); return true; }
      const job = jobs.create({ kind: 'tracker-sync', message: '正在同步账号作品…', meta: { id } });
      jobs.run(job.id, async () => {
        const result = await syncTracker(id);
        jobs.update(job.id, { message: '账号同步完成' });
        return result;
      });
      json(res, 200, { ok: true, data: { jobId: job.id, reused: false } });
      return true;
    }

    // P1-2 作业化：诊断要逐篇过 LLM，是最慢的一条链（验收 G1）
    if (action === 'diagnose-jobs' && req.method === 'POST') {
      if (!jobs) { json(res, 500, { ok: false, error: '作业存储未就绪' }); return true; }
      const tracker = listTrackers().find(item => item.id === id);
      if (!tracker) throw new Error('账号不存在');
      const running = jobs.findRunning(job => job.kind === 'tracker-diagnose' && job.meta.id === id);
      if (running) { json(res, 200, { ok: true, data: { jobId: running.id, reused: true } }); return true; }
      const job = jobs.create({
        kind: 'tracker-diagnose',
        message: `正在诊断「${tracker.name || id}」…`,
        meta: { id, name: tracker.name || '' },
      });
      jobs.run(job.id, async () => {
        const result = await diagnoseAndStoreTracker(tracker);
        jobs.update(job.id, { message: '诊断完成' });
        return result;
      });
      json(res, 200, { ok: true, data: { jobId: job.id, reused: false } });
      return true;
    }

    if (action === 'works' && req.method === 'GET') {
      const tracker = listTrackers().find(item => item.id === id);
      if (!tracker) throw new Error('账号不存在');
      const stale = !tracker.syncedAt || Date.now() - tracker.syncedAt > 24 * 60 * 60 * 1000;
      json(res, 200, { ok: true, data: listTrackerWorks(id), stale, syncedAt: tracker.syncedAt || null });
      return true;
    }

    if (action === 'diagnose' && req.method === 'GET') {
      const tracker = listTrackers().find(item => item.id === id);
      if (!tracker) throw new Error('账号不存在');
      const cached = getLocalData('diagnosis', id);
      if (cached) {
        json(res, 200, { ok: true, data: { report: cached, cached: true } });
        return true;
      }
      json(res, 200, { ok: true, data: { report: null, cached: false, stale: true } });
      return true;
    }

    if (action === 'diagnose' && req.method === 'POST') {
      const tracker = listTrackers().find(item => item.id === id);
      if (!tracker) throw new Error('账号不存在');
      json(res, 200, { ok: true, data: await diagnoseAndStoreTracker(tracker) });
      return true;
    }

    if (action === 'trend' && req.method === 'GET') {
      const tracker = listTrackers().find(item => item.id === id);
      if (!tracker) throw new Error('账号不存在');
      json(res, 200, {
        ok: true,
        data: {
          tracker,
          snapshots: listAccountSnapshots(id, Math.min(Number(url.searchParams.get('limit')) || 30, 90)),
        },
      });
      return true;
    }
  }

  return false;
}

module.exports = { tryRoute };
