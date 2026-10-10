import { localApi, cancelApi, isAbortError } from '../api.js';
import { toggleCron } from './settings.js';
import { esc, fmt } from '../utils.js';
import { platName, platColor, platCodeByName } from '../config.js';
import { toast, skeleton, rankBadge, busyState } from '../components.js';
import { initIcons } from '../icons.js';
import { adaptDY, adaptXHS, adaptGZH, adaptAIGZH, adaptAIBili, adaptAIXHS, adaptAiFeed } from '../core/adapters.js';
import { renderListItem } from '../core/renderers.js';

let hotCache = { dy: null, xhs: null, gzh: null, aiGzh: null, hotKeyword: null, hotCacheTime: 0 };
// 趋势分析进行中标志（P0-3）：一次「重新分析」要跑约 4 批 LLM，连点必须被拦住
let trendAnalyzeInFlight = false;

// 热榜 tab grid 专用紧凑渲染：4 列 × 5 行，单行标题 + 1 行指标
function renderCompactItem(item) {
  const num = v => esc(v == null ? '' : String(v));
  const metrics = item.plat === 'dy'
    ? `<span class="text-orange-400">🔥${num(item.like)}</span><span>💬${num(item.comment)}</span>`
    : item.plat === 'xhs'
    ? `<span class="text-pink-400">❤${num(item.like)}</span><span>⭐${num(item.collect)}</span>`
    : `<span class="text-emerald-400">👁${num(item.read)}</span><span>👍${num(item.like || item.watch)}</span>`;
  return `
    <div class="card p-2 bg-white/[0.02] rounded-md flex items-start gap-1.5 hover:bg-white/[0.05] transition" data-action="showDetail" data-plat="${esc(item.plat)}" data-work-id="${esc(item.workId)}">
      ${rankBadge(item._rank || 0)}
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium line-clamp-2 leading-tight">${esc(item.title || '(无标题)')}</div>
        <div class="flex items-center gap-1.5 mt-1 text-[10px] text-gray-500 flex-wrap">
          ${metrics}
        </div>
      </div>
    </div>`;
}
let hotPlatforms = [];

export function clearHotCache() {
  hotCache = { dy: null, xhs: null, gzh: null, aiGzh: null, hotKeyword: null, hotCacheTime: 0 };
}

export function clearHotPlatforms() {
  hotPlatforms = [];
}

async function loadHotPlatforms() {
  if (hotPlatforms.length) return hotPlatforms;
  try {
    const data = await localApi('hot/platforms');
    hotPlatforms = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('加载热榜 platform 列表失败:', e.message);
    hotPlatforms = []; // TOP50 默认关闭，需要去 Skills 中心绑定才显示
  }
  return hotPlatforms;
}

function hotSourceMeta(result, realtime = false) {
  const isApi = result?.sourceMode === 'api';
  const sourceClass = isApi ? 'pill-green' : 'pill-amber';
  const captured = result?.capturedAt ? new Date(result.capturedAt).toLocaleString('zh-CN') : '未知';
  const dataDate = result?.dataDate || '无';
  const attempt = result?.latestAttempt;
  const attemptText = attempt && attempt.status !== 'success'
    ? ` · 最近 API 尝试：${attempt.status === 'empty' ? '空数据' : '失败'}${attempt.error ? `（${esc(attempt.error)}）` : ''}`
    : '';
  return {
    isApi,
    badge: `<span class="pill ${sourceClass}">${esc(result?.sourceLabel || '本地缓存数据')}</span>`,
    text: realtime
      ? `数据日期 ${esc(dataDate)} · 抓取于 ${esc(captured)}${attemptText}`
      : `榜单日期 ${esc(dataDate)} · 入库于 ${esc(captured)}${attemptText}`,
  };
}

