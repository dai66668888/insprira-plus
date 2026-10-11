import { esc, fmt, formatElapsed } from './utils.js';
import { platColor, platName } from './config.js';
import { initIcons } from './icons.js';
// 取消长任务：abortKey 与 js/api.js 的控制器 Map 对应，切页时由 cancelAllApi 统一中断
import { cancelApi } from './api.js';

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

// ============= 长任务等待态 =============
// 统一的「生成中」指示：状态点 + 阶段文案（可选）+ 实时计时 + 取消按钮。
// 用途：LLM 长任务（AI 创作 / 选题生成 / AI 排版）—— 替代「写死的占位文案」这种假进度，
// 并让用户能主动中断：取消 = cancelApi(abortKey) 中断 fetch；切页时由 cancelAllApi 统一中断。
// 注意：样式全部走内联 + 已有 class（btn / btn-ghost），不引入新的 Tailwind class，避免必须重跑 build。
export function busyState(host, { label = '', abortKey = '', before = null, onCancel = null } = {}) {
  if (!host) return { el: null, setStage() {}, stop() {} };
  const el = document.createElement('div');
  el.className = 'busy-state';
  el.setAttribute('role', 'status');
  el.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;color:#9ca3af';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:6px;height:6px;border-radius:9999px;background:#22d3ee;flex-shrink:0';
  const text = document.createElement('span');
  text.textContent = label;
  if (!label) text.style.display = 'none';
  const elapsed = document.createElement('span');
  elapsed.style.cssText = 'font-variant-numeric:tabular-nums';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-ghost py-0.5 px-1.5 text-[11px]';
  cancel.textContent = '取消';
  el.append(dot, text, elapsed, cancel);
  if (before && before.parentElement === host) host.insertBefore(el, before);
  else host.appendChild(el);

  const startedAt = Date.now();
  const tick = () => { elapsed.textContent = formatElapsed(Date.now() - startedAt); };
  tick();
  const timer = setInterval(tick, 1000);
  let stopped = false;

  cancel.addEventListener('click', () => {
    if (stopped) return;
    // 取消是「止损」不是「退款」：P1-1 之后服务端会随连接断开真正中断上游 LLM 调用
    // （SSE 路由 res close → AbortController），本次调用不再写 llm_usage；
    // 但上游服务商是否已计费不可控，所以措辞仍保留「止损」。
    cancel.disabled = true;
    cancel.textContent = '正在取消…';
    if (abortKey) cancelApi(abortKey);
    if (onCancel) { try { onCancel(); } catch { /* 回调异常不影响取消流程 */ } }
  });

  return {
    el,
    setStage(value) {
      if (!value) return;
      text.textContent = String(value);
      text.style.display = '';
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      el.remove();
    },
  };
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
