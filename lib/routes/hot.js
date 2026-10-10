// 路由组：热榜读取与手动同步
// 依赖通过 ctx 注入：getHotTrends/analyzeHotTrendsLlm/hotListPayload/
// syncRealtimeHotspots/syncDailyPlatform/HOT_SOURCE_CONFIG
const { db } = require('../db');
const { parseJson, normalizeTrendDays } = require('../utils');
const { json, readBody } = require('../http');

async function tryRoute(req, res, url, ctx) {
  const {
    getHotTrends, analyzeHotTrendsLlm, hotListPayload,
    syncRealtimeHotspots, syncDailyPlatform, HOT_SOURCE_CONFIG,
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
