// RedFox API 代理 + SQLite 缓存层
// 依赖：lib/db（实例）、lib/utils（stableObject / parseJson）、https、env vars
const https = require('https');
const { db } = require('./db');
const { stableObject, parseJson } = require('./utils');

const REDFOX_HOST = process.env.REDFOX_HOST || 'redfox.hk';
const REDFOX_PATH_PREFIX = '/story/api/';
const API_KEY = process.env.REDFOX_API_KEY || '';

const REDFOX_ENDPOINTS = new Set([
  'hotKeyword/list',
  'hotSpot/getListByPlatform',
  'hotSpot/getListByPlatformWithKeyword',
  'dy/search/likesRank',
  'dy/search/hotContentRank',
  'dyData/query',
  'dyData/queryWork',
  'dyData/queryUser',
  'dyData/queryUserWithWorks',
  'dyData/searchUser',
  'dyData/searchArticle',
  'dyUser/query',
  'xhs/search/search',
  'xhs/crawl/work',
  'xhsData/query',
  'xhsUser/query',
  'xhsUser/queryAccountDetail',
  'xhsUser/queryWorkDetail',
  'xhsUser/searchUser',
  'xhsUser/searchArticle',
  'xhsUser/syncUserNotes',
  'xhsUser/querySimilarAccounts',
  'cozeSkill/getXhsCozeSkillData',
  'cozeSkill/getXhsCozeSkillDataOne',
  'cozeSkill/getXhsCozeSkillDataSeven',
  'cozeSkill/getXhsCozeSkillDataLowFans',
  'cozeSkill/getWxDataByCategoryAndTime',
  'cozeSkill/getGzhCozeSkillDataRaise',
  'gzh/search/hotArticle',
  'gzhData/searchUser',
  'gzhData/searchArticle',
  'gzhData/queryUser',
  'gzhData/queryWork',
  'gzhData/queryWorkList',
  'gzhData/queryArticleDetail',
  'gzhUser/query',
  'cozeSkill/sensitiveWordSearch',
  'parseWork/queryAiMsgs',
  'parseWork/queryBiliAiMsgs',
  'parseWork/queryXhsAiMsgs',
  'parseWork/queryDyAiMsgs',
  'parseWork/queryKsAiMsgs/batch',
  'parseWork/querySphAiMsgs',
  'parseWork/queryPlayletMsgs',
  'parseWork/queryBiliPlayletMsgs',
  'parseWork/queryDyPlayletMsgs',
  'parseWork/queryGzhPlayletMsgs',
  'parseWork/queryXhsPlayletMsgs',
  'parseWork/parse',
  'parseWork/imageGen/submitSkill',
  'parseWork/imageGen/result',
  'parseWork/imageGen/uploadImage',
  'skill/record/save',
  'doubaoSearch/submit',
  'doubaoSearch/result',
]);

const CACHE_TTL = {
  'hotKeyword/list': 10 * 60 * 1000,
  'hotSpot/getListByPlatform': 30 * 60 * 1000,
  'hotSpot/getListByPlatformWithKeyword': 30 * 60 * 1000,
  'dy/search/likesRank': 60 * 60 * 1000,
  'dy/search/hotContentRank': 60 * 60 * 1000,
  'dyData/queryUserWithWorks': 60 * 60 * 1000,
  'xhs/search/search': 30 * 60 * 1000,
  'xhsUser/searchArticle': 30 * 60 * 1000,
  'gzh/search/hotArticle': 60 * 60 * 1000,
  'gzhData/searchArticle': 30 * 60 * 1000,
  'gzhData/searchUser': 24 * 60 * 60 * 1000,
  'gzhData/queryWorkList': 60 * 60 * 1000,
  'parseWork/queryAiMsgs': 60 * 60 * 1000,
  'parseWork/queryBiliAiMsgs': 60 * 60 * 1000,
  'parseWork/queryXhsAiMsgs': 60 * 60 * 1000,
  default: 60 * 60 * 1000,
};

