import { localApi } from '../api.js';
import { LS } from '../state.js';
import { esc, fmt, safeExternalUrl } from '../utils.js';
import { platName } from '../config.js';
import { skeleton, toast } from '../components.js';
import { initIcons } from '../icons.js';
import { renderInspirationConfigs, loadInspirationSources } from './settings.js';
import { gotoPage } from '../navigation.js';

let inspirationSelection = new Set();

export async function renderInspiration() {
  const listEl = document.getElementById('inspiration-list');
  const emptyEl = document.getElementById('inspiration-empty');
  if (!listEl) return;
  listEl.innerHTML = skeleton(4);
  try {
    const [filterRes, configs, sources] = await Promise.all([
      localApi((document.getElementById('inspirationFilter')?.value || 'all') === 'trash' ? 'inspirations?deleted=1' : 'inspirations'),
      localApi('inspiration-configs'),
      loadInspirationSources(),
    ]);
    const ideas = filterRes;
    window._inspirations = ideas;
    window._inspirationConfigs = configs;
    window._inspirationSourceOptions = sources;
    renderInspirationSourceCheckboxes();
    const status = document.getElementById('inspiration-status');
    if (status) status.textContent = `${ideas.length} 个选题`;
    const navCount = document.getElementById('nav-inspiration-count');
    if (navCount) navCount.textContent = ideas.length;
    if (!ideas.length) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');
    renderInspirationCards();
  } catch (e) {
    if (listEl.isConnected) listEl.innerHTML = `<div class="lg:col-span-2 text-center text-red-400 py-8">${esc(e.message)}</div>`;
  }
}

export function renderInspirationSourceCheckboxes() {
  const host = document.getElementById('inspiration-sources');
  if (!host) return;
  const sources = window._inspirationSourceOptions || [];
  const checked = new Set([...(window._selectedInspirationSources || ['gzh-search'])]);
  host.innerHTML = sources.map(source => `
    <label title="${esc(source.description || '')}">
      <input type="checkbox" class="accent-purple-500" value="${esc(source.key)}" ${checked.has(source.key) ? 'checked' : ''}>
      <span>${esc(source.label)}</span>
    </label>
  `).join('');
  host.querySelectorAll('input[type="checkbox"]').forEach(box => {
    box.addEventListener('change', () => {
      window._selectedInspirationSources = [...host.querySelectorAll('input[type="checkbox"]:checked')].map(b => b.value);
      updateInspirationSourceLabel();
    });
  });
  const dropdown = document.getElementById('inspiration-source-dropdown');
  if (dropdown && !dropdown.dataset.stopSet) {
    dropdown.addEventListener('click', e => e.stopPropagation());
    dropdown.dataset.stopSet = '1';
  }
  updateInspirationSourceLabel();
}

function updateInspirationSourceLabel() {
  const sources = window._inspirationSourceOptions || [];
  const selected = window._selectedInspirationSources || [];
  const label = document.getElementById('inspiration-source-label');
  if (!label) return;
  if (!selected.length) {
    label.textContent = '数据来源';
    return;
  }
  const names = selected.map(key => sources.find(s => s.key === key)?.label || key);
  label.textContent = selected.length <= 2 ? names.join('、') : `已选 ${selected.length} 项`;
}

export function toggleInspirationSourceDropdown(el) {
  const dropdown = document.getElementById('inspiration-source-dropdown');
  const toggle = document.getElementById('inspiration-source-toggle');
  if (!dropdown || !toggle) return;
  const isOpen = !dropdown.classList.contains('hidden');
  if (isOpen) {
    closeInspirationSourceDropdown();
    return;
  }
  dropdown.classList.remove('hidden');
  toggle.classList.add('open');
  setTimeout(() => {
    document.addEventListener('click', closeInspirationSourceDropdown, { once: true });
  }, 0);
}

function closeInspirationSourceDropdown() {
  const dropdown = document.getElementById('inspiration-source-dropdown');
  const toggle = document.getElementById('inspiration-source-toggle');
  if (dropdown) dropdown.classList.add('hidden');
  if (toggle) toggle.classList.remove('open');
}

