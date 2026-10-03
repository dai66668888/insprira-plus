import { api, cancelApi } from '../api.js';
import { LS, currentPage } from '../state.js';
import { esc } from '../utils.js';
import { toast } from '../components.js';
import { initIcons } from '../icons.js';
import { platName } from '../config.js';
import { adaptDY, adaptXHS, adaptGZH } from '../core/adapters.js';
import { renderCardItem } from '../core/renderers.js';
import { gotoPage } from '../navigation.js';

let searchRunId = 0;

export async function doSearch() {
  const kw = document.getElementById('searchInput').value.trim();
  if (!kw) { toast('请输入关键词', 'error'); return; }
  await doSearchWith(kw);
}

export async function doSearchWith(kw, options = {}) {
  if (currentPage !== 'search') gotoPage('search');
  document.getElementById('searchInput').value = kw;
  const runId = ++searchRunId;
  ['dy', 'xhs', 'gzh'].forEach(plat => cancelApi(`search-${plat}`));
  const plats = Array.from(document.querySelectorAll('[data-plat]')).filter(c => c.checked).map(c => c.dataset.plat);
  const size = parseInt(document.getElementById('searchSize').value) || 20;
  const cacheKey = `${kw}__${[...plats].sort().join(',')}`;

  const history = LS.get('searchHistory', []);
  const idx = history.findIndex(h => h.kw === kw);
  if (idx >= 0) history.splice(idx, 1);
  history.unshift({ kw, at: new Date().toLocaleString('zh-CN'), plats, count: 0 });
  LS.set('searchHistory', history.slice(0, 50));

  const results = document.getElementById('search-results');
  const status = document.getElementById('search-status');
  document.getElementById('search-history-panel').style.display = 'none';

  // 缓存策略：30 分钟内的同关键词+平台组合直接读缓存（除非显式刷新）
  const CACHE_TTL = 30 * 60 * 1000;
  const cache = LS.get('searchCache', {});
  const cached = cache[cacheKey];
  const useCache = cached && !options.refresh && (Date.now() - cached.at < CACHE_TTL);
  if (useCache) {
    renderSearchResults(kw, cached.items, plats, true);
    return;
  }

  results.innerHTML = '';
  status.innerHTML = `<span class="pulse-dot inline-block w-2 h-2 rounded-full bg-amber-400 mr-1"></span>正在搜索 "${esc(kw)}"…`;

  const apiCalls = [];
  if (plats.includes('dy')) apiCalls.push(api('dySearch', { keyword: kw, offset: 0, sortType: 'default' }, { abortKey: 'search-dy' }));
  if (plats.includes('xhs')) apiCalls.push(api('xhsNewSearch', { keyword: kw, offset: 0, sortType: 'default' }, { abortKey: 'search-xhs' }));
  if (plats.includes('gzh')) apiCalls.push(api('gzhNewSearch', { keyword: kw, offset: 0, sortType: '_0' }, { abortKey: 'search-gzh' }));

  let results3;
  try {
    results3 = await Promise.all(apiCalls);
  } catch (e) {
    if (runId !== searchRunId || e.name === 'AbortError') return;
    status.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 inline"></i> 搜索失败：${esc(e.message || '未知错误')}`;
    initIcons(status);
    return;
  }
  if (runId !== searchRunId) return;
  let allItems = [];
  let i = 0;
  if (plats.includes('dy')) {
    const r = results3[i++];
    const list = (r?.list || []).slice(0, size).map(adaptDY);
    list.forEach(it => it._rank = 0);
    allItems = allItems.concat(list);
  }
  if (plats.includes('xhs')) {
    const r = results3[i++];
    if (r && r.list) {
      const list = r.list.slice(0, size).map(adaptXHS);
      allItems = allItems.concat(list);
    }
  }
  if (plats.includes('gzh')) {
    const r = results3[i++];
    if (r && r.list) {
      const list = r.list.slice(0, size).map(adaptGZH);
      allItems = allItems.concat(list);
    }
  }

  const history2 = LS.get('searchHistory', []);
  if (history2[0]) history2[0].count = allItems.length;
  LS.set('searchHistory', history2);

  allItems = allItems.map((it, idx) => ({ ...it, _rank: idx + 1 }));
  allItems.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

  // 写缓存（最多保留 20 条记录避免 LS 膨胀）
  cache[cacheKey] = { items: allItems, at: Date.now() };
  const cacheKeys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
  if (cacheKeys.length > 20) {
    cacheKeys.slice(20).forEach(k => delete cache[k]);
  }
  LS.set('searchCache', cache);

  renderSearchResults(kw, allItems, plats, false);
}

function renderSearchResults(kw, items, plats, fromCache) {
  window._detailItems = Object.fromEntries(items.map(item => [`${item.plat}:${item.workId}`, item]));
  const status = document.getElementById('search-status');
  const results = document.getElementById('search-results');
  if (!items.length) {
    status.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 inline"></i> 没有找到结果，请换个关键词试试`;
    results.innerHTML = '';
  } else {
    const cacheHint = fromCache ? ` · <span class="text-cyan-400">缓存</span> <button class="text-purple-300 hover:underline" data-action="refreshSearch">重新搜索</button>` : '';
    status.innerHTML = `找到 <b>${items.length}</b> 条结果 · 关键词 "${esc(kw)}" · ${plats.map(platName).join(' / ')}${cacheHint}`;
    results.innerHTML = items.map(renderCardItem).join('');
  }
  initIcons(status);
  initIcons(results);
}

export function showSearchHistory() {
  if (currentPage !== 'search') return;
  const history = LS.get('searchHistory', []);
  const panel = document.getElementById('search-history-panel');
  if (history.length === 0) { panel.style.display = 'none'; return; }
  document.getElementById('search-history').innerHTML = history.map(h => `
    <button class="pill pill-brand cursor-pointer" data-action="doSearchWith" data-kw="${esc(h.kw)}">${esc(h.kw)} <span class="text-gray-500 text-[10px]">${esc(h.at.split(' ')[0])}</span></button>
  `).join('');
  panel.style.display = 'block';
}

export function renderSearch() {
  showSearchHistory();
}
