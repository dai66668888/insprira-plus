// ============= 公众号排版内核 · 引擎入口 =============
// 移植自上游项目 https://github.com/mspringjade/wechat-formatter（TypeZen · WeChat Formatter）
// 原作者：mspringjade · 原文件 app/template-engine.ts + app/_types/formatter.ts · 原协议 AGPL-3.0
// 移植日期：2026-10-03 · 修改说明：
//   - TS 类型改写为 JSDoc 约定（FormatTweaks / H1LayoutType / TemplateConfig）；
//   - marked 不直接引用全局，改为 makeEngine({ Marked, Renderer }) 工厂注入——
//     浏览器端注入 vendor/marked.min.js 的 UMD 全局（v15.0.12），
//     node:test 端注入 npm 的 marked@15，同一份内核代码两侧共享。
// 用法（浏览器）：
//   const engine = makeEngine({ Marked: marked.Marked, Renderer: marked.Renderer });
//   engine.renderArticle(markdown, engine.allTemplates[0], engine.DEFAULT_TWEAKS);
import { allTemplates, groupedTemplates } from './templates.js';
import { createArticleRenderer } from './render.js';

/**
 * @typedef {'left'|'center'|'right'} H1LayoutType
 */

/**
 * 排版微调参数（对齐上游 FormatTweaks）
 * @typedef {Object} FormatTweaks
 * @property {number} fontSize 正文字号 px
 * @property {number} lineHeight 行高
 * @property {number} paragraphSpacing 段落间距 px
 * @property {boolean} firstLineIndent 首行缩进 2em
 * @property {number} pagePaddingTop 页面留白-上 px
 * @property {number} pagePaddingRight 页面留白-右 px
 * @property {number} pagePaddingBottom 页面留白-下 px
 * @property {number} pagePaddingLeft 页面留白-左 px
 * @property {number} letterSpacing 字间距 px
 * @property {number} imageRadius 图片圆角 px
 * @property {string} [themeColor] 自定义主题色（#hex），设置后按分类整体重生成样式
 * @property {H1LayoutType} h1Layout H1 对齐
 * @property {H1LayoutType} h2Layout H2 对齐
 */

/** @type {FormatTweaks} */
export const DEFAULT_TWEAKS = {
  fontSize: 15,
  lineHeight: 1.8,
  paragraphSpacing: 16,
  firstLineIndent: false,
  pagePaddingTop: 24,
  pagePaddingRight: 24,
  pagePaddingBottom: 24,
  pagePaddingLeft: 24,
  letterSpacing: 0,
  imageRadius: 8,
  themeColor: '',
  h1Layout: 'center',
  h2Layout: 'left',
};

/**
 * 创建排版引擎实例。
 * @param {{Marked: Function, Renderer: Function}} deps marked 的 Marked 与 Renderer 类
 * @returns {{
 *   allTemplates: import('./templates.js').TemplateConfig[],
 *   groupedTemplates: {id: string, name: string, templates: import('./templates.js').TemplateConfig[]}[],
 *   renderArticle: (markdown: string, template: import('./templates.js').TemplateConfig, tweaks: FormatTweaks) => string,
 *   renderArticleSafe: (markdown: string, template: import('./templates.js').TemplateConfig, tweaks: FormatTweaks) => {html: string, degraded: boolean, reason: string},
 *   DEFAULT_TWEAKS: FormatTweaks,
 * }}
 */
export function makeEngine(deps) {
  const { renderArticle, renderArticleSafe } = createArticleRenderer(deps);
  return {
    allTemplates,
    groupedTemplates,
    renderArticle,
    renderArticleSafe,
    DEFAULT_TWEAKS,
  };
}