function renderInspirationCard(idea, filter) {
  const isTrash = filter === 'trash';
  const sourcePill = idea.sourceMode === 'llm-reasoning'
    ? '<span class="pill pill-amber" title="无热点 · 模型推理"><i data-lucide="brain" class="w-3 h-3"></i>无热点 · 模型推理</span>'
    : idea.sourceMode === 'hot-evidence'
      ? '<span class="pill pill-green"><i data-lucide="database" class="w-3 h-3"></i>热点证据</span>'
      : '';
  const keywords = (idea.sourceKeywords || []).slice(0, 5);
  const moreKeywords = (idea.sourceKeywords || []).length - keywords.length;

  // ===== 头部：图标 + 标题 + 收藏标记 =====
  const head = `
    <div class="flex items-start gap-3">
      ${isTrash
        ? `<input type="checkbox" class="accent-red-500 mt-2 trash-select flex-shrink-0" value="${esc(idea.id)}">`
        : `<input type="checkbox" class="accent-purple-500 mt-2 inspiration-select flex-shrink-0" value="${esc(idea.id)}" ${inspirationSelection.has(idea.id) ? 'checked' : ''}>`}
      <div class="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-300 flex items-center justify-center flex-shrink-0"><i data-lucide="lightbulb" class="w-4 h-4"></i></div>
      <div class="flex-1 min-w-0">
        <h3 class="font-semibold leading-snug text-[15px]">${esc(idea.title)}</h3>
        <div class="text-[10px] text-gray-600 mt-0.5">${new Date(idea.createdAt).toLocaleString('zh-CN')}</div>
      </div>
      ${!isTrash && idea.isFavorite ? '<i data-lucide="bookmark" class="w-4 h-4 text-amber-300 flex-shrink-0 mt-1" data-favorite-mark="1"></i>' : ''}
    </div>`;

  // ===== meta 行：用 pill 组件 =====
  const pills = [
    `<span class="pill pill-amber">${esc(idea.angle || '选题')}</span>`,
    `<span class="pill pill-brand">${esc(idea.targetPlatform || '多平台')}</span>`,
    sourcePill,
    idea.generationType === 'cron' ? '<span class="pill pill-sky">自动生成</span>' : '',
    idea.kbLink ? `<span class="pill pill-green" title="${esc(idea.kbLink.entry_key || idea.kbLink.entryKey || '')}"><i data-lucide="book-open" class="w-3 h-3"></i>知识库参考</span>` : '',
    idea.status ? `<span class="pill pill-gray">${esc(idea.status)}</span>` : '',
  ].filter(Boolean).join('');
  const meta = `<div class="flex items-center gap-1.5 flex-wrap">${pills}</div>`;

  // ===== 正文 =====
  const body = `
    <p class="text-sm text-gray-300 leading-relaxed">${esc(idea.summary)}</p>
    ${keywords.length
      ? `<div class="flex items-center gap-1 flex-wrap mt-2">
          ${keywords.map(k => `<span class="tag"># ${esc(k)}</span>`).join('')}
          ${moreKeywords > 0 ? `<span class="text-[10px] text-gray-600">+${moreKeywords}</span>` : ''}
        </div>`
      : ''}
    ${(idea.sourceItems || []).length
      ? `<details class="mt-2 text-[11px] text-gray-500">
          <summary class="cursor-pointer text-cyan-400 hover:text-cyan-300">参考证据 ${idea.sourceItems.length} 条</summary>
          <div class="space-y-1 mt-1.5 pl-2 border-l border-white/5">
            ${idea.sourceItems.slice(0, 5).map(item => `<a href="${safeExternalUrl(item.url)}" target="_blank" rel="noopener noreferrer" class="block hover:text-gray-300 truncate" title="${esc(`${platName(item.platform) || item.platform || ''} · ${item.title} · ${item.author || ''} · ${fmt(item.readCount)}`)}">· ${esc(item.title)} · ${esc(item.author || '未知')} · ${fmt(item.readCount)}</a>`).join('')}
          </div>
        </details>`
      : ''}
    ${idea.generationNote ? `<div class="text-[10px] mt-2 ${idea.sourceMode === 'llm-reasoning' ? 'text-amber-300/80' : 'text-gray-600'}">${esc(idea.generationNote)}</div>` : ''}`;

  // ===== 操作栏：左侧次要 + 右侧主按钮 =====
  const actions = isTrash
    ? `<div class="flex items-center gap-2">
        <button class="btn btn-ghost py-1 px-2 text-xs text-emerald-300" data-action="restoreInspiration" data-id="${esc(idea.id)}"><i data-lucide="rotate-ccw" class="w-3 h-3"></i>恢复</button>
        <button class="btn btn-ghost py-1 px-2 text-xs text-red-400" data-action="permanentlyDeleteInspiration" data-id="${esc(idea.id)}"><i data-lucide="trash-2" class="w-3 h-3"></i>永久删除</button>
      </div>`
    : `<div class="flex items-center gap-1 flex-wrap">
        <select class="input py-1 text-xs inspiration-status-select flex-shrink-0" style="width:auto" data-id="${esc(idea.id)}">
          ${['待研究','创作中','已发布','已归档'].map(status => `<option ${status===idea.status?'selected':''}>${status}</option>`).join('')}
        </select>
        <div class="w-px h-5 bg-white/10 mx-1"></div>
        <button class="btn btn-ghost py-1 px-1.5 text-xs ${idea.feedbackState === 'like' ? 'text-emerald-300' : 'text-gray-500'}" data-action="feedbackInspiration" data-id="${esc(idea.id)}" data-state="${idea.feedbackState === 'like' ? 'none' : 'like'}" title="感兴趣"><i data-lucide="thumbs-up" class="w-3.5 h-3.5"></i></button>
        <button class="btn btn-ghost py-1 px-1.5 text-xs ${idea.feedbackState === 'dislike' ? 'text-red-300' : 'text-gray-500'}" data-action="feedbackInspiration" data-id="${esc(idea.id)}" data-state="${idea.feedbackState === 'dislike' ? 'none' : 'dislike'}" title="不感兴趣"><i data-lucide="thumbs-down" class="w-3.5 h-3.5"></i></button>
        <button class="btn btn-ghost py-1 px-1.5 text-xs ${idea.feedbackState === 'block' ? 'text-red-400' : 'text-gray-500'}" data-action="feedbackInspiration" data-id="${esc(idea.id)}" data-state="${idea.feedbackState === 'block' ? 'none' : 'block'}" title="加入关键词黑名单"><i data-lucide="ban" class="w-3.5 h-3.5"></i></button>
        <button class="btn btn-ghost py-1 px-1.5 text-xs ${idea.isFavorite ? 'text-amber-300' : 'text-gray-500'}" data-action="toggleInspirationFavorite" data-id="${esc(idea.id)}" data-favorite="${idea.isFavorite ? 'false' : 'true'}" title="收藏"><i data-lucide="bookmark" class="w-3.5 h-3.5"></i></button>
        <button class="btn btn-ghost py-1 px-1.5 text-xs text-gray-500 hover:text-red-400" data-action="trashInspiration" data-id="${esc(idea.id)}" title="移入回收站"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        <button class="btn btn-primary py-1 px-3 text-xs ml-auto flex-shrink-0" data-action="sendIdeaToCreator" data-id="${esc(idea.id)}"><i data-lucide="pen-line" class="w-3 h-3"></i>开始创作</button>
      </div>`;

  return `
    <div class="glass rounded-xl p-4 h-full flex flex-col gap-3" data-inspiration-id="${esc(idea.id)}">
      ${head}
      ${meta}
      <div class="flex-1">${body}</div>
      <div class="pt-2 border-t border-white/5">${actions}</div>
    </div>`;
}

