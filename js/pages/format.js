// ============= 公众号排版工作台 =============
// 三栏工作台：左编辑（Markdown + 工具栏 + 粘贴截图）/ 中预览（手机框 · 消毒 · 防抖）/ 右设置（模板 · 微调 · 复制）
// 排版内核：js/core/wechat-format/（移植自 mspringjade/wechat-formatter，AGPL-3.0）
// 工具栏操作移植上游 app/_hooks/use-markdown-tools.ts 子集；PR-1 范围：编辑/预览/模板/微调/复制/偏好持久化。
import { LS } from '../state.js';
import { esc, proxyImage } from '../utils.js';
import { busyState, toast, Modal } from '../components.js';
import { initIcons } from '../icons.js';
import { localApi, isAbortError } from '../api.js';
import { makeEngine, DEFAULT_TWEAKS } from '../core/wechat-format/engine.js';
import { markdownToPlainText, repairPlaceholderImageSyntax } from '../core/markdown-guard.js';

const RENDER_DEBOUNCE = 300;   // 预览重渲染防抖
const SAVE_DEBOUNCE = 600;     // Markdown 草稿落 localStorage 防抖
const AI_INPUT_LIMIT = 15000;  // AI 排版输入上限（与服务端 lib/routes/mp-format.js 一致，上游同值）

let engine = null;
let activeCategory = LS.get('wf:category', 'minimalist');
let currentTemplateId = LS.get('wf:templateId', 'minimalist-0');
let currentTweaks = mergeTweaks(LS.get('wf:tweaks', {}));
// 粘贴截图/本地图片的内存占位符表：#img-N → dataURL。
// dataURL 不进 localStorage（体积太大），刷新后失效——与上游机制一致。
const imageMap = new Map();
let imageCounter = 0;
let renderTimer = null;
let saveTimer = null;

// ============= 示例文本（上游 sampleText 精简版） =============
const SAMPLE_TEXT = `# 公众号排版助手示例

把 **Markdown** 粘贴进左侧，中间立刻得到带内联样式的排版预览。支持 ==高亮==、^上标^、~下标~、行内代码 \`fmt()\` 与 [链接](https://example.com)。

## 特性一览

1. 72 套模板：6 大风格 × 12 配色
2. 微调字号、行高、段距、留白与图片圆角
3. 复制后直接粘贴进公众号后台

- [x] 实时预览
- [ ] 待办事项（任务复选框）
- 直接粘贴截图即可插图

> 排版是无声的语言，传递着作者的态度。

| 功能 | 状态 |
| --- | --- |
| 实时预览 | ✅ |
| 一键复制 | ✅ |
| 草稿箱同步 | 🔜 后续版本 |

\`\`\`js
function hello() {
  console.log('排版内核已就绪');
}
\`\`\`

![示例图](https://picsum.photos/seed/insprira/800/400)

![图一](https://picsum.photos/seed/wf1/400/300) ![图二](https://picsum.photos/seed/wf2/400/300) ![图三](https://picsum.photos/seed/wf3/400/300)
`;

// ============= 初始化与引擎 =============
function mergeTweaks(saved) {
  const t = { ...DEFAULT_TWEAKS };
  if (!saved || typeof saved !== 'object') return t;
  for (const key of Object.keys(t)) {
    const v = saved[key];
    if (typeof v === 'undefined') continue;
    if (typeof t[key] === 'boolean') t[key] = !!v;
    else if (key === 'themeColor') t[key] = typeof v === 'string' ? v : '';
    else if (key === 'h1Layout' || key === 'h2Layout') {
      if (['left', 'center', 'right'].includes(v)) t[key] = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) t[key] = v;
  }
  return t;
}

function ensureEngine() {
  if (engine) return engine;
  if (!window.marked || !window.marked.Marked || !window.marked.Renderer) {
    toast('marked 库未加载，排版内核不可用', 'error');
    return null;
  }
  engine = makeEngine({ Marked: window.marked.Marked, Renderer: window.marked.Renderer });
  return engine;
}

function getTemplate(id) {
  const list = engine?.allTemplates || [];
  return list.find(t => t.id === id) || list[0] || null;
}