const AI_FEED_PLATFORMS = ['ai-gzh', 'ai-bili', 'ai-xhs', 'ai-dy', 'ai-ks', 'ai-sph', 'playlet-dy', 'playlet-gzh', 'playlet-bili', 'playlet-xhs', 'cultural-tourism-bili', 'cultural-tourism-dy', 'cultural-tourism-gzh', 'cultural-tourism-xhs'];

function getCacheKey(endpoint, query, body) {
  return `${endpoint}?${query}&${JSON.stringify(stableObject(body))}`;
}

function getCached(cacheKey, endpoint) {
  const row = db.prepare('SELECT response, status_code, updated_at FROM api_cache WHERE cache_key = ?').get(cacheKey);
  if (!row) return null;
  const ttl = CACHE_TTL[endpoint] || CACHE_TTL.default;
  if (Date.now() - row.updated_at > ttl) return null;
  return row;
}

function isCacheableRedfoxResponse(status, response) {
  if (status < 200 || status >= 300) return false;
  const payload = parseJson(response);
  if (payload && Object.hasOwn(payload, 'code') && ![200, 2000].includes(payload.code)) return false;
  return true;
}

function setCache(cacheKey, endpoint, body, status, response) {
  if (!isCacheableRedfoxResponse(status, response)) return;
  const now = Date.now();
  db.prepare(`
    INSERT INTO api_cache (cache_key, endpoint, request_body, response, status_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      response = excluded.response,
      status_code = excluded.status_code,
      updated_at = excluded.updated_at
  `).run(cacheKey, endpoint, JSON.stringify(body), response, status, now, now);
}

function logApiUsage(endpoint, status, cached = false) {
  db.prepare(`
    INSERT INTO api_usage (endpoint, status_code, cached, created_at)
    VALUES (?, ?, ?, ?)
  `).run(endpoint, status, cached ? 1 : 0, Date.now());
}

// 业务层缓存白名单：热点/榜单类端点（数据按日期聚合，TTL 内复用无一致性风险）。
// 账号/查询/上报类端点（dyData/*、xhsUser/*、gzhData/*、syncUserNotes、imageGen、skill/record 等）
// 时效敏感，业务层不做缓存，避免追踪/轮询读到旧数据。
const BUSINESS_CACHE_ENDPOINTS = new Set([
  'hotKeyword/list',
  'hotSpot/getListByPlatform',
  'hotSpot/getListByPlatformWithKeyword',
  'dy/search/likesRank',
  'dy/search/hotContentRank',
  'cozeSkill/getXhsCozeSkillData',
  'cozeSkill/getXhsCozeSkillDataOne',
  'cozeSkill/getXhsCozeSkillDataSeven',
  'cozeSkill/getXhsCozeSkillDataLowFans',
  'cozeSkill/getWxDataByCategoryAndTime',
  'cozeSkill/getGzhCozeSkillDataRaise',
  'gzh/search/hotArticle',
  'parseWork/queryAiMsgs',
  'parseWork/queryBiliAiMsgs',
  'parseWork/queryXhsAiMsgs',
  'parseWork/queryDyAiMsgs',
  'parseWork/queryKsAiMsgs/batch',
  'parseWork/querySphAiMsgs',
  'parseWork/queryPlayletMsgs',
  'parseWork/queryBiliPlayletMsgs',
  'parseWork/queryDyPlayletMsgs',
  'parseWork/queryGzhPlayletMsgs',
  'parseWork/queryXhsPlayletMsgs',
]);

// 每日调用预算（REDFOX_DAILY_CALL_LIMIT，0 = 不限制）：达到上限后所有 RedFox 调用快速失败，
// 防止配额被打穿导致创作/追踪/趋势等功能连锁失败。计数带 30s memo，避免每请求都 COUNT。
let dailyBudgetMemo = { ts: 0, count: 0 };
function checkDailyBudget() {
  const limit = Number(process.env.REDFOX_DAILY_CALL_LIMIT) || 0;
  if (limit <= 0) return;
  const now = Date.now();
  if (now - dailyBudgetMemo.ts > 30000) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dailyBudgetMemo = {
      ts: now,
      count: db.prepare('SELECT COUNT(*) AS n FROM api_usage WHERE cached = 0 AND created_at >= ?')
        .get(dayStart.getTime()).n,
    };
  }
  if (dailyBudgetMemo.count >= limit) {
    throw new Error(
      `今日 RedFox API 调用已达上限（${dailyBudgetMemo.count}/${limit} 次），明日自动恢复；`
      + `可在 .env 调整 REDFOX_DAILY_CALL_LIMIT`,
    );
  }
}

