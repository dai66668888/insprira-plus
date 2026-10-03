import { esc, fmt } from './utils.js';
import { platColor, platName } from './config.js';
import { initIcons } from './icons.js';

// ============= Toast =============
export function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<div class="flex items-center gap-2 text-sm">
    <i data-lucide="${type === 'success' ? 'check-circle' : type === 'error' ? 'x-circle' : 'info'}" class="w-4 h-4 ${type === 'success' ? 'text-emerald-400' : type === 'error' ? 'text-red-400' : 'text-cyan-400'}"></i>
    <span class="toast-msg"></span>
  </div>`;
  t.querySelector('.toast-msg').textContent = String(msg ?? '');
  document.body.appendChild(t);
  initIcons(t);
  setTimeout(() => t.remove(), 2500);
}

// ============= Skeleton =============
export function skeleton(n = 5) {
  return Array(n).fill('').map(() => '<div class="skeleton h-10 w-full"></div>').join('');
}

// ============= Rank Badge =============
export function rankBadge(n) {
  if (n === 1) return `<span class="rank-1 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>`;
  if (n === 2) return `<span class="rank-2 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>`;
  if (n === 3) return `<span class="rank-3 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>`;
  return `<span class="rank-default w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0">${n}</span>`;
}

// ============= Platform Badge =============
export function platformBadge(plat, extraClass = '') {
  const name = platName(plat);
  const colorClass = platColor(plat);
  return `<span class="pill ${plat === 'dy' ? 'pill-hot' : plat === 'xhs' ? 'pill-brand' : 'pill-green'} ${extraClass}">${esc(name)}</span>`;
}

// ============= Metrics =============
export function metrics(item) {
  if (item.plat === 'dy') {
    return `<span class="text-orange-400">🔥 ${fmt(item.like)}</span><span>💬 ${fmt(item.comment)}</span><span>↗ ${fmt(item.share)}</span>`;
  }
  if (item.plat === 'xhs') {
    return `<span class="text-pink-400">❤️ ${fmt(item.like)}</span><span>💬 ${fmt(item.comment)}</span><span>⭐ ${fmt(item.collect)}</span>`;
  }
  return `<span class="text-emerald-400">👁 ${fmt(item.read)}</span><span>👍 ${fmt(item.like || item.watch)}</span>`;
}

// ============= Modal 基类 =============
export class Modal {
  constructor(options = {}) {
    this.title = options.title || '';
    this.body = options.body || '';
    this.maxWidth = options.maxWidth || '480px';
    this.onClose = options.onClose || null;
    this._element = null;
    this._previousFocus = null;
    this._boundKeydown = this._onKeydown.bind(this);
  }

  open() {
    this._previousFocus = document.activeElement;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal" style="max-width:${this.maxWidth};max-height:90vh;overflow:auto" role="dialog" aria-modal="true" aria-label="${esc(this.title)}">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold">${esc(this.title)}</h2>
          <button class="btn btn-ghost py-1 px-2 modal-close" aria-label="关闭"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>
        <div class="modal-body">${this.body}</div>
      </div>
    `;
    mask.addEventListener('click', e => {
      if (e.target === mask) this.close();
    });
    mask.querySelector('.modal-close').addEventListener('click', () => this.close());
    document.body.appendChild(mask);
    this._element = mask;
    document.addEventListener('keydown', this._boundKeydown);
    initIcons(mask);
    const focusable = mask.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (focusable || mask.querySelector('.modal')).focus();
    return this;
  }

  close() {
    if (!this._element) return;
    this._element.remove();
    document.removeEventListener('keydown', this._boundKeydown);
    this._element = null;
    if (this._previousFocus && this._previousFocus.focus) {
      try { this._previousFocus.focus(); } catch {}
    }
    if (this.onClose) this.onClose();
  }

  _onKeydown(e) {
    if (e.key === 'Escape') this.close();
  }

  get bodyElement() {
    return this._element?.querySelector('.modal-body') || null;
  }
}