export async function renderHotlist() {
  const top = document.getElementById('hot-top10');
  const tabContent = document.getElementById('hot-tab-content');
  const topTime = document.getElementById('hot-top10-time');
  if (!top || !tabContent || !topTime) return;
  top.innerHTML = skeleton(8);
  tabContent.innerHTML = skeleton(6);
  topTime.textContent = '加载中…';

  try {
    const kwResult = await localApi('hot/keywords');
    if (!top.isConnected) return;
    const kwList = kwResult?.data || [];

    if (kwList.length) {
      hotCache.hotKeyword = kwResult;
      top.innerHTML = kwList.slice(0, 12).map((kw, i) => {
        const plats = kw.raw?.plats || [];
        return `
        <div class="flex items-center gap-2 p-2 bg-white/[0.02] rounded-lg card border border-white/5">
          ${rankBadge(i + 1)}
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium truncate leading-tight">${esc(kw.title)}</div>
            <div class="flex items-center gap-1 mt-0.5 text-[9px] text-gray-500 flex-wrap">
              ${plats.slice(0, 4).map(p => `<span class="flex items-center gap-0.5"><span class="platform-dot" style="background:${platColor(platCodeByName(p))}"></span>${esc(p)}</span>`).join(' ')}
            </div>
          </div>
        </div>`;
      }).join('');
      const capturedAt = kwResult.capturedAt ? new Date(kwResult.capturedAt) : null;
      const timeText = capturedAt
        ? capturedAt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '已更新';
      const meta = hotSourceMeta(kwResult, true);
      topTime.innerHTML = `${meta.badge}<span>${esc(timeText)} · 数据日期 ${esc(kwResult.dataDate || '')}</span>`;
    } else {
      top.innerHTML = `
        <div class="col-span-2 text-center text-gray-400 py-8 text-sm">
          <div class="mb-3">暂无全网热点数据</div>
          <button class="btn btn-primary py-1.5 text-xs" data-action="syncHotKeywords"><i data-lucide="refresh-cw" class="w-3 h-3"></i>刷新热点</button>
        </div>`;
    }
  } catch (e) {
    if (top.isConnected) top.innerHTML = `<div class="col-span-2 text-center text-red-400 py-8 text-sm">加载失败：${esc(e.message)}</div>`;
  }

  if (!top.isConnected) return;
  await renderHotTabs();
  if (!top.isConnected) return;
  // 初始 tab 用第一个平台（trending-hub 是静态 HTML 占位，renderHotTabs 已替换）
  const platforms = await loadHotPlatforms();
  const initialTab = platforms[0]?.key;
  if (initialTab) {
    await renderHotTab(initialTab);
  } else {
    const content = document.getElementById('hot-tab-content');
    const metaEl = document.getElementById('hot-tab-meta');
    if (content) content.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8 text-sm">暂无热榜 Tab，到 Skill 中心绑定平台热榜 Skill 后会出现</div>';
    if (metaEl) metaEl.innerHTML = '';
  }
  if (!top.isConnected) return;
  await loadHotTrends();
  if (!top.isConnected) return;
  bindHotTabs();
  initIcons(document.getElementById('content-area'));
}

async function renderHotTabs() {
  const container = document.getElementById('hot-tabs');
  if (!container) return;
  const platforms = await loadHotPlatforms();
  container.innerHTML = platforms.map((p, idx) =>
    `<div class="relative group inline-flex">
      <button class="tab-btn ${idx === 0 ? 'active' : ''} px-3 py-1.5 text-sm rounded-md pr-5" data-tab="${esc(p.key)}">${esc(p.label)}</button>
      <button class="absolute right-0.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full hover:bg-red-500/80 text-[10px] text-gray-500 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" data-action="closeHotTab" data-cron-id="${esc(p.cronId)}" data-tab="${esc(p.key)}" title="删除该 Tab">×</button>
    </div>`
  ).join('');
}