// ============= 页面入口 =============
export function renderFormat() {
  const ok = !!ensureEngine();
  const editor = document.getElementById('formatEditor');
  if (!editor) return;
  editor.value = LS.get('wf:markdown', '');
  renderCategoryTabs();
  renderTemplateGrid();
  renderTweaksPanel();
  editor.addEventListener('input', () => {
    updateWordCount();
    scheduleRender();
    scheduleSaveDraft();
  });
  editor.addEventListener('paste', handleEditorPaste);
  document.getElementById('formatTweaksPanel')?.addEventListener('change', onTweaksPanelChange);
  updateWordCount();
  if (ok) doRender();
  else showPreviewHint('排版内核依赖的 marked 未加载，请检查 vendor/marked.min.js');
}

function showPreviewHint(text) {
  const preview = document.getElementById('formatPreview');
  if (preview) preview.innerHTML = `<div class="p-4 text-xs text-gray-400">${esc(text)}</div>`;
}

// ============= 左栏：编辑器 =============
function updateWordCount() {
  const editor = document.getElementById('formatEditor');
  const el = document.getElementById('formatWordCount');
  if (!editor || !el) return;
  const chars = editor.value.replace(/\s/g, '').length;
  const minutes = Math.max(1, Math.ceil(chars / 400));
  el.textContent = `${chars} 字 · 约 ${minutes} 分钟读完`;
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, RENDER_DEBOUNCE);
}

function scheduleSaveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const editor = document.getElementById('formatEditor');
    if (editor) LS.set('wf:markdown', editor.value);
  }, SAVE_DEBOUNCE);
}

// 粘贴截图：拦截剪贴板中的图片文件 → dataURL 存内存表 → 插入 #img-N 占位符
function handleEditorPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = ev => insertPlaceholderImage(String(ev.target?.result || ''), '图片');
      reader.readAsDataURL(file);
      break;
    }
  }
}

function insertPlaceholderImage(dataUrl, desc) {
  if (!dataUrl) return;
  imageCounter += 1;
  const id = `img-${imageCounter}`;
  imageMap.set(id, dataUrl);
  insertAtCursor(`\n![${desc}](#${id})\n`);
  scheduleRender();
  scheduleSaveDraft();
}

function insertAtCursor(text) {
  const textarea = document.getElementById('formatEditor');
  if (!textarea) return;
  const scrollTop = textarea.scrollTop;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
  const pos = start + text.length;
  textarea.setSelectionRange(pos, pos);
  textarea.focus();
  textarea.scrollTop = scrollTop;
}

// 渲染前把 #img-N 占位符替换为真实 dataURL / URL
// 注意：AI 排版/手工编辑常把右括号吃掉（![图](#img-1），那时占位符匹配不上、图片直接丢失，
// 所以先用 repairPlaceholderImageSyntax 补括号再替换。
function resolvePlaceholderImages(markdown) {
  return repairPlaceholderImageSyntax(String(markdown || ''))
    .replace(/(!\[[^\]]*\]\()#(img-\d+)(\))/g, (m, pre, id, post) => {
      const url = imageMap.get(id);
      return url ? `${pre}${url}${post}` : m;
    });
}

// ============= 工具栏（移植 use-markdown-tools.ts 子集） =============
export function formatTool(tool) {
  const actions = {
    h1: () => insertHeading(1),
    h2: () => insertHeading(2),
    h3: () => insertHeading(3),
    bold: () => insertMarkdown('**', '**', '加粗文字'),
    italic: () => insertMarkdown('*', '*', '斜体文字'),
    del: () => insertMarkdown('~~', '~~', '删除文字'),
    hl: () => insertMarkdown('==', '==', '高亮文字'),
    sup: () => insertMarkdown('^', '^', '上标'),
    sub: () => insertMarkdown('~', '~', '下标'),
    quote: () => insertLinePrefix('> ', '引用内容'),
    ul: () => insertList('ul'),
    ol: () => insertList('ol'),
    table: insertTable,
    code: insertCodeBlock,
    link: insertLink,
    hr: () => insertAtCursor('\n---\n\n'),
  };
  actions[tool]?.();
  scheduleRender();
  scheduleSaveDraft();
}

