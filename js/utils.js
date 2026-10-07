// ============= 通用工具 =============
// markdown-guard 是纯函数模块（无 DOM 依赖），供 renderMarkdown 在进 marked 前清洗输入
import { extractDataUrls, markdownToPlainText, normalizeMarkdown } from './core/markdown-guard.js';

// ============= 格式化 =============
export const fmt = n => {
  if (n == null || n === '') return '--';
  if (typeof n === 'string') return n;
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
};

// ============= UUID 生成（带降级） =============
// 优先用浏览器的 crypto.randomUUID（仅在 secure context 暴露：HTTPS / localhost / 127.0.0.1）。
// 通过局域网 IP、0.0.0.0 等访问时 randomUUID 可能是 undefined，降级到 RFC4122 v4 的 Math.random 实现。
export function genUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============= HTML 转义 =============
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

// ============= 安全外部链接 =============
export const safeExternalUrl = value => {
  try {
    const url = new URL(String(value || ''), location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
};

// ============= 耗时文案 =============
// 长任务（LLM 生成）等待期的计时显示：60 秒以内显示「N 秒」，超过则「M 分 SS 秒」。
// 非法输入（NaN / 负数 / 非数字）一律兜底成「0 秒」，避免等待期出现「NaN 秒」这种字样。
export function formatElapsed(ms) {
  const value = Number(ms);
  const seconds = Number.isFinite(value) && value > 0 ? Math.floor(value / 1000) : 0;
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}

// ============= Markdown 渲染 =============
// 喂给 marked 之前先过一遍解析护栏（js/core/markdown-guard.js）：畸形图片标签、超长定界符串、
// 超深引用嵌套都会让 marked 递归爆栈（页面报「…Maximum call stack size exceeded Please report this
// to https://github.com/markedjs/marked.」，那句尾巴是 marked 给任何解析期异常加的）。
// 这里再兜一层 try-catch：解析异常一律降级输出纯文本，避免整页卡死。
export function renderMarkdown(value) {
  const source = String(value || '');
  if (!source) return '<p class="text-gray-500">（无内容）</p>';
  if (!window.marked || !window.DOMPurify) {
    return `<pre class="whitespace-pre-wrap">${esc(source)}</pre>`;
  }
  try {
    // dataURL 图片先抽成短占位符（marked 不必解析几百 KB 的 base64），产物渲染后回填
    const { markdown, restore } = extractDataUrls(source);
    const html = marked.parse(normalizeMarkdown(markdown), { gfm: true, breaks: true });
    return DOMPurify.sanitize(restore(html), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['style'],
    });
  } catch {
    return `<pre class="whitespace-pre-wrap">${esc(markdownToPlainText(source))}</pre>`;
  }
}

export function renderWechatArticle(value) {
  const source = String(value || '').trim();
  if (!source) return '<p class="text-gray-500">（无正文）</p>';
  const looksLikeHtml = /<(?:article|p|section|div|img|br|h[1-6]|blockquote|pre|ul|ol|table)\b/i.test(source);
  if (looksLikeHtml && window.DOMPurify) {
    return DOMPurify.sanitize(source, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'script'],
      FORBID_ATTR: ['style', 'onerror', 'onload'],
    });
  }
  const looksLikeMarkdown = /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|~~~)|\[[^\]]+\]\([^)]+\)|`[^`\n]+`|\|.+\|/m.test(source);
  if (looksLikeMarkdown) return renderMarkdown(source);
  const paragraphs = source
    .split(/\n\s*\n|\n+/)
    .map(part => part.trim())
    .filter(Boolean);
  if (paragraphs.length <= 3) {
    return source.split(/ {2,}/).map(part => part.trim()).filter(Boolean)
      .map(paragraph => `<p>${esc(paragraph)}</p>`).join('');
  }
  return paragraphs.map(paragraph => `<p>${esc(paragraph)}</p>`).join('');
}

export function prepareMarkdownLinks(container) {
  if (!container) return;
  container.querySelectorAll('a[href]').forEach(link => {
    const href = safeExternalUrl(link.getAttribute('href'));
    if (href === '#') {
      link.removeAttribute('href');
      return;
    }
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  container.querySelectorAll('img').forEach(image => {
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
  });
}

// ============= 图片代理 =============
export const proxyImage = url => {
  if (!url) return '';
  try {
    const host = new URL(url, location.href).hostname;
    return /(^|\.)qpic\.cn$|(^|\.)qlogo\.cn$|(^|\.)redfox\.hk$/.test(host)
      ? `/api/_/image?url=${encodeURIComponent(url)}`
      : url;
  } catch {
    return '';
  }
};

// ============= 日期 =============
export const dateYmd = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ============= 剪贴板 =============
export async function copyToClipboard(text, { onSuccess, onError } = {}) {
  try {
    await navigator.clipboard.writeText(String(text ?? ''));
    if (onSuccess) onSuccess();
  } catch {
    if (onError) onError();
  }
}