export async function syncHotKeywords() {
  toast('正在刷新全网热点…', 'info');
  try {
    await localApi('hot/keywords/sync', { method: 'POST', body: {} });
    toast('热点刷新成功', 'success');
    renderHotlist();
  } catch (e) {
    toast('刷新失败：' + e.message, 'error');
    renderHotlist();
  }
}

export async function renderHotTab(tab) {
  const content = document.getElementById('hot-tab-content');
  const metaEl = document.getElementById('hot-tab-meta');
  if (!content || !metaEl) return;

  content.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8 text-sm">加载中…</div>';
  metaEl.innerHTML = '';
  cancelApi('hotlist-tab');
  try {
    const result = await localApi('hot/list?platform=' + tab, { abortKey: 'hotlist-tab' });
    if (!content.isConnected) return;
    const platforms = await loadHotPlatforms();
    const tabNames = Object.fromEntries(platforms.map(p => [p.key, p.label]));
    const cronId = `hot-daily-${tab}`;
    const meta = hotSourceMeta(result);
    metaEl.innerHTML = `
      <div class="flex items-center justify-between gap-3 rounded-lg bg-white/[0.025] px-3 py-2 text-[11px] text-gray-400">
        <div class="flex items-center gap-2 flex-wrap">${meta.badge}<span>${meta.text}</span><code class="text-purple-300">${esc(result.cronExpr || '')}</code></div>
        <button class="btn btn-ghost py-1 px-2 text-[11px]" data-action="toggleHotPlatformCron" data-cron-id="${cronId}" data-enabled="${result.cronEnabled ? 'false' : 'true'}" data-tab="${tab}">
          <i data-lucide="${result.cronEnabled ? 'pause' : 'play'}" class="w-3 h-3"></i>
          自动刷新：${result.cronEnabled ? '开' : '关'}
        </button>
      </div>`;
    if (!Array.isArray(result?.data) || result.data.length === 0) {
      content.innerHTML = `
        <div class="col-span-full text-center text-gray-400 py-8 text-sm">
          <div class="mb-3">暂无 ${tabNames[tab] || tab} 本地数据</div>
          <button class="btn btn-primary py-1.5 text-xs" data-action="syncHotTab" data-tab="${tab}"><i data-lucide="refresh-cw" class="w-3 h-3"></i>刷新 ${tabNames[tab] || tab}</button>
        </div>`;
      initIcons(document.getElementById('content-area'));
      return;
    }
    const platformCfg = platforms.find(p => p.key === tab);
    const adapter = platformCfg?.adapter;
    let list = [];
    // 4 列 × 5 行 = 20 条，保持紧凑
    if (tab === 'dy') {
      list = result.data.slice(0, 20).map(item => adaptDY(item.raw));
    } else if (tab === 'xhs') {
      list = result.data.slice(0, 20).map(item => adaptXHS(item.raw));
    } else if (tab === 'gzh') {
      list = result.data.slice(0, 20).map(item => adaptGZH(item.raw));
    } else if (tab === 'ai-gzh') {
      list = result.data.slice(0, 20).map(item => adaptAIGZH(item.raw));
    } else if (tab === 'ai-bili') {
      list = result.data.slice(0, 20).map(item => adaptAIBili(item.raw));
    } else if (tab === 'ai-xhs') {
      list = result.data.slice(0, 20).map(item => adaptAIXHS(item.raw));
    } else if (adapter === 'aiFeed') {
      list = result.data.slice(0, 20).map(item => adaptAiFeed(item.raw, tab));
    }
    list = list.filter(item => item.title);
    list.forEach((it, i) => it._rank = i + 1);
    content.innerHTML = list.map(renderCompactItem).join('');
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (content.isConnected) content.innerHTML = `<div class="text-center text-red-400 py-8 text-sm">加载失败：${esc(e.message)}</div>`;
  }
  if (content.isConnected) initIcons(document.getElementById('content-area'));
}

export async function toggleHotPlatformCron(cronId, enabled, tab) {
  await toggleCron(cronId, enabled);
  await renderHotTab(tab);
}