function redfoxRequest(endpoint, body = {}, query = '', method = 'POST') {
  const apiKey = process.env.REDFOX_API_KEY || '';
  const host = process.env.REDFOX_HOST || 'redfox.hk';
  if (!apiKey) return Promise.reject(new Error('未配置 REDFOX_API_KEY'));
  if (!REDFOX_ENDPOINTS.has(endpoint)) return Promise.reject(new Error('不允许访问该 RedFox 端点'));
  try { checkDailyBudget(); } catch (err) { return Promise.reject(err); }
  const requestBody = method === 'GET' ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      port: 443,
      path: `${REDFOX_PATH_PREFIX}${endpoint}${query}`,
      method,
      headers: {
        'X-API-KEY': apiKey,
        'REDFOX_API_KEY': apiKey,
        ...(requestBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        } : {}),
      },
      timeout: 30000,
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode || 502, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('RedFox 请求超时')));
    req.on('error', reject);
    if (requestBody) req.write(requestBody);
    req.end();
  });
}

async function redfoxData(endpoint, body = {}) {
  // 热点/榜单类端点走 SQLite 缓存：TTL 内重复请求零 API 消耗（与 /api/<endpoint> 透传代理共用缓存层）
  let cacheKey = null;
  if (BUSINESS_CACHE_ENDPOINTS.has(endpoint)) {
    cacheKey = getCacheKey(endpoint, '', body);
    const cached = getCached(cacheKey, endpoint);
    if (cached) {
      logApiUsage(endpoint, cached.status_code, true);
      const cachedPayload = parseJson(cached.response);
      if (cachedPayload && [200, 2000].includes(cachedPayload.code)) return cachedPayload.data;
    }
  }
  const response = await redfoxRequest(endpoint, body);
  logApiUsage(endpoint, response.status, false);
  const payload = parseJson(response.body);
  if (response.status < 200 || response.status >= 300 || !payload || ![200, 2000].includes(payload.code)) {
    throw new Error(payload?.msg || payload?.message || `RedFox HTTP ${response.status}`);
  }
  if (cacheKey) setCache(cacheKey, endpoint, body, response.status, response.body);
  return payload.data;
}

async function redfoxGetData(endpoint, queryParams = {}) {
  const query = `?${new URLSearchParams(queryParams).toString()}`;
  let cacheKey = null;
  if (BUSINESS_CACHE_ENDPOINTS.has(endpoint)) {
    cacheKey = getCacheKey(endpoint, query, {});
    const cached = getCached(cacheKey, endpoint);
    if (cached) {
      logApiUsage(endpoint, cached.status_code, true);
      const cachedPayload = parseJson(cached.response);
      if (cachedPayload && [200, 2000].includes(cachedPayload.code)) return cachedPayload.data;
    }
  }
  const response = await redfoxRequest(endpoint, {}, query, 'GET');
  logApiUsage(endpoint, response.status, false);
  const payload = parseJson(response.body);
  if (response.status < 200 || response.status >= 300 || !payload || ![200, 2000].includes(payload.code)) {
    throw new Error(payload?.msg || payload?.message || `RedFox HTTP ${response.status}`);
  }
  if (cacheKey) setCache(cacheKey, endpoint, {}, response.status, response.body);
  return payload.data;
}

module.exports = {
  REDFOX_HOST,
  REDFOX_PATH_PREFIX,
  API_KEY,
  REDFOX_ENDPOINTS,
  CACHE_TTL,
  AI_FEED_PLATFORMS,
  getCacheKey,
  getCached,
  isCacheableRedfoxResponse,
  setCache,
  logApiUsage,
  redfoxRequest,
  redfoxData,
  redfoxGetData,
};
