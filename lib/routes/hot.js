// 路由组：热榜读取与手动同步
// 依赖通过 ctx 注入：getHotTrends/analyzeHotTrendsLlm/hotListPayload/
// syncRealtimeHotspots/syncDailyPlatform/HOT_SOURCE_CONFIG
const { db } = require('../db');
const { parseJson, normalizeTrendDays } = require('../utils');
const { json, readBody } = require('../http');

// P1-2 作业化：作业 kind 常量 + 作业体 + 从 hot_batches 读回「本次作业的落库结果」
const HOT_SYNC_JOB_KIND = 'hot-sync';

// 读「本次作业开始后写入的批次」= 这次刷新真实落库的平台结果。
// 进度直接取自 hot_batches（与页面列表、与验收 G2 的 SQL 同源），不做二次统计以免与实际不一致。
// 若窗口内没有批次（例如恰好复用了 cron 正在跑的 single-flight 链），退回「每平台最近一次批次」。
function latestBatchSummaries(startedAt, platform) {
  const scoped = platform && platform !== 'all';
  const windowQuery = `
    SELECT b.platform, b.status, b.item_count, b.error, b.data_date, b.started_at
    FROM hot_batches b
    JOIN (
      SELECT platform, MAX(started_at) AS started_at FROM hot_batches
      WHERE started_at >= ?${scoped ? ' AND platform = ?' : ''}
      GROUP BY platform
    ) m ON m.platform = b.platform AND m.started_at = b.started_at
    ORDER BY b.platform`;
  const windowParams = scoped ? [startedAt, platform] : [startedAt];
  let rows = db.prepare(windowQuery).all(...windowParams);
  if (!rows.length) {
    const fallbackQuery = `
      SELECT b.platform, b.status, b.item_count, b.error, b.data_date, b.started_at
      FROM hot_batches b
      JOIN (
        SELECT platform, MAX(started_at) AS started_at FROM hot_batches
        ${scoped ? 'WHERE platform = ?' : ''}
        GROUP BY platform
      ) m ON m.platform = b.platform AND m.started_at = b.started_at
      ORDER BY b.platform`;
    rows = db.prepare(fallbackQuery).all(...(scoped ? [platform] : []));
  }
  return rows.map(row => ({
    platform: row.platform,
    status: row.status,
    itemCount: row.item_count,
    dataDate: row.data_date,
    error: row.error || null,
    startedAt: row.started_at,
  }));
}

// 作业体：跑同步 → 把落库结果回填成作业进度 → 用一句人话收尾
async function runHotSyncJob(jobId, platform, deps) {
  const { jobs, syncRealtimeHotspots, syncDailyPlatform } = deps;
  const startedAt = jobs.get(jobId)?.startedAt || Date.now();
  const isAll = platform === 'all';
  if (isAll) await syncRealtimeHotspots('灵感熔炉-手动刷新（作业）');
  else await syncDailyPlatform(platform, require('../utils').dateDaysAgo(1), '灵感熔炉-手动昨日榜（作业）');
  const items = latestBatchSummaries(startedAt, platform);
  items.forEach(item => jobs.addItem(jobId, item));
  const failed = items.filter(item => item.status !== 'success');
  const itemCount = items.reduce((sum, item) => sum + (Number(item.itemCount) || 0), 0);
  jobs.update(jobId, {
    total: items.length,
    message: items.length === 0
      ? '刷新完成，但没有写入新榜单（可能是平台接口无数据）'
      : `刷新完成：${items.length} 个平台 · ${itemCount} 条${failed.length ? ` · ${failed.length} 个失败` : ''}`,
  });
  return { platform, platformCount: items.length, itemCount, failedPlatforms: failed.map(item => item.platform), platforms: items };
}