// 包裹选区：prefix + 选中文字（或占位文字）+ suffix，光标落在 suffix 后
function insertMarkdown(prefix, suffix = prefix, placeholder = '') {
  const textarea = document.getElementById('formatEditor');
  if (!textarea) return;
  const scrollTop = textarea.scrollTop;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const body = selected || placeholder;
  textarea.value = textarea.value.substring(0, start) + prefix + body + suffix + textarea.value.substring(end);
  const pos = start + prefix.length + body.length;
  textarea.setSelectionRange(pos, pos);
  textarea.focus();
  textarea.scrollTop = scrollTop;
}

// 行首前缀（引用）：光标所在行行首插入，选区跨多行时逐行加
function insertLinePrefix(prefix, placeholder = '') {
  const textarea = document.getElementById('formatEditor');
  if (!textarea) return;
  const scrollTop = textarea.scrollTop;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  if (start === end && !value.substring(start, start + placeholder.length)) {
    const body = placeholder;
    // 空选区：在当前行行首插入 "> 引用内容"
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    textarea.value = value.substring(0, lineStart) + prefix + body + value.substring(lineStart);
    const pos = lineStart + prefix.length + body.length;
    textarea.setSelectionRange(pos, pos);
  } else {
    const selected = value.substring(start, end) || placeholder;
    const lines = selected.split('\n').map(line => prefix + line).join('\n');
    textarea.value = value.substring(0, start) + lines + value.substring(end);
    const pos = start + lines.length;
    textarea.setSelectionRange(pos, pos);
  }
  textarea.focus();
  textarea.scrollTop = scrollTop;
}

function insertHeading(level) {
  const textarea = document.getElementById('formatEditor');
  if (!textarea) return;
  const scrollTop = textarea.scrollTop;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const prefix = '#'.repeat(level) + ' ';
  const body = selected || '标题';
  textarea.value = textarea.value.substring(0, start) + prefix + body + textarea.value.substring(end);
  const pos = start + prefix.length;
  textarea.setSelectionRange(pos, pos + body.length);
  textarea.focus();
  textarea.scrollTop = scrollTop;
}

function insertList(type) {
  const textarea = document.getElementById('formatEditor');
  if (!textarea) return;
  const scrollTop = textarea.scrollTop;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const prefix = type === 'ol' ? '1. ' : '- ';
  const body = selected || '列表项';
  textarea.value = textarea.value.substring(0, start) + prefix + body + textarea.value.substring(end);
  const pos = start + prefix.length;
  textarea.setSelectionRange(pos, pos + body.length);
  textarea.focus();
  textarea.scrollTop = scrollTop;
}

function insertTable() {
  const textarea = document.getElementById('formatEditor');
  if (!textarea) return;
  const scrollTop = textarea.scrollTop;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const template = '\n| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |\n';
  textarea.value = textarea.value.substring(0, start) + template + textarea.value.substring(end);
  textarea.setSelectionRange(start + 3, start + 5);
  textarea.focus();
  textarea.scrollTop = scrollTop;
}

function insertCodeBlock() {
  const textarea = document.getElementById('formatEditor');
  if (!textarea) return;
  const scrollTop = textarea.scrollTop;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const body = selected || '代码';
  const block = '```js\n' + body + '\n```';
  textarea.value = textarea.value.substring(0, start) + block + textarea.value.substring(end);
  const pos = start + block.length - 4;
  textarea.setSelectionRange(pos, pos);
  textarea.focus();
  textarea.scrollTop = scrollTop;
}

function insertLink() {
  const textarea = document.getElementById('formatEditor');
  if (!textarea) return;
  const scrollTop = textarea.scrollTop;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const text = selected || '链接文字';
  const markdown = `[${text}](url)`;
  textarea.value = textarea.value.substring(0, start) + markdown + textarea.value.substring(end);
  const urlStart = start + text.length + 3;
  textarea.setSelectionRange(urlStart, urlStart + 3);
  textarea.focus();
  textarea.scrollTop = scrollTop;
}

