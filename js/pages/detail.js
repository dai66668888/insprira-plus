import { api } from '../api.js';
import { esc, fmt, proxyImage, safeExternalUrl, renderMarkdown, renderWechatArticle, prepareMarkdownLinks } from '../utils.js';

import { platName, platColor } from '../config.js';
import { skeleton } from '../components.js';
import { initIcons } from '../icons.js';
import { adaptDY, adaptXHS, adaptGZH } from '../core/adapters.js';
import { cacheItem } from '../core/itemCache.js';
import { gotoPage } from '../navigation.js';

export async function showDetail(plat, workId) {
  gotoPage('detail');
  document.getElementById('detail-source').textContent = `加载 ${platName(plat)} 作品 ${workId}…`;
  document.getElementById('detail-content').innerHTML = skeleton(4);

  let item = null;
  try {
    if (plat === 'dy') {
      const data = await api('dyDetail', { workId });
      if (data) item = adaptDY(data);
    } else if (plat === 'xhs') {
      const data = await api('xhsDetail', { workId });
      if (data) item = adaptXHS(data);
    } else if (plat === 'gzh') {
      let data = null;
      const sourceItem = window._detailItems?.[`${plat}:${workId}`] || {};
      let articleUrl = sourceItem.url || '';
      let biz = '';
      let mid = '';
      let idx = '';
      let sn = '';
      try {
        const parsed = new URL(articleUrl);
        biz = parsed.searchParams.get('__biz') || '';
        mid = parsed.searchParams.get('mid') || '';
        idx = parsed.searchParams.get('idx') || '';
        sn = parsed.searchParams.get('sn') || '';
      } catch {}
      if (workId.includes(':')) {
        [biz, mid] = workId.split(':');
      }
      if (workId && !workId.includes(':')) data = await api('gzhDetail', { workUuid: workId, url: articleUrl });
      if (!data && biz && mid) data = await api('gzhArticleDetail', { biz, mid, idx, sn, url: articleUrl });
      if (data && sourceItem) data = { ...sourceItem, ...data };
      if (data) item = adaptGZH(data);
    }
  } catch (e) {
    console.error(e);
  }

  if (!item) {
    document.getElementById('detail-content').innerHTML = '<div class="col-span-3 text-center text-red-400 py-12">未找到该作品</div>';
    return;
  }

  cacheItem(item);
  document.getElementById('detail-source').innerHTML = `<span class="platform-dot ${platColor(item.plat)}"></span> ${platName(item.plat)} · 作品 ${item.workId}`;

  const isVideo = item.plat === 'dy';
  const isArticle = item.plat === 'xhs' || item.plat === 'gzh';

  let coverHtml = '';
  if (item.cover && item.cover.startsWith('http')) {
    coverHtml = `
      <div class="aspect-video bg-black/40 relative overflow-hidden">
        <img src="${proxyImage(item.cover)}" alt="" class="w-full h-full object-cover" referrerpolicy="no-referrer" data-image-error="placeholder" data-fallback-class="w-16 h-16 text-white/30" />
        ${isVideo ? `<div class="absolute inset-0 flex items-center justify-center pointer-events-none"><div class="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center"><i data-lucide="play" class="w-8 h-8 text-white"></i></div></div>` : ''}
        ${isVideo && item.duration ? `<div class="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded">${item.duration}</div>` : ''}
      </div>`;
  } else {
    coverHtml = `<div class="aspect-video bg-gradient-to-br from-purple-600 via-pink-500 to-orange-500 flex items-center justify-center"><i data-lucide="${isVideo?'video':'file-text'}" class="w-16 h-16 text-white/30"></i></div>`;
  }

  let metricsHtml = '';
  if (item.plat === 'dy') {
    metricsHtml = `
      <div class="grid grid-cols-5 gap-3 pt-4 border-t border-white/5">
        <div class="text-center"><div class="text-lg font-bold text-orange-400">${item.like}</div><div class="text-[10px] text-gray-500 mt-0.5">点赞</div></div>
        <div class="text-center"><div class="text-lg font-bold text-pink-400">${item.comment}</div><div class="text-[10px] text-gray-500 mt-0.5">评论</div></div>
        <div class="text-center"><div class="text-lg font-bold text-purple-400">${item.share}</div><div class="text-[10px] text-gray-500 mt-0.5">分享</div></div>
        <div class="text-center"><div class="text-lg font-bold text-cyan-400">${item.collect}</div><div class="text-[10px] text-gray-500 mt-0.5">收藏</div></div>
        <div class="text-center"><div class="text-lg font-bold text-emerald-400">${item.play || '--'}</div><div class="text-[10px] text-gray-500 mt-0.5">播放</div></div>
      </div>`;
  } else if (item.plat === 'xhs') {
    metricsHtml = `
      <div class="grid grid-cols-4 gap-3 pt-4 border-t border-white/5">
        <div class="text-center"><div class="text-lg font-bold text-pink-400">${item.like}</div><div class="text-[10px] text-gray-500 mt-0.5">点赞</div></div>
        <div class="text-center"><div class="text-lg font-bold text-orange-400">${item.collect}</div><div class="text-[10px] text-gray-500 mt-0.5">收藏</div></div>
        <div class="text-center"><div class="text-lg font-bold text-cyan-400">${item.comment}</div><div class="text-[10px] text-gray-500 mt-0.5">评论</div></div>
        <div class="text-center"><div class="text-lg font-bold text-purple-400">${item.share}</div><div class="text-[10px] text-gray-500 mt-0.5">分享</div></div>
      </div>`;
  } else if (item.plat === 'gzh') {
    metricsHtml = `
      <div class="grid grid-cols-3 gap-3 pt-4 border-t border-white/5">
        <div class="text-center"><div class="text-lg font-bold text-emerald-400">${item.read}</div><div class="text-[10px] text-gray-500 mt-0.5">阅读</div></div>
        <div class="text-center"><div class="text-lg font-bold text-amber-400">${item.like || item.watch || '--'}</div><div class="text-[10px] text-gray-500 mt-0.5">在看</div></div>
        <div class="text-center"><div class="text-lg font-bold text-cyan-400">${item.comment || '--'}</div><div class="text-[10px] text-gray-500 mt-0.5">评论</div></div>
      </div>`;
  }

  let scoreHtml = '';
  if (item.relevanceScore != null) {
    const rs = (item.relevanceScore || 0).toFixed(1);
    const ps = (item.popularityScore || 0).toFixed(1);
    const ts = (item.recencyScore || 0).toFixed(1);
    const tot = (item.totalScore || 0).toFixed(1);
    scoreHtml = `
      <div class="glass rounded-xl p-5">
        <h3 class="font-semibold mb-4 flex items-center gap-2"><i data-lucide="bar-chart-3" class="w-4 h-4 text-cyan-400"></i>选题评分（4 维）</h3>
        <div class="space-y-3">
          <div><div class="flex justify-between text-xs mb-1"><span class="text-gray-400">相关性</span><span class="text-purple-300 font-semibold">${rs}</span></div><div class="progress-bar"><div style="width:${rs*10}%"></div></div></div>
          <div><div class="flex justify-between text-xs mb-1"><span class="text-gray-400">热度</span><span class="text-orange-300 font-semibold">${ps}</span></div><div class="progress-bar"><div style="width:${ps*10}%"></div></div></div>
          <div><div class="flex justify-between text-xs mb-1"><span class="text-gray-400">时效</span><span class="text-cyan-300 font-semibold">${ts}</span></div><div class="progress-bar"><div style="width:${ts*10}%"></div></div></div>
          <div><div class="flex justify-between text-xs mb-1"><span class="text-gray-400">总分</span><span class="text-pink-300 font-semibold">${tot}</span></div><div class="progress-bar"><div style="width:${tot*10}%"></div></div></div>
        </div>
      </div>`;
  }

  const authorHtml = `
    <div class="glass rounded-xl p-5">
      <div class="flex items-start gap-3">
        <div class="cover-thumb">${esc((item.author || '?')[0])}${item.authorAvatar ? `<img src="${proxyImage(item.authorAvatar)}" alt="" data-image-error="remove" />` : ''}</div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold">${item.author || '—'}</div>
          <div class="text-xs text-gray-500 mt-0.5">${item.authorFans || '—'} 粉丝</div>
          <button class="btn btn-primary w-full justify-center mt-3 py-1.5" data-action="addToTracker" data-plat="${item.plat}" data-author="${esc(item.author)}" data-author-id="${item.authorId||''}">
            <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>关注追踪
          </button>
        </div>
      </div>
    </div>`;

  const actionHtml = `
    <div class="glass rounded-xl p-5">
      <h3 class="font-semibold mb-3 flex items-center gap-2"><i data-lucide="zap" class="w-4 h-4 text-amber-400"></i>快捷操作</h3>
      <div class="space-y-2">
        <button class="btn btn-ghost w-full justify-start" data-action="addToLibraryByKey" data-key="${item.plat}:${item.workId}">
          <i data-lucide="bookmark" class="w-3.5 h-3.5"></i>收藏到素材库
        </button>
        <button class="btn btn-ghost w-full justify-start" data-action="sendToCreatorByKey" data-key="${item.plat}:${item.workId}">
          <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>发送到 AI 创作
        </button>
        ${item.url ? `<a class="btn btn-ghost w-full justify-start" href="${safeExternalUrl(item.url)}" target="_blank" rel="noopener noreferrer">
          <i data-lucide="external-link" class="w-3.5 h-3.5"></i>打开原作品
        </a>` : ''}
      </div>
    </div>`;

  let summaryHtml = '';
  if (item.content && item.content.length > 200) {
    summaryHtml = `<article class="wechat-article py-3">${item.plat === 'gzh' ? renderWechatArticle(item.content) : renderMarkdown(item.content)}</article>`;
  } else if (item.summary || item.desc || item.content) {
    summaryHtml = `<div class="bg-white/[0.02] rounded-lg p-3 text-sm text-gray-300 leading-relaxed mb-4">${esc(item.summary || item.desc || item.content || '')}</div>
      ${item.plat === 'gzh' ? '<div class="text-[11px] text-amber-400 mb-3">该接口未返回完整正文，可通过“打开原作品”查看。</div>' : ''}`;
  }

  document.getElementById('detail-content').innerHTML = `
    <div class="lg:col-span-2 min-w-0 space-y-5">
      <div class="glass-strong rounded-xl overflow-hidden">
        ${coverHtml}
        <div class="p-5 md:p-8">
          <h1 class="text-2xl md:text-3xl leading-tight font-bold mb-4">${esc(item.title || '(无标题)')}</h1>
          <div class="flex items-center gap-2 mb-4 text-sm text-gray-400 flex-wrap">
            <span>@${item.author || '—'}</span>
            <span>·</span>
            <span>${item.authorFans || '—'} 粉丝</span>
            <span>·</span>
            <span>${item.publishTime || item.createTime || item.publicTime || '—'}</span>
          </div>
          ${summaryHtml}
          ${metricsHtml}
        </div>
      </div>
    </div>
    <div class="space-y-5 detail-sidebar">
      ${authorHtml}
      ${scoreHtml}
      ${actionHtml}
    </div>
  `;
  const article = document.querySelector('.wechat-article');
  if (article) {
    prepareMarkdownLinks(article);
    article.querySelectorAll('img').forEach(image => {
      image.src = proxyImage(image.getAttribute('src'));
    });
  }
  initIcons(document.getElementById('detail-content'));
}