export async function closeHotTab(cronId, tab) {
  if (!confirm('确定删除这个热榜 Tab？删除后会同时移除自动选题中的对应数据源。')) return;
  try {
    await localApi('crons/' + cronId, { method: 'DELETE' });
    toast('已删除 Tab', 'success');
    clearHotPlatforms();
    await renderHotTabs();
    const activeBtn = document.querySelector(`#hot-tabs [data-tab="${esc(tab)}"]`);
    if (activeBtn) activeBtn.classList.remove('active');
    const firstBtn = document.querySelector('#hot-tabs [data-tab]');
    if (firstBtn) {
      firstBtn.click();
    } else {
      const content = document.getElementById('hot-tab-content');
      const metaEl = document.getElementById('hot-tab-meta');
      if (content) content.innerHTML = '<div class="text-center text-gray-500 py-8 text-sm">暂无热榜 Tab，可通过 Skill 中心绑定。</div>';
      if (metaEl) metaEl.innerHTML = '';
    }
  } catch (e) { toast('删除失败：' + e.message, 'error'); }
}

export async function syncHotTab(tab) {
  const platforms = await loadHotPlatforms();
  const tabNames = Object.fromEntries(platforms.map(p => [p.key, p.label]));
  toast(`正在刷新 ${tabNames[tab] || tab}…`, 'info');
  try {
    await localApi('hot/list/sync?platform=' + tab, { method: 'POST', body: {} });
    toast(`${tabNames[tab] || tab} 刷新成功`, 'success');
    renderHotTab(tab);
  } catch (e) {
    toast('刷新失败：' + e.message, 'error');
    renderHotTab(tab);
  }
}

export function bindHotTabs() {
  // 只绑 #hot-tabs 内的 .tab-btn（避开 close 按钮也带 data-tab 的情况）
  document.querySelectorAll('#hot-tabs .tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#hot-tabs .tab-btn').forEach(b => { b.classList.remove('active'); b.style.background = 'transparent'; b.style.color = ''; });
      btn.classList.add('active');
      btn.style.background = 'rgba(139,92,246,.15)';
      btn.style.color = '#c4b5fd';
      renderHotTab(btn.dataset.tab);
    };
    btn.onmouseenter = () => { if (!btn.classList.contains('active')) btn.style.background = 'rgba(255,255,255,.04)'; };
    btn.onmouseleave = () => { if (!btn.classList.contains('active')) btn.style.background = 'transparent'; };
    if (btn.classList.contains('active')) { btn.style.background = 'rgba(139,92,246,.15)'; btn.style.color = '#c4b5fd'; }
  });
}

export async function loadHotTrends() {
  const el = document.getElementById('hot-trends');
  if (!el) return;
  const days = document.getElementById('trendDays')?.value || 14;
  el.innerHTML = skeleton(4);
  try {
    const trends = await localApi(`hot/trends?days=${days}`);
    if (!el.isConnected) return;
    const themes = Array.isArray(trends?.themes) ? trends.themes : [];
    const analyzed = trends?.analyzed === true;

    if (themes.length && analyzed) {
      renderLlmTrends(el, trends);
      return;
    }
    // 无主题数据：说明原因并提供手动分析入口。
    // 修复：原 legacy 分支（按旧数组结构渲染）因路由始终返回 analyzed:true 而永不可达，
    // 导致数据为空时用户没有任何"AI 深度分析趋势"按钮可点。
    const reason = trends?.summary || '还没有积累任何真实的每日关键词报告。先在上方抓取热榜数据，再点击下方按钮用 LLM 提取关键词；连续两天生成报告后即可看到增长/冷却趋势。';
    el.innerHTML = `
      <div class="md:col-span-2 text-center text-gray-500 py-6 text-sm leading-relaxed">${esc(reason)}</div>
      <div class="md:col-span-2 text-center pb-2">
        <button class="btn btn-ghost py-1.5 text-xs" data-action="analyzeTrends"><i data-lucide="sparkles" class="w-3.5 h-3.5"></i>AI 深度分析趋势</button>
      </div>`;
    initIcons(document.getElementById('content-area'));
  } catch (e) {
    if (el.isConnected) el.innerHTML = `<div class="md:col-span-2 text-center text-red-400 py-8 text-sm">${esc(e.message)}</div>`;
  }
}