// ============= 插入图片 =============
export function formatInsertImage() {
  const modal = new Modal({
    title: '插入图片',
    maxWidth: '420px',
    body: `
      <div class="space-y-3 text-sm">
        <div>
          <label class="text-xs text-gray-400 mb-1 block">图片描述（alt）</label>
          <input class="input" id="formatImageDesc" placeholder="图片">
        </div>
        <div>
          <label class="text-xs text-gray-400 mb-1 block">图片 URL</label>
          <input class="input" id="formatImageUrl" placeholder="https://…">
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-primary py-1.5 text-xs" data-action="formatInsertImageUrl">按 URL 插入</button>
          <button class="btn btn-ghost py-1.5 text-xs" data-action="formatPickLocalImage"><i data-lucide="upload" class="w-3.5 h-3.5"></i>选择本地图片</button>
          <input type="file" id="formatImageFile" accept="image/*" class="hidden">
        </div>
        <p class="text-[11px] text-gray-500 leading-relaxed">本地图片以内存占位符 #img-N 插入 Markdown，预览与复制时自动替换为真实图片；刷新页面后失效，不会撑爆草稿存档。</p>
      </div>`,
  });
  modal.open();
  modal.bodyElement?.querySelector('#formatImageFile')?.addEventListener('change', onFormatImageFileChange);
}

export function formatPickLocalImage() {
  document.getElementById('formatImageFile')?.click();
}

function onFormatImageFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const desc = document.getElementById('formatImageDesc')?.value.trim() || '图片';
  const reader = new FileReader();
  reader.onload = ev => {
    insertPlaceholderImage(String(ev.target?.result || ''), desc);
    e.target.closest('.modal-mask')?.remove();
  };
  reader.readAsDataURL(file);
}

export function formatInsertImageUrl() {
  const url = document.getElementById('formatImageUrl')?.value.trim();
  if (!url) { toast('请输入图片 URL', 'error'); return; }
  const desc = document.getElementById('formatImageDesc')?.value.trim() || '图片';
  insertAtCursor(`![${desc}](${url})`);
  document.getElementById('formatImageUrl')?.closest('.modal-mask')?.remove();
  scheduleRender();
  scheduleSaveDraft();
}

// 整篇替换编辑器内容：走 execCommand('insertText') 保留浏览器原生撤销栈（Ctrl+Z 可回退），
// 不支持时降级直接赋值（撤销栈会丢失，属可接受降级）
function replaceEditorText(text) {
  const editor = document.getElementById('formatEditor');
  if (!editor) return;
  editor.focus();
  let replaced = false;
  try {
    editor.setSelectionRange(0, editor.value.length);
    replaced = document.execCommand('insertText', false, text);
  } catch { replaced = false; }
  if (!replaced) editor.value = text;
}

// ============= AI 一键排版（方案 §5.3 / PR-2） =============
// 服务端只调结构不改写内容；成功后整篇替换编辑器并刷新预览。旧文有 LS 草稿兜底，可「清空后撤销」无门时靠 Ctrl+Z。
export async function formatAiLayout() {
  const editor = document.getElementById('formatEditor');
  const btn = document.getElementById('formatAiBtn');
  if (!editor || !editor.value.trim()) { toast('请先输入或载入 Markdown', 'error'); return; }
  if (editor.value.length > AI_INPUT_LIMIT) {
    toast(`内容过长（${editor.value.length} 字符），AI 排版请控制在 ${AI_INPUT_LIMIT} 字符以内`, 'error');
    return;
  }
  if (btn && btn.disabled) return;
  const setBtnLoading = (loading) => {
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>排版中…'
      : '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i>AI 一键排版';
    initIcons(btn);
  };
  setBtnLoading(true);
  // 等待态：按钮已有 spinner，这里再补「实时计时 + 取消」——AI 排版可能跑几十秒，
  // 用户需要知道还要等多久，并能主动中断（取消/切页都能中断等待）
  const busy = busyState(editor.parentElement, { label: '正在排版…', abortKey: 'format-ai', before: editor });
  try {
    // localApi 会解包 { ok, data }，成功拿到 { markdown }；失败抛 Error(error)
    const data = await localApi('mp-format/ai-layout', {
      method: 'POST',
      body: { markdown: editor.value },
      abortKey: 'format-ai', // 切页时随 cancelAllApi 中断
    });
    const optimized = data?.markdown;
    if (typeof optimized !== 'string' || !optimized.trim()) throw new Error('AI 返回了空内容');
    replaceEditorText(optimized);
    LS.set('wf:markdown', optimized);
    updateWordCount();
    doRender();
    toast('AI 排版完成，已替换编辑器内容（可 Ctrl+Z 撤销）', 'success');
  } catch (e) {
    if (isAbortError(e)) toast('已取消 AI 排版，编辑器内容未改动', 'info');
    else toast('AI 排版失败：' + (e.message || e), 'error');
  } finally {
    busy.stop();
    setBtnLoading(false);
  }
}