export function renderInspirationCards() {
  const listEl = document.getElementById('inspiration-list');
  if (!listEl) return;
  const filter = document.getElementById('inspirationFilter')?.value || 'all';
  const ideas = (window._inspirations || []).filter(idea =>
    filter === 'trash'
    || filter === 'all'
    || (filter === 'favorite' && idea.isFavorite)
    || idea.feedbackState === filter
  );
  document.getElementById('inspiration-trash-toolbar')?.classList.toggle('hidden', filter !== 'trash');
  document.getElementById('inspiration-select-all-wrap')?.classList.toggle('hidden', filter === 'trash' || !ideas.length);
  listEl.innerHTML = ideas.map(idea => renderInspirationCard(idea, filter)).join('') || '<div class="lg:col-span-2 text-center text-gray-500 py-10">当前筛选下没有选题</div>';
  initIcons(document.getElementById('content-area'));
  updateTrashSelection();
  document.querySelectorAll('.inspiration-select').forEach(box => {
    box.addEventListener('change', () => {
      if (box.checked) inspirationSelection.add(box.value);
      else inspirationSelection.delete(box.value);
      updateInspirationBatchToolbar();
    });
  });
  const selectAll = document.getElementById('inspiration-select-all');
  if (selectAll) {
    selectAll.checked = ideas.length > 0 && ideas.every(i => inspirationSelection.has(i.id));
    selectAll.onclick = () => {
      if (selectAll.checked) ideas.forEach(i => inspirationSelection.add(i.id));
      else ideas.forEach(i => inspirationSelection.delete(i.id));
      renderInspirationCards();
      updateInspirationBatchToolbar();
    };
  }
  updateInspirationBatchToolbar();
}

export function updateInspirationBatchToolbar() {
  const toolbar = document.getElementById('inspiration-batch-toolbar');
  if (!toolbar) return;
  toolbar.classList.toggle('hidden', inspirationSelection.size === 0);
  const count = document.getElementById('inspiration-batch-count');
  if (count) count.textContent = `已选 ${inspirationSelection.size} 项`;
}