export function renderLlmTrends(el, data) {
  const themes = data.themes || [];
  // 元信息条（P0-3 / 验收 C1、C3）：把「实际生效窗口 / 数据截至 / 报告生成时间 / 批次完整度」摆出来。
  // 此前这些都不可见 —— 传 7 天却看到 14 天数据、某批 LLM 失败导致关键词偏少，用户都无从判断原因。
  const analyzedDays = data.analyzedDays === 7 ? 7 : 14;
  const stats = data.batchStats;
  const batchText = stats && Number.isFinite(Number(stats.total))
    ? (Number(stats.failed) > 0
      ? `<span class="text-red-400">批次 ${stats.failed}/${stats.total} 失败</span>`
      : `<span class="text-emerald-400/80">批次完整（${stats.total}/${stats.total}）</span>`)
    : '';
  const generatedAt = data.generatedAt ? new Date(data.generatedAt).toLocaleString('zh-CN') : '未知';
  const metaBar = `<div class="md:col-span-2 flex items-center gap-2 flex-wrap rounded-lg bg-white/[0.025] px-3 py-2 text-[11px] text-gray-400">
      <span class="pill pill-sky">近 ${analyzedDays} 天</span>
      <span>数据截至 ${esc(data.analyzedThrough || '无')}</span>
      <span>· 报告生成于 ${esc(generatedAt)}</span>
      ${batchText ? `<span>· ${batchText}</span>` : ''}
      <span class="text-gray-500">· 热榜数据未变时直接复用报告，不重复调用 LLM</span>
    </div>`;
  if (!themes.length) {
    el.innerHTML = metaBar + `<div class="md:col-span-2 text-center text-gray-500 py-8 text-sm">${esc(data.summary || '尚未积累足够的真实日榜数据')}</div>`;
    return;
  }
  const summaryHtml = data.summary
    ? `<div class="md:col-span-2 glass-strong rounded-xl p-4 text-sm"><span class="pill pill-brand flex-shrink-0 mr-2"><i data-lucide="sparkles" class="w-3 h-3"></i>AI</span><span class="text-purple-200">${esc(data.summary)}</span></div>`
    : '';
  const themesHtml = themes.map(t => {
    const style = t.trend === '增长' ? 'pill-green' : t.trend === '冷却' ? 'pill-hot' : 'pill-sky';
    const icon = t.trend === '增长' ? 'trending-up' : t.trend === '冷却' ? 'trending-down' : 'minus';
    const plats = (t.platforms || []).map(p => platName(p)).join('、');
    const keywords = (t.keywords || []).map(k => `<span class="tag">${esc(k)}</span>`).join(' ');
    const titles = (t.topTitles || []).slice(0, 2).map(title => `<div class="text-[11px] text-gray-500 mt-0.5 truncate">· ${esc(title)}</div>`).join('');
    return `<div class="glass rounded-xl p-4">
      <div class="flex items-start gap-3 mb-2">
        <span class="pill ${style} flex-shrink-0"><i data-lucide="${icon}" class="w-3 h-3"></i>${t.trend}</span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">${esc(t.name)}</div>
          <div class="text-[11px] text-gray-500 mt-0.5">${plats} · ${t.daysSeen || '?'} 天 · ${t.scoreChange || '--'}</div>
        </div>
      </div>
      ${keywords ? `<div class="flex flex-wrap gap-1.5 mb-1">${keywords}</div>` : ''}
      ${t.reason ? `<div class="text-[11px] text-gray-400">${esc(t.reason)}</div>` : ''}
      ${titles}
    </div>`;
  }).join('');
  // data-force=true 才会强制重算（并且会再确认一次）；不带该属性时命中缓存直接复用上次报告
  const reanalyzeBtn = `<div class="md:col-span-2 text-center py-2">
      <button class="btn btn-ghost py-1.5 text-xs" data-action="analyzeTrends" data-force="true" title="强制重新分析会重新调用全部批次（约 4 批 LLM）"><i data-lucide="sparkles" class="w-3.5 h-3.5"></i>重新分析</button>
      <div class="text-[11px] text-gray-500 mt-1">热榜数据未变时会直接复用上次报告</div>
    </div>`;
  el.innerHTML = metaBar + summaryHtml + themesHtml + reanalyzeBtn;
  initIcons(document.getElementById('content-area'));
}