// ============= 右栏：模板与微调 =============
function renderCategoryTabs() {
  const host = document.getElementById('formatCategoryTabs');
  if (!host) return;
  const e = ensureEngine();
  if (!e) return;
  host.innerHTML = e.groupedTemplates.map(g =>
    `<button class="tab-btn ${g.id === activeCategory ? 'active' : ''} px-2.5 py-1 text-xs rounded-md" data-action="formatSelectCategory" data-cat="${esc(g.id)}">${esc(g.name)}</button>`
  ).join('');
}

// 模板缩略卡：用模板自带的 h1/h2/p 样式串画 mini 预览（CSS 伪预览，不跑引擎）
function renderTemplateGrid() {
  const host = document.getElementById('formatTemplateGrid');
  if (!host) return;
  const e = ensureEngine();
  if (!e) return;
  const group = e.groupedTemplates.find(g => g.id === activeCategory) || e.groupedTemplates[0];
  activeCategory = group.id;
  host.innerHTML = group.templates.map(tpl => `
    <div class="cursor-pointer rounded-lg border p-1.5 transition ${tpl.id === currentTemplateId ? 'border-pink-500 bg-pink-500/10' : 'border-white/10 hover:border-white/25'}"
         data-action="formatSelectTemplate" data-id="${esc(tpl.id)}" title="${esc(tpl.desc)}">
      <div class="rounded overflow-hidden" style="background-color: ${tpl.backgroundColor}; color: ${tpl.baseStyle.color}; font-family: ${tpl.baseStyle.fontFamily};">
        <div style="${tpl.h1Style} font-size: 10px; margin: 6px 4px; padding: 3px 6px; border-width: 1px; box-shadow: none;">标题</div>
        <div style="${tpl.h2Style} font-size: 9px; margin: 4px; padding: 2px 6px; border-width: 1px; box-shadow: none;">小节</div>
        <div style="${tpl.pStyle} font-size: 8px; margin: 4px 6px 8px;">正文预览段落</div>
      </div>
      <div class="flex items-center justify-between mt-1.5 px-0.5">
        <span class="text-[11px] font-medium text-gray-300">${esc(tpl.name)}</span>
        <span class="inline-block w-3 h-3 rounded-full border border-white/20 flex-shrink-0" style="background-color: ${tpl.themeColor};"></span>
      </div>
    </div>`).join('');
}

const TWEAK_NUMBER_FIELDS = [
  { key: 'fontSize', label: '字号 px', min: 10, max: 24, step: 1 },
  { key: 'lineHeight', label: '行高', min: 1.4, max: 2.6, step: 0.1 },
  { key: 'paragraphSpacing', label: '段距 px', min: 0, max: 40, step: 1 },
  { key: 'letterSpacing', label: '字间距 px', min: -1, max: 5, step: 0.5 },
  { key: 'imageRadius', label: '图圆角 px', min: 0, max: 24, step: 1 },
];
const PADDING_FIELDS = [
  { key: 'pagePaddingTop', label: '上' },
  { key: 'pagePaddingRight', label: '右' },
  { key: 'pagePaddingBottom', label: '下' },
  { key: 'pagePaddingLeft', label: '左' },
];
const ALIGN_OPTIONS = ['left', 'center', 'right'];

