import { toast } from './components.js';

export function initErrorBoundary() {
  if (window.__errorBoundaryInstalled) return;
  window.__errorBoundaryInstalled = true;

  window.addEventListener('error', event => {
    console.error('[全局错误]', event.error || event.message, event.filename, event.lineno);
    const msg = event.error?.message || event.message || '脚本运行时错误';
    toast(`运行时错误：${msg}`, 'error');
  });

  window.addEventListener('unhandledrejection', event => {
    console.error('[未处理 Promise 拒绝]', event.reason);
    const msg = event.reason?.message || String(event.reason || '未知异步错误');
    toast(`异步错误：${msg}`, 'error');
  });
}