async function tryRoute(req, res, url, ctx) {
  const {
    getHotTrends, analyzeHotTrendsLlm, hotListPayload,
    syncRealtimeHotspots, syncDailyPlatform, HOT_SOURCE_CONFIG, jobs,
  } = ctx;

  if (url.pathname === '/api/_/hot/trends' && req.method === 'GET') {
    const days = normalizeTrendDays(url.searchParams.get('days'));
    const result = getHotTrends(days);
    // analyzed 反映真实状态：是否已存在 LLM 关键词报告（此前硬编码 true，
    // 导致前端"AI 深度分析趋势"按钮分支成为死代码，数据为空时用户没有任何分析入口）
    json(res, 200, { ok: true, data: result, analyzed: Boolean(result.analyzedThrough) });
    return true;
  }

  if (url.pathname === '/api/_/hot/trends/analyze' && req.method === 'POST') {
    // days 与 GET /trends 共用同一套归一化（只认 7/14，此前这个参数被完全忽略）；
    // force 默认 false：同一份热榜数据直接复用已生成报告，连点不会重复烧 LLM（P0-3 / 验收 C2）。
    const days = normalizeTrendDays(url.searchParams.get('days'));
    let force = false;
    try {
      const { data } = await readBody(req);
      force = Boolean(data?.force);
    } catch {
      // 空 body / 非 JSON 一律按「不强制重算」处理，兼容旧前端（body: {}）
    }
    const result = await analyzeHotTrendsLlm(days, { force });
    json(res, 200, { ok: true, data: result });
    return true;
  }

  // P1-2 作业化刷新：提交即返回 jobId，后台跑，进度由 GET /api/_/jobs/:id 轮询。
  // 注意这里保留上面的同步版本（keywords/sync、list/sync）用于回滚与脚本调用，
  // 但前端「刷新热点」按钮走这条，任何 HTTP 请求都不会再挂几十秒（验收 G1）。
  if (url.pathname === '/api/_/hot/sync/jobs' && req.method === 'POST') {
    if (!jobs) { json(res, 500, { ok: false, error: '作业存储未就绪' }); return true; }
    const platform = url.searchParams.get('platform') || 'all';
    if (platform !== 'all' && !HOT_SOURCE_CONFIG[platform]) {
      json(res, 400, { ok: false, error: '不支持的平台' });
      return true;
    }
    // 同一目标已有作业在跑：复用，避免重复烧接口配额（与 syncRealtimeHotspots 自身的 single-flight 呼应）
    const running = jobs.findRunning(job => job.kind === HOT_SYNC_JOB_KIND && job.meta.platform === platform);
    if (running) {
      json(res, 200, { ok: true, data: { jobId: running.id, reused: true } });
      return true;
    }
    const job = jobs.create({
      kind: HOT_SYNC_JOB_KIND,
      message: platform === 'all' ? '正在刷新全网热点…' : '正在刷新该平台榜单…',
      meta: { platform },
    });
    jobs.run(job.id, () => runHotSyncJob(job.id, platform, { jobs, syncRealtimeHotspots, syncDailyPlatform }));
    json(res, 200, { ok: true, data: { jobId: job.id, reused: false } });
    return true;
  }

  if (url.pathname === '/api/_/hot/keywords' && req.method === 'GET') {
    const result = hotListPayload('all');
    json(res, 200, { ok: true, data: result });
    return true;
  }

  if (url.pathname === '/api/_/hot/keywords/sync' && req.method === 'POST') {
    await syncRealtimeHotspots('灵感熔炉-手动刷新');
    json(res, 200, { ok: true, data: hotListPayload('all') });
    return true;
  }

  if (url.pathname === '/api/_/hot/list' && req.method === 'GET') {
    const platform = url.searchParams.get('platform') || 'dy';
    if (!HOT_SOURCE_CONFIG[platform]) {
      json(res, 400, { ok: false, error: '不支持的平台' });
      return true;
    }
    json(res, 200, { ok: true, data: hotListPayload(platform) });
    return true;
  }

  if (url.pathname === '/api/_/hot/list/sync' && req.method === 'POST') {
    const platform = url.searchParams.get('platform') || 'all';
    if (platform === 'all') {
      await syncRealtimeHotspots('灵感熔炉-手动刷新');
      json(res, 200, { ok: true, data: hotListPayload('all') });
      return true;
    }
    if (!HOT_SOURCE_CONFIG[platform]) {
      json(res, 400, { ok: false, error: '不支持的平台' });
      return true;
    }
    await syncDailyPlatform(platform, require('../utils').dateDaysAgo(1), '灵感熔炉-手动昨日榜');
    json(res, 200, { ok: true, data: hotListPayload(platform) });
    return true;
  }

  // 返回热榜可用 platform 列表（只返回已启用 cron 的，供前端动态渲染 tab）
  if (url.pathname === '/api/_/hot/platforms' && req.method === 'GET') {
    const configuredRows = db.prepare("SELECT id, task_config FROM crontab WHERE task_type = 'hot-platform'").all();
    const configuredPlatforms = new Set(
      configuredRows.map(row => {
        const cfg = parseJson(row.task_config) || {};
        return cfg.platform;
      }).filter(Boolean)
    );
    const platforms = Object.entries(HOT_SOURCE_CONFIG)
      .filter(([key]) => configuredPlatforms.has(key))
      .map(([key, cfg]) => ({
        key, label: cfg.label, adapter: cfg.adapter, cronId: `hot-daily-${key}`,
      }));
    json(res, 200, { ok: true, data: platforms });
    return true;
  }

  return false;
}

module.exports = { tryRoute };