function renderTweaksPanel() {
  const panel = document.getElementById('formatTweaksPanel');
  if (!panel) return;
  const numberField = f => `
    <label class="flex flex-col gap-1 min-w-0">
      <span class="text-[10px] text-gray-500">${f.label}</span>
      <input class="input py-1 px-2 text-xs" type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${currentTweaks[f.key]}" data-tweak="${f.key}">
    </label>`;
  const alignSelect = (key, label) => `
    <label class="flex flex-col gap-1 min-w-0">
      <span class="text-[10px] text-gray-500">${label}</span>
      <select class="input py-1 px-1 text-xs" data-tweak-select="${key}">
        ${ALIGN_OPTIONS.map(v => `<option value="${v}" ${currentTweaks[key] === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </label>`;
  const tpl = getTemplate(currentTemplateId);
  panel.innerHTML = `
    ${TWEAK_NUMBER_FIELDS.map(numberField).join('')}
    <label class="flex items-center gap-2 py-2 cursor-pointer">
      <input type="checkbox" class="accent-pink-500" data-tweak-check="firstLineIndent" ${currentTweaks.firstLineIndent ? 'checked' : ''}>
      <span class="text-[10px] text-gray-500">首行缩进 2em</span>
    </label>
    <div class="col-span-2 flex items-end gap-2">
      <span class="text-[10px] text-gray-500 pb-1.5 flex-shrink-0">留白</span>
      <div class="grid grid-cols-4 gap-1 flex-1 min-w-0">
        ${PADDING_FIELDS.map(f => `
          <label class="flex flex-col gap-0.5 min-w-0">
            <span class="text-[9px] text-gray-600 text-center">${f.label}</span>
            <input class="input py-1 px-1 text-xs text-center" type="number" min="0" max="64" step="1" value="${currentTweaks[f.key]}" data-tweak="${f.key}">
          </label>`).join('')}
      </div>
    </div>
    ${alignSelect('h1Layout', 'H1 对齐')}
    ${alignSelect('h2Layout', 'H2 对齐')}
    <div class="col-span-2 flex items-end gap-2">
      <label class="flex flex-col gap-1 flex-1 min-w-0">
        <span class="text-[10px] text-gray-500">自定义主题色（覆盖模板配色）</span>
        <input type="color" class="input py-0.5 px-1 h-8" id="formatThemeColor" value="${esc(currentTweaks.themeColor || tpl?.themeColor || '#3b82f6')}">
      </label>
      <button class="btn btn-ghost py-1.5 px-2 text-xs flex-shrink-0" data-action="formatResetThemeColor">跟随模板</button>
    </div>`;
}

function onTweaksPanelChange(e) {
  const number = e.target.closest('[data-tweak]');
  if (number) { applyTweak(number.dataset.tweak, parseFloat(number.value)); return; }
  const checkbox = e.target.closest('[data-tweak-check]');
  if (checkbox) { applyTweak(checkbox.dataset.tweakCheck, checkbox.checked); return; }
  const select = e.target.closest('[data-tweak-select]');
  if (select) { applyTweak(select.dataset.tweakSelect, select.value); return; }
  if (e.target.id === 'formatThemeColor') applyTweak('themeColor', e.target.value);
}

function applyTweak(key, value) {
  if (!(key in DEFAULT_TWEAKS)) return;
  currentTweaks[key] = value;
  LS.set('wf:tweaks', currentTweaks);
  doRender();
}

export function formatSelectCategory(cat) {
  activeCategory = cat;
  LS.set('wf:category', cat);
  renderCategoryTabs();
  renderTemplateGrid();
}

export function formatSelectTemplate(id) {
  currentTemplateId = id;
  LS.set('wf:templateId', id);
  renderTemplateGrid();
  doRender();
}

export function formatResetThemeColor() {
  currentTweaks.themeColor = '';
  LS.set('wf:tweaks', currentTweaks);
  const tpl = getTemplate(currentTemplateId);
  const input = document.getElementById('formatThemeColor');
  if (input && tpl) input.value = tpl.themeColor;
  doRender();
}

// ============= 中栏：预览渲染管线 =============
// 排版内核已内置防爆栈护栏（js/core/markdown-guard.js），这里再用 renderArticleSafe 兜一层：
// 解析异常（典型是 marked 的 "Maximum call stack size exceeded Please report this to …"）
// 一律降级为纯文本预览，绝不把异常抛给页面。
function doRender() {
  const preview = document.getElementById('formatPreview');
  const editor = document.getElementById('formatEditor');
  if (!preview || !editor || !engine) return;
  if (!editor.value.trim()) {
    preview.innerHTML = '<div class="h-full flex items-center justify-center text-center p-6 text-xs text-gray-400">在左侧编写 Markdown，或点右上角「载入示例」</div>';
    return;
  }
  const tpl = getTemplate(currentTemplateId);
  if (!tpl) return;
  const markdown = resolvePlaceholderImages(editor.value);
  try {
    const result = engine.renderArticleSafe(markdown, tpl, currentTweaks);
    preview.innerHTML =
      (result.degraded ? renderDegradeNotice(result.reason) : '') + sanitizePreview(result.html);
  } catch (err) {
    // 连降级渲染都炸（例如消毒库异常）：把原文当纯文本贴出来，绝不再抛
    preview.innerHTML = renderDegradeNotice(err?.message) + plainTextPreview(markdown);
  }
  postProcessPreview(preview);
}

// 降级提示条：用内联样式，避免新增 Tailwind class 又要重跑 npm run build
function renderDegradeNotice(reason) {
  const detail = reason ? `：${esc(reason)}` : '';
  return `<div class="p-3 text-xs" style="color: #b45309; background-color: rgba(245, 158, 11, 0.12);">排版内核已降级为纯文本渲染${detail}。内容不会丢失，可继续复制原文。</div>`;
}

function plainTextPreview(markdown) {
  return `<pre class="whitespace-pre-wrap p-4 text-xs">${esc(markdownToPlainText(markdown))}</pre>`;
}

// 预览区消毒：自家引擎产物，保留 style/bgcolor 等内联样式，但禁脚本类标签与事件属性。
// 与 utils.js renderMarkdown 的 FORBID_ATTR:['style'] 相反——这里必须保留内联样式才看得见排版。
// data: URI 仅用于用户自己粘贴的截图（dataURL 图片）。
function sanitizePreview(html) {
  if (!window.DOMPurify) return html; // 降级：内核产物代码块已实体转义，无脚本注入路径
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['style', 'bgcolor', 'align', 'cellpadding', 'cellspacing', 'border', 'valign', 'background'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}

// 预览图体验：外链图防热链（qpic/qlogo/redfox 域走服务端代理）+ 懒加载 + 不带 referer
function postProcessPreview(container) {
  container.querySelectorAll('img').forEach(img => {
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    const src = img.getAttribute('src') || '';
    const proxied = proxyImage(src);
    if (proxied && proxied !== src) img.src = proxied;
  });
  container.querySelectorAll('a[href]').forEach(link => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}

// ============= 复制排版 =============
// 返回 { html, degraded, reason }；内核不可用时返回 null
function buildArticleHtml(markdown) {
  const tpl = getTemplate(currentTemplateId);
  if (!engine || !tpl) return null;
  return engine.renderArticleSafe(resolvePlaceholderImages(markdown), tpl, currentTweaks);
}

// 复制产物不过 DOMPurify：唯一去向是公众号编辑器粘贴板（按钮 tooltip 已提示）。
// text/html 与 text/plain 都放同一份 HTML，微信编辑器取 text/html。
export async function formatCopyHtml() {
  const editor = document.getElementById('formatEditor');
  if (!editor || !editor.value.trim()) { toast('请先输入或载入 Markdown', 'error'); return; }
  const result = buildArticleHtml(editor.value);
  if (!result) { toast('排版内核不可用', 'error'); return; }
  const html = result.html;
  try {
    if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      })]);
    } else {
      legacyRichCopy(html);
    }
    toast(
      result.degraded
        ? '内容过于复杂，已降级为纯文本复制（排版样式不可用）'
        : '排版 HTML 已复制，去公众号后台正文区粘贴即可',
      result.degraded ? 'error' : 'success',
    );
  } catch (err) {
    toast('复制失败：' + (err.message || err), 'error');
  }
}

// 不支持 ClipboardItem 的浏览器：隐藏节点选中 + execCommand('copy')（上游 use-clipboard-copy 同思路）
function legacyRichCopy(html) {
  const container = document.createElement('div');
  container.setAttribute('contenteditable', 'true');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  container.innerHTML = html;
  document.body.appendChild(container);
  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const ok = document.execCommand('copy');
  selection.removeAllRanges();
  container.remove();
  if (!ok) throw new Error('execCommand copy 被浏览器拒绝');
}

// ============= 示例 / 清空 =============
export function formatLoadSample() {
  const editor = document.getElementById('formatEditor');
  if (!editor) return;
  editor.value = SAMPLE_TEXT;
  LS.set('wf:markdown', SAMPLE_TEXT);
  updateWordCount();
  doRender();
  toast('示例已载入，试试切换右侧模板', 'success');
}

export function formatClearDoc() {
  const editor = document.getElementById('formatEditor');
  if (!editor || !editor.value) return;
  if (!window.confirm('确定清空当前 Markdown？')) return;
  editor.value = '';
  LS.set('wf:markdown', '');
  imageMap.clear();
  updateWordCount();
  doRender();
}