export async function analyzeTrends(meta = {}) {
  const el = document.getElementById('hot-trends');
  if (!el) return;
  if (trendAnalyzeInFlight) { toast('趋势分析进行中，请等待当前任务完成', 'info'); return; }
  // force 只来自「重新分析」按钮的 data-force：强制重算会重新调用全部批次，必须先确认
  const force = meta.force === 'true' || meta.force === true;
  if (force && !confirm('强制重新分析会重新调用全部批次（约 4 批 LLM），确认继续？\n\n如果热榜数据没变，直接用已有报告即可。')) return;
  const days = document.getElementById('trendDays')?.value || 14; // 服务端只认 7/14，并会回报实际生效窗口
  trendAnalyzeInFlight = true;
  el.innerHTML = '<div class="md:col-span-2 text-center text-purple-300 py-8 text-sm"><i data-lucide="sparkles" class="w-4 h-4 inline-block animate-pulse"></i> AI 正在分析热榜趋势…</div>';
  initIcons(document.getElementById('content-area'));
  // 这是应用里最长的任务之一（约 4 批 LLM）：给实时计时 + 取消（复用 P0-1 的 busyState）
  const busy = busyState(el, { label: '正在分析趋势…', abortKey: 'hot-trends-analyze', before: el.firstElementChild });
  try {
    const result = await localApi(`hot/trends/analyze?days=${days}`, { method: 'POST', body: { force }, abortKey: 'hot-trends-analyze' });
    // 数据不足回溯时实际分析日期可能不是昨天；窗口以服务端归一化后的结果为准，明确告知用户
    const windowText = result?.analyzedDays ? ` · 近 ${result.analyzedDays} 天` : '';
    toast(result?.analyzedDate ? `分析完成（数据日期 ${result.analyzedDate}${windowText}）` : '分析完成', 'success');
    await loadHotTrends();
  } catch (e) {
    if (isAbortError(e)) {
      if (el.isConnected) el.innerHTML = '<div class="md:col-span-2 text-center text-gray-400 py-8 text-sm">已取消分析，上次结果已保留</div>';
      toast('已取消趋势分析', 'info');
    } else if (el.isConnected) {
      el.innerHTML = `<div class="md:col-span-2 text-center text-red-400 py-8 text-sm">分析失败：${esc(e.message)}</div>`;
    }
  } finally {
    trendAnalyzeInFlight = false;
    busy.stop();
  }
}

export async function runSnapshot() {
  const el = document.getElementById('hot-trends');
  if (el) el.innerHTML = '<div class="md:col-span-2 text-center text-gray-400 py-8 text-sm">正在抓取六个平台并保存快照，请稍候…</div>';
  try {
    const result = await localApi('snapshot/run', { method: 'POST', body: {} });
    const okCount = result.platforms.filter(item => item.ok).length;
    toast(`快照完成：${okCount}/${result.platforms.length} 个数据源成功`, okCount ? 'success' : 'error');
    await loadHotTrends();
  } catch (e) {
    toast(e.message, 'error');
    await loadHotTrends();
  }
}
