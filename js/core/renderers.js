import { esc, proxyImage } from '../utils.js';
import { platName } from '../config.js';
import { rankBadge, skeleton } from '../components.js';
import { cacheItem } from './itemCache.js';

const num = v => esc(v == null ? '' : String(v));

export function renderListItem(item, showRank = true) {
  const metrics = item.plat === 'dy'
    ? `<span class="text-orange-400">🔥 ${num(item.like)}</span><span>💬 ${num(item.comment)}</span><span>↗ ${num(item.share)}</span>`
    : item.plat === 'xhs'
    ? `<span class="text-pink-400">❤️ ${num(item.like)}</span><span>💬 ${num(item.comment)}</span><span>⭐ ${num(item.collect)}</span>`
    : `<span class="text-emerald-400">👁 ${num(item.read)}</span><span>👍 ${num(item.like || item.watch)}</span>`;
  return `
    <div class="flex items-center gap-3 p-3 bg-white/[0.02] rounded-lg card" data-action="showDetail" data-plat="${esc(item.plat)}" data-work-id="${esc(item.workId)}">
      ${showRank ? rankBadge(item._rank || 0) : ''}
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm line-clamp-2">${esc(item.title || '(无标题)')}</div>
        <div class="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
          <span>👤 ${esc(item.author || '--')} · ${num(item.authorFans)}粉</span>
          ${metrics}
          <span class="text-gray-600">${esc(item.publishTime || item.createTime || item.publicTime || '')}</span>
        </div>
      </div>
      <button class="btn btn-ghost text-[11px] py-1 px-2" data-action="addToLibraryByKey" data-key="${esc(cacheItem(item))}" title="收藏">
        <i data-lucide="bookmark" class="w-3 h-3"></i>
      </button>
    </div>`;
}

export function renderCardItem(item) {
  const hasCover = item.cover && item.cover.startsWith('http');
  const metrics = item.plat === 'dy'
    ? `<span class="text-orange-400">🔥 ${num(item.like)}</span><span>💬 ${num(item.comment)}</span><span>↗ ${num(item.share)}</span>`
    : item.plat === 'xhs'
    ? `<span class="text-pink-400">❤️ ${num(item.like)}</span><span>⭐ ${num(item.collect)}</span><span>💬 ${num(item.comment)}</span>`
    : `<span class="text-emerald-400">👁 ${num(item.read)}</span><span>👍 ${num(item.like || item.watch)}</span>`;
  return `
    <div class="glass rounded-xl overflow-hidden card" data-action="showDetail" data-plat="${esc(item.plat)}" data-work-id="${esc(item.workId)}">
      <div class="aspect-[16/10] bg-black/40 relative overflow-hidden">
        ${hasCover
          ? `<img src="${esc(proxyImage(item.cover))}" class="w-full h-full object-cover" loading="lazy" data-image-error="placeholder" data-fallback-class="w-12 h-12 text-white/30" />`
          : `<div class="w-full h-full flex items-center justify-center"><i data-lucide="${item.plat === 'dy' ? 'video' : item.plat === 'xhs' ? 'image' : 'file-text'}" class="w-12 h-12 text-white/30"></i></div>`
        }
        <div class="absolute top-2 left-2"><span class="pill ${item.plat === 'dy' ? 'pill-hot' : item.plat === 'xhs' ? 'pill-brand' : 'pill-green'}">${esc(platName(item.plat))}</span></div>
        ${item.plat === 'dy' ? `<div class="absolute inset-0 flex items-center justify-center pointer-events-none"><div class="w-12 h-12 rounded-full bg-black/40 flex items-center justify-center"><i data-lucide="play" class="w-6 h-6 text-white"></i></div></div>` : ''}
      </div>
      <div class="p-3">
        <div class="text-sm font-medium line-clamp-2 mb-1.5 min-h-[2.5em]">${esc(item.title || '(无标题)')}</div>
        <div class="flex items-center justify-between text-[11px] text-gray-500 mb-2">
          <span class="truncate flex-1">👤 ${esc(item.author || '--')}</span>
        </div>
        <div class="flex items-center gap-2 text-[11px] flex-wrap">
          ${metrics}
        </div>
        <button class="btn btn-ghost w-full justify-center text-[11px] py-1 mt-2" data-action="addToLibraryByKey" data-key="${esc(cacheItem(item))}">
          <i data-lucide="bookmark" class="w-3 h-3"></i>收藏
        </button>
      </div>
    </div>`;
}

export { skeleton };