export function clearInspirationSelection() {
  inspirationSelection.clear();
  renderInspirationCards();
  updateInspirationBatchToolbar();
}

export async function batchFavoriteInspirations() {
  const ids = [...inspirationSelection];
  if (!ids.length) return;
  try {
    await Promise.all(ids.map(id => localApi(`inspirations/${encodeURIComponent(id)}/favorite`, { method: 'POST', body: { favorite: true } })));
    ids.forEach(id => {
      const idea = (window._inspirations || []).find(i => i.id === id);
      if (idea) idea.isFavorite = true;
    });
    inspirationSelection.clear();
    renderInspirationCards();
    toast(`已收藏 ${ids.length} 个选题`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function batchTrashInspirations() {
  const ids = [...inspirationSelection];
  if (!ids.length) return;
  if (!confirm(`将 ${ids.length} 个选题移入回收站？`)) return;
  try {
    await Promise.all(ids.map(id => localApi(`inspirations/${encodeURIComponent(id)}/trash`, { method: 'POST', body: {} })));
    window._inspirations = (window._inspirations || []).filter(i => !ids.includes(i.id));
    inspirationSelection.clear();
    renderInspirationCards();
    updateInspirationListStatus();
    toast(`已移入回收站 ${ids.length} 个选题`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function onInspirationFilterChange() {
  await renderInspiration();
}

export async function trashInspiration(id) {
  if (!confirm('将该选题移入回收站？')) return;
  try {
    await localApi(`inspirations/${encodeURIComponent(id)}/trash`, { method: 'POST', body: {} });
    window._inspirations = (window._inspirations || []).filter(item => item.id !== id);
    document.querySelector(`[data-inspiration-id="${CSS.escape(id)}"]`)?.remove();
    updateInspirationListStatus();
    toast('已移入回收站', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function restoreInspiration(id) {
  try {
    await localApi(`inspirations/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {} });
    window._inspirations = (window._inspirations || []).filter(item => item.id !== id);
    document.querySelector(`[data-inspiration-id="${CSS.escape(id)}"]`)?.remove();
    updateInspirationListStatus();
    toast('选题已恢复', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function permanentlyDeleteInspiration(id) {
  if (!confirm('永久删除后无法恢复，确定继续？')) return;
  try {
    await localApi(`inspirations/${encodeURIComponent(id)}/permanent`, { method: 'POST', body: {} });
    window._inspirations = (window._inspirations || []).filter(item => item.id !== id);
    document.querySelector(`[data-inspiration-id="${CSS.escape(id)}"]`)?.remove();
    updateInspirationListStatus();
    toast('已永久删除', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export function updateInspirationListStatus() {
  const count = (window._inspirations || []).length;
  const status = document.getElementById('inspiration-status');
  if (status) status.textContent = `${count} 个选题`;
  const list = document.getElementById('inspiration-list');
  if (list && !list.querySelector('[data-inspiration-id]')) {
    list.innerHTML = '<div class="lg:col-span-2 text-center text-gray-500 py-10">当前筛选下没有选题</div>';
  }
  const navCount = document.getElementById('nav-inspiration-count');
  if (navCount && document.getElementById('inspirationFilter')?.value !== 'trash') navCount.textContent = count;
}

export function updateTrashSelection() {
  const boxes = [...document.querySelectorAll('.trash-select')];
  const selected = boxes.filter(box => box.checked);
  const count = document.getElementById('trash-selected-count');
  if (count) count.textContent = `已选择 ${selected.length} 项`;
  const all = document.getElementById('trash-select-all');
  if (all) {
    all.checked = boxes.length > 0 && selected.length === boxes.length;
    all.indeterminate = selected.length > 0 && selected.length < boxes.length;
  }
}

export function toggleAllTrash(checked) {
  document.querySelectorAll('.trash-select').forEach(box => { box.checked = checked; });
  updateTrashSelection();
}

export async function batchDeleteTrash() {
  const ids = [...document.querySelectorAll('.trash-select:checked')].map(box => box.value);
  if (!ids.length) { toast('请先选择要删除的选题', 'error'); return; }
  if (!confirm(`永久删除选中的 ${ids.length} 个选题？此操作无法恢复。`)) return;
  const results = await Promise.allSettled(ids.map(id =>
    localApi(`inspirations/${encodeURIComponent(id)}/permanent`, { method: 'POST', body: {} })
  ));
  const deleted = ids.filter((id, index) => results[index].status === 'fulfilled');
  window._inspirations = (window._inspirations || []).filter(item => !deleted.includes(item.id));
  deleted.forEach(id => document.querySelector(`[data-inspiration-id="${CSS.escape(id)}"]`)?.remove());
  updateInspirationListStatus();
  updateTrashSelection();
  const failed = ids.length - deleted.length;
  toast(failed ? `已删除 ${deleted.length} 项，${failed} 项失败` : `已永久删除 ${deleted.length} 项`, failed ? 'error' : 'success');
}

export async function toggleInspirationFavorite(id, favorite) {
  await localApi(`inspirations/${encodeURIComponent(id)}/favorite`, { method: 'POST', body: { favorite } });
  const idea = (window._inspirations || []).find(item => item.id === id);
  if (idea) idea.isFavorite = favorite;
  renderInspirationCards();
}

export async function feedbackInspiration(id, type) {
  try {
    await localApi(`inspirations/${encodeURIComponent(id)}/feedback`, { method: 'POST', body: { type } });
    const idea = (window._inspirations || []).find(item => item.id === id);
    if (idea) idea.feedbackState = type === 'none' ? '' : type;
    toast(type === 'like' ? '已提高相关关键词权重' : type === 'dislike' ? '已降低相关关键词权重' : type === 'block' ? '相关关键词已加入黑名单' : '已撤销反馈', 'success');
    renderInspirationCards();
    const configs = await localApi('inspiration-configs');
    window._inspirationConfigs = configs;
    renderInspirationSourceCheckboxes();
    renderInspirationConfigs();
  } catch (e) { toast(e.message, 'error'); }
}

export async function generateInspirations() {
  closeInspirationSourceDropdown();
  const domain = document.getElementById('inspirationDomain').value.trim();
  const keywords = document.getElementById('inspirationKeywords').value.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean);
  const sources = [...document.querySelectorAll('#inspiration-sources input[type="checkbox"]:checked')].map(b => b.value);
  document.getElementById('inspiration-status').textContent = '正在生成选题…';
  try {
    const result = await localApi('inspirations/generate', { method: 'POST', body: { domain, keywords, count: 6, sources } });
    const searches = result.research?.searches || [];
    const sourceLabels = {
      api: 'API',
      database: '本地缓存',
      'skipped-budget': '预算跳过',
      'api-failed': 'API 失败',
    };
    const ranges = searches.map(item => {
      const mode = item.mode === 'deep' ? '深度' : '组合';
      const keywords = (item.keywords || [item.keyword]).join('、');
      return `${mode}搜索 ${keywords}（近${item.days}天 ${item.count}篇，${sourceLabels[item.source] || item.source}）`;
    }).join('；');
    const budget = result.research?.apiBudget;
    const cost = budget ? `本轮 API ${budget.usedThisRun}/${budget.limit} 次` : '';
    const basis = result.sourceMode === 'llm-reasoning'
      ? '未找到热点证据，本轮为纯大模型推理'
      : `使用 ${result.research?.articleCount || 0} 条热点证据`;
    const duplicates = result.duplicateCount ? `；过滤 ${result.duplicateCount} 条重复选题` : '';
    const selectedSourceLabels = (window._inspirationSourceOptions || [])
      .filter(s => (result.research?.sources || sources).includes(s.key))
      .map(s => s.label)
      .join('、') || '公众号搜索';
    const engine = document.getElementById('inspiration-engine');
    if (engine) engine.textContent = `来源：${selectedSourceLabels}；${basis}，由 ${result.generatedBy} 生成。${cost}${ranges ? `；${ranges}` : ''}${duplicates}`;
    toast(`已生成 ${result.ideas.length} 个选题`, 'success');
    await renderInspiration();
  } catch (e) {
    toast(e.message, 'error');
    document.getElementById('inspiration-status').textContent = '生成失败';
  }
}

export async function updateInspirationStatus(id, status) {
  try {
    await localApi(`inspirations/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function sendIdeaToCreator(id) {
  const idea = (window._inspirations || []).find(item => item.id === id);
  if (!idea) return;
  let knowledgeText = '';
  if (idea.kbLink?.entry_key) {
    try {
      const entry = await localApi(`kb/entries/${encodeURIComponent(idea.kbLink.entry_key)}`);
      knowledgeText = `\n\n参考知识库：${entry.title}\n${entry.content || ''}`;
    } catch (error) {
      toast('知识库参考加载失败，将仅使用选题信息', 'error');
    }
  }
  LS.set('creatorSource', {
    plat: 'idea',
    title: idea.title,
    summary: `${idea.summary}${knowledgeText}`,
    author: idea.angle,
    sourceKeywords: idea.sourceKeywords,
    kbLink: idea.kbLink,
  });
  gotoPage('creator');
}
