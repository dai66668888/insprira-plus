// ============= 公众号排版内核 · 模板数据（72 套 = 6 分类 × 12 色板） =============
// 移植自上游项目 https://github.com/mspringjade/wechat-formatter（TypeZen · WeChat Formatter）
// 原作者：mspringjade · 原文件 app/template-engine.ts · 原协议 AGPL-3.0
// 移植日期：2026-10-03 · 修改说明：TypeScript → 原生浏览器 ES Module；生成逻辑与色板原样保留。
// 模板字段约定（TemplateConfig）：id/name/desc/category/themeColor/backgroundColor/baseStyle
//   + 各元素内联样式串（containerStyle/h1Style/.../delStyle）+ defaultH2Layout。
// 注意：全部样式最终写入 style="" 内联属性 —— 微信编辑器只认内联样式，这是「粘贴零损失」的前提。

/**
 * @typedef {Object} TemplateConfig
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {string} category
 * @property {string} themeColor
 * @property {string} backgroundColor
 * @property {{color: string, fontFamily: string}} baseStyle
 * @property {string} containerStyle
 * @property {string} h1Style
 * @property {string} h2Style
 * @property {string} h3Style
 * @property {string} pStyle
 * @property {string} blockquoteStyle
 * @property {string} blockquoteInnerBefore
 * @property {string} blockquoteInnerAfter
 * @property {string} listStyle
 * @property {string} listItemStyle
 * @property {string} listIcon
 * @property {string} strongStyle
 * @property {string} emStyle
 * @property {string} codeContainerStyle
 * @property {string} codeHeaderStyle
 * @property {string} codeBlockStyle
 * @property {string} imgStyle
 * @property {string} hrStyle
 * @property {string} linkStyle
 * @property {string} tableStyle
 * @property {string} thStyle
 * @property {string} tdStyle
 * @property {string} delStyle
 * @property {string} defaultH2Layout
 */

const colorPalettes = {
  neoBrutalism: [
    '#ff6f9f',
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ef4444',
    '#06b6d4',
    '#f43f5e',
    '#14b8a6',
    '#f97316',
    '#d946ef',
    '#84cc16',
  ],
  minimalist: [
    '#3b82f6',
    '#10b981',
    '#6366f1',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#14b8a6',
    '#f43f5e',
    '#64748b',
    '#000000',
    '#2dd4bf',
    '#fb923c',
  ],
  business: [
    '#1e40af',
    '#0f766e',
    '#4338ca',
    '#b45309',
    '#be123c',
    '#6d28d9',
    '#0e7490',
    '#9f1239',
    '#334155',
    '#111827',
    '#1d4ed8',
    '#047857',
  ],
  literary: [
    '#059669',
    '#d97706',
    '#be185d',
    '#7c3aed',
    '#0284c7',
    '#ea580c',
    '#4d7c0f',
    '#c026d3',
    '#0891b2',
    '#86198f',
    '#db2777',
    '#7c2d12',
  ],
  tech: [
    '#2563eb',
    '#0ea5e9',
    '#06b6d4',
    '#10b981',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#f43f5e',
    '#6366f1',
    '#14b8a6',
    '#f97316',
    '#84cc16',
  ],
  festive: [
    '#ef4444',
    '#dc2626',
    '#b91c1c',
    '#f59e0b',
    '#d97706',
    '#ea580c',
    '#c2410c',
    '#be123c',
    '#9f1239',
    '#fbbf24',
    '#e11d48',
    '#ca8a04',
  ],
};

const names = [
  '经典',
  '雅致',
  '先锋',
  '深邃',
  '晨光',
  '星穹',
  '暖阳',
  '暮色',
  '清泉',
  '破晓',
  '璀璨',
  '幽蓝',
];

const categoriesList = [
  { id: 'neo-brutalism', name: '新粗野风' },
  { id: 'minimalist', name: '极简风' },
  { id: 'business', name: '商务风' },
  { id: 'literary', name: '文艺风' },
  { id: 'tech', name: '科技风' },
  { id: 'festive', name: '节庆风' },
];

function hexToRgb(hex) {
  const normalized = hex.replace('#', '').trim();
  const fullHex = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => char + char)
        .join('')
    : normalized;

  const value = Number.parseInt(fullHex, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha.toFixed(3))));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function getStyleValue(style, property) {
  const escapedProperty = property.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = style.match(new RegExp(`${escapedProperty}\\s*:\\s*([^;]+)`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function ensureStyleValue(style, property, value) {
  const escapedProperty = property.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`${escapedProperty}\\s*:\\s*[^;]+;?`, 'i');

  if (regex.test(style)) {
    return style.replace(regex, `${property}: ${value};`);
  }

  const normalizedStyle = style.trim();
  if (!normalizedStyle) {
    return `${property}: ${value};`;
  }

  return normalizedStyle.endsWith(';')
    ? `${normalizedStyle} ${property}: ${value};`
    : `${normalizedStyle}; ${property}: ${value};`;
}

function getStylesByCategory(category, color) {
  switch (category) {
    case 'neo-brutalism':
      return {
        themeColor: color,
        backgroundColor: '#ffffff',
        baseStyle: {
          color: '#000000',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
        containerStyle: 'padding: 24px; background-color: #ffffff;',
        h1Style: `font-size: 1.6em; font-weight: 900; text-align: center; margin: 20px 0; color: #000000; background-color: ${color}; border: 3px solid #000000; padding: 15px 12px; box-shadow: 8px 8px 0px #000000; line-height: 1.3; text-transform: uppercase; letter-spacing: 1px; display: block;`,
        h2Style: `font-size: 1.4em; font-weight: 800; margin: 24px 0 16px; color: #000000; background-color: ${color}; border: 3px solid #000000; padding: 8px 16px; box-shadow: 5px 5px 0px #000000; display: inline-block; line-height: 1.2;`,
        h3Style: `font-size: 1.15em; font-weight: 700; margin: 24px 0 12px; color: #000000; background-color: #ffffff; border: 2px solid #000000; padding: 4px 12px; box-shadow: 3px 3px 0px #000000; display: inline-block;`,
        pStyle: 'margin: 0 0 16px 0; line-height: 1.8; font-weight: 500;',
        blockquoteStyle: `border: 3px solid #000000; margin: 24px 0; padding: 20px; color: #000000; background-color: ${hexToRgba(color, 0.1)}; box-shadow: 6px 6px 0px #000000;`,
        blockquoteInnerBefore: `<span style="display: block; font-size: 2em; line-height: 1; margin-bottom: 10px; color: #000000; font-family: Georgia, serif;">“</span>`,
        blockquoteInnerAfter: `<span style="display: block; font-size: 2em; line-height: 1; text-align: right; margin-top: 10px; color: #000000; font-family: Georgia, serif;">”</span>`,
        listStyle: 'margin: 0 0 16px 0; padding: 0; list-style-type: none;',
        listItemStyle: 'margin: 0 0 10px 0; line-height: 1.6; font-weight: 500;',
        listIcon: `<section style="display: inline-block; width: 12px; height: 12px; background-color: ${color}; border: 2px solid #000000; vertical-align: middle; box-shadow: 2px 2px 0px #000000; box-sizing: border-box; overflow: hidden;"><br/></section>`,
        strongStyle: `font-weight: 800; background-color: ${color}; color: #000000; padding: 0 4px; border: 2px solid #000000;`,
        emStyle: 'font-style: italic; text-decoration: underline; text-decoration-thickness: 2px;',
        codeContainerStyle: `margin: 24px 0; border: 3px solid #000000; box-shadow: 6px 6px 0px #000000; background-color: #ffffff; overflow: hidden;`,
        codeHeaderStyle: `background-color: ${color}; padding: 8px 12px; border-bottom: 3px solid #000000;`,
        codeBlockStyle: `margin: 0; padding: 16px; overflow-x: auto; color: #000000; font-size: 13px; font-family: monospace; line-height: 1.6; white-space: pre-wrap; word-break: break-all;`,
        imgStyle:
          'max-width: 100%; border: 3px solid #000000; box-shadow: 6px 6px 0px #000000; display: block; margin: 24px auto;',
        hrStyle: `border: none; border-top: 4px solid #000000; margin: 40px 0;`,
        linkStyle: `color: #000000; font-weight: 700; text-decoration: none; border-bottom: 3px solid ${color};`,
        tableStyle:
          'width: 100%; max-width: 100%; border-collapse: collapse; margin: 24px 0; border: 3px solid #000000; table-layout: fixed; word-wrap: break-word;',
        thStyle: `border: 2px solid #000000; padding: 12px; background-color: ${color}; color: #000000; font-weight: 800; text-align: left;`,
        tdStyle: 'border: 2px solid #000000; padding: 12px; color: #000000; font-weight: 500;',
        delStyle: 'text-decoration: line-through; opacity: 0.6;',
        defaultH2Layout: 'left',
      };
    case 'minimalist':
      return {
        themeColor: color,
        backgroundColor: '#ffffff',
        baseStyle: {
          color: '#374151',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
        containerStyle: 'padding: 16px; background-color: #ffffff;',
        h1Style: `font-size: 1.4em; font-weight: bold; text-align: center; margin: 24px 0 16px; color: ${color}; border-bottom: 1px solid ${color}; padding-bottom: 8px; line-height: 1.4;`,
        h2Style: `font-size: 1.25em; font-weight: bold; margin: 24px 0 16px; color: #111827; padding-left: 12px; border-left: 4px solid ${color}; line-height: 1.4;`,
        h3Style: `font-size: 1.1em; font-weight: bold; margin: 16px 0 12px; color: #374151; line-height: 1.4;`,
        pStyle: 'margin: 0 0 16px 0; line-height: 1.8; text-indent: 0;',
        blockquoteStyle: `border-left: 3px solid ${color}; margin: 20px 0; padding: 12px 16px; color: #4b5563; background-color: #f3f4f6;`,
        blockquoteInnerBefore: '',
        blockquoteInnerAfter: '',
        listStyle: 'margin: 0 0 16px 0; padding: 0; list-style-type: none;',
        listItemStyle: 'margin: 0 0 8px 0; line-height: 1.6;',
        listIcon: `<section style="display: inline-block; color: ${color}; font-weight: bold;">•</section>`,
        strongStyle: `font-weight: bold; color: ${color};`,
        emStyle: 'font-style: italic; color: #4b5563;',
        codeContainerStyle: `margin: 20px 0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e5e7eb; overflow: hidden; background-color: #f8fafc;`,
        codeHeaderStyle: `background-color: #e2e8f0; padding: 8px 12px; font-size: 0; line-height: 1;`,
        codeBlockStyle: `margin: 0; padding: 16px; overflow-x: auto; color: #334155; font-size: 13px; font-family: monospace; line-height: 1.6; white-space: pre-wrap; word-break: break-all;`,
        imgStyle: 'max-width: 100%; border-radius: 8px; display: block; margin: 20px auto;',
        hrStyle: `border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;`,
        linkStyle: `color: ${color}; text-decoration: none; border-bottom: 1px dashed ${color};`,
        tableStyle:
          'width: 100%; max-width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 0.95em; table-layout: fixed; word-wrap: break-word;',
        thStyle: `border-bottom: 2px solid ${color}; padding: 12px 8px; text-align: left; color: #111827; font-weight: bold; margin: 0;`,
        tdStyle:
          'border-bottom: 1px solid #f3f4f6; padding: 12px 8px; color: #4b5563; margin: 0; word-wrap: break-word; word-break: break-all;',
        delStyle: 'text-decoration: line-through; color: #9ca3af;',
        defaultH2Layout: 'left',
      };
    case 'business':
      return {
        themeColor: color,
        backgroundColor: '#ffffff',
        baseStyle: {
          color: '#334155',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
        containerStyle: 'padding: 20px; background-color: #ffffff;',
        h1Style: `font-size: 1.5em; font-weight: 800; text-align: left; margin: 24px 0 24px 0; color: ${color}; border-bottom: 3px solid ${color}; line-height: 1.4; padding-bottom: 8px;`,
        h2Style: `font-size: 1.2em; font-weight: 700; background-color: ${color}; color: #ffffff; display: inline-block; padding: 6px 16px; margin: 24px 0 16px 0; border-radius: 2px; line-height: 1.4;`,
        h3Style: `font-size: 1.1em; font-weight: bold; margin: 16px 0 12px 0; color: ${color}; border-bottom: 1px dashed ${hexToRgba(color, 0.502)}; padding-bottom: 4px; line-height: 1.4;`,
        pStyle: 'margin: 0 0 16px 0; line-height: 1.8; text-indent: 2em;',
        blockquoteStyle: `border-left: 6px solid ${color}; margin: 24px 0; padding: 16px; color: #475569; background-color: #f8fafc; font-weight: 500;`,
        blockquoteInnerBefore: '',
        blockquoteInnerAfter: '',
        listStyle: 'margin: 0 0 16px 0; padding: 0; list-style-type: none;',
        listItemStyle: 'margin: 0 0 10px 0; line-height: 1.7;',
        listIcon: `<section style="display: inline-block; color: ${color}; font-size: 12px;">■</section>`,
        strongStyle: `font-weight: bold; color: ${color}; background-color: ${hexToRgba(color, 0.082)}; padding: 0 2px;`,
        emStyle: 'font-style: italic; color: #64748b;',
        codeContainerStyle: `margin: 20px 0; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border: 1px solid #475569; overflow: hidden; background-color: #1e293b;`,
        codeHeaderStyle: `background-color: #334155; padding: 8px 12px; font-size: 0; line-height: 1; border-bottom: 1px solid #0f172a;`,
        codeBlockStyle: `margin: 0; padding: 16px; overflow-x: auto; color: #f8fafc; font-size: 13px; font-family: monospace; line-height: 1.6; white-space: pre-wrap; word-break: break-all;`,
        imgStyle:
          'max-width: 100%; border: 1px solid #e2e8f0; padding: 4px; display: block; margin: 20px auto;',
        hrStyle: `border: none; border-top: 2px dashed ${hexToRgba(color, 0.502)}; margin: 32px 0;`,
        linkStyle: `color: ${color}; font-weight: 500; text-decoration: none; border-bottom: 1px solid ${color};`,
        tableStyle:
          'width: 100%; max-width: 100%; border-collapse: collapse; margin: 24px 0; border: 1px solid #cbd5e1; font-size: 0.9em; table-layout: fixed; word-wrap: break-word;',
        thStyle: `border: 1px solid #cbd5e1; padding: 10px; background-color: #f8fafc; color: ${color}; font-weight: bold; margin: 0;`,
        tdStyle: `border: 1px solid #cbd5e1; padding: 10px; color: #334155; margin: 0; word-wrap: break-word; word-break: break-all;`,
        delStyle: 'text-decoration: line-through; color: #cbd5e1;',
        defaultH2Layout: 'left',
      };
    case 'literary':
      return {
        themeColor: color,
        backgroundColor: '#fdfcfb',
        baseStyle: {
          color: '#4b5563',
          fontFamily: '"Noto Serif SC", serif, system-ui',
        },
        containerStyle: `padding: 24px 16px; background-color: #fdfcfb;`,
        h1Style: `font-size: 1.35em; font-weight: normal; text-align: center; margin: 30px 0; color: ${color}; letter-spacing: 4px; line-height: 1.4;`,
        h2Style: `font-size: 1.15em; font-weight: normal; text-align: center; margin: 30px 0 20px; color: ${color}; padding: 8px 0; line-height: 1.4; border-top: 1px solid ${hexToRgba(color, 0.251)}; border-bottom: 1px solid ${hexToRgba(color, 0.251)}; letter-spacing: 2px; display: block;`,
        h3Style: `font-size: 1.05em; font-weight: bold; text-align: center; margin: 20px 0 16px 0; color: #374151; line-height: 1.4;`,
        pStyle: 'margin: 0 0 20px 0; line-height: 2.0; letter-spacing: 1px;',
        blockquoteStyle: `margin: 32px 0; padding: 20px; color: ${color}; text-align: center; font-style: italic; font-size: 0.95em; border-radius: 8px; background-color: ${hexToRgba(color, 0.031)};`,
        blockquoteInnerBefore: ``,
        blockquoteInnerAfter: ``,
        listStyle: 'margin: 0 0 20px 0; padding: 0; list-style-type: none;',
        listItemStyle: `margin: 0 0 12px 0; line-height: 1.8;`,
        listIcon: `<section style="display: inline-block; width: 8px; height: 8px; border: 1px solid ${color}; border-radius: 50%; vertical-align: middle; box-sizing: border-box; overflow: hidden;"><br/></section>`,
        strongStyle: `font-weight: normal; color: #1f2937; border-bottom: 2px solid ${hexToRgba(color, 0.502)};`,
        emStyle: `font-style: italic; color: ${color};`,
        codeContainerStyle: `margin: 24px 0; border-radius: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.03); border: 1px solid ${hexToRgba(color, 0.188)}; overflow: hidden; background-color: #fdfaf6;`,
        codeHeaderStyle: `background-color: ${hexToRgba(color, 0.063)}; padding: 8px 12px; font-size: 0; line-height: 1; border-bottom: 1px solid ${hexToRgba(color, 0.125)};`,
        codeBlockStyle: `margin: 0; padding: 16px; overflow-x: auto; color: #374151; font-size: 13px; font-family: monospace; white-space: pre-wrap; word-break: break-all; line-height: 1.6;`,
        imgStyle:
          'max-width: 100%; border-radius: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.05); display: block; margin: 30px auto;',
        hrStyle: `border: none; border-top: 1px solid ${hexToRgba(color, 0.251)}; margin: 32px auto; width: 60%;`,
        linkStyle: `color: ${color}; text-decoration: none; border-bottom: 1px solid ${color}; padding-bottom: 1px;`,
        tableStyle:
          'width: 100%; max-width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 0.95em; table-layout: fixed; word-wrap: break-word;',
        thStyle: `border-bottom: 1px solid ${color}; padding: 12px; color: ${color}; font-weight: normal; letter-spacing: 1px; text-align: left; margin: 0;`,
        tdStyle: `border-bottom: 1px dashed ${hexToRgba(color, 0.251)}; padding: 12px; color: #4b5563; margin: 0; word-wrap: break-word; word-break: break-all; background-color: #fdfcfb;`,
        delStyle: 'text-decoration: line-through; opacity: 0.5;',
        defaultH2Layout: 'center',
      };
    case 'tech':
      return {
        themeColor: color,
        backgroundColor: '#0f172a',
        baseStyle: {
          color: '#e5e7eb',
          fontFamily: '"Space Grotesk", sans-serif',
        },
        containerStyle: `padding: 20px; background-color: #0f172a;`,
        h1Style: `font-size: 1.6em; font-weight: bold; text-align: left; margin: 20px 0 32px 0; color: ${color === '#10b981' ? '#3b82f6' : '#10b981'}; text-transform: uppercase; letter-spacing: 2px; line-height: 1.4; border-bottom: 2px solid ${hexToRgba(color, 0.314)}; padding-bottom: 12px;`,
        h2Style: `font-size: 1.25em; font-weight: bold; margin: 30px 0 20px 0; color: #ffffff; border-left: 6px solid ${color}; padding-left: 14px; background-color: #1e293b; display: block; line-height: 1.4; padding-top: 6px; padding-bottom: 6px;`,
        h3Style: `font-size: 1.1em; font-weight: bold; margin: 20px 0 16px 0; color: ${color}; line-height: 1.4;`,
        pStyle: 'margin: 0 0 16px 0; line-height: 1.8; color: #cbd5e1;',
        blockquoteStyle: `border: 1px solid ${color}; margin: 24px 0; padding: 16px; color: #94a3b8; background-color: #1e293b; border-radius: 4px;`,
        blockquoteInnerBefore: `<span style="color: ${color === '#10b981' ? '#3b82f6' : '#10b981'}; margin-right: 8px;">></span>`,
        blockquoteInnerAfter: ``,
        listStyle: 'margin: 0 0 16px 0; padding: 0; list-style-type: none;',
        listItemStyle: `margin: 0 0 10px 0; line-height: 1.7;`,
        listIcon: `<section style="display: inline-block; color: ${color === '#10b981' ? '#3b82f6' : '#10b981'}; font-weight: bold; font-family: monospace;">/&gt;</section>`,
        strongStyle: `font-weight: bold; color: #ffffff; border-bottom: 1px solid ${color};`,
        emStyle: `color: ${color}; font-style: normal; text-decoration: underline; text-decoration-color: ${color};`,
        codeContainerStyle: `margin: 24px 0; border-radius: 6px; border: 1px solid #334155; overflow: hidden; background-color: #000000;`,
        codeHeaderStyle: `background-color: #1e293b; padding: 8px 12px; font-size: 0; line-height: 1; border-bottom: 1px solid #334155;`,
        codeBlockStyle: `margin: 0; padding: 16px; overflow-x: auto; color: ${color === '#10b981' ? '#3b82f6' : '#10b981'}; font-size: 13px; font-family: monospace; white-space: pre-wrap; word-break: break-all; line-height: 1.5;`,
        imgStyle: `max-width: 100%; border: 2px solid #334155; border-radius: 8px; display: block; margin: 24px auto;`,
        hrStyle: `border: none; border-top: 1px solid #334155; margin: 32px 0;`,
        linkStyle: `color: ${color === '#10b981' ? '#3b82f6' : '#10b981'}; text-decoration: underline; text-decoration-style: dashed;`,
        tableStyle: `width: 100%; max-width: 100%; border-collapse: collapse; margin: 24px 0; border: 1px solid #334155; font-size: 0.9em; table-layout: fixed; word-wrap: break-word;`,
        thStyle: `border: 1px solid #334155; padding: 10px; background-color: #1e293b; color: #ffffff; text-align: left; margin: 0;`,
        tdStyle: `border: 1px solid #334155; padding: 10px; color: #cbd5e1; margin: 0; word-wrap: break-word; word-break: break-all;`,
        delStyle: `text-decoration: line-through; color: #475569;`,
        defaultH2Layout: 'left',
      };
    default:
      // 节庆风（festive）
      return {
        themeColor: color,
        backgroundColor: '#fffbeb',
        baseStyle: { color: '#451a03', fontFamily: 'system-ui, sans-serif' },
        containerStyle: `padding: 24px; background-color: #fffbeb; border: 4px solid ${color};`,
        h1Style: `font-size: 1.5em; font-weight: bold; text-align: center; margin: 10px 0 30px 0; color: #ffffff; background-color: ${color}; padding: 12px; border-radius: 8px; letter-spacing: 2px; line-height: 1.4;`,
        h2Style: `font-size: 1.2em; font-weight: bold; text-align: center; background-color: #fef3c7; color: ${color}; border: 2px solid ${color}; margin: 24px auto 20px auto; padding: 8px 24px; border-radius: 20px; display: inline-block; line-height: 1.4;`,
        h3Style: `font-size: 1.1em; font-weight: bold; margin: 16px 0 16px 0; color: ${color}; text-align: center; line-height: 1.4;`,
        pStyle: 'margin: 0 0 16px 0; line-height: 1.8; text-indent: 2em; color: #78350f;',
        blockquoteStyle: `border: 2px dashed ${color}; border-radius: 8px; margin: 24px 0; padding: 16px; color: #92400e; background-color: #fef3c7; text-align: center; font-weight: 500;`,
        blockquoteInnerBefore: ``,
        blockquoteInnerAfter: ``,
        listStyle: 'margin: 0 0 16px 0; padding: 0; color: #78350f; list-style-type: none;',
        listItemStyle: 'margin: 0 0 10px 0; line-height: 1.7;',
        listIcon: `<section style="display: inline-block; width: 8px; height: 8px; background-color: #ea580c; transform: rotate(45deg); vertical-align: middle; box-sizing: border-box; overflow: hidden;"><br/></section>`,
        strongStyle: `font-weight: bold; color: ${color};`,
        emStyle: `font-style: italic; color: #b45309;`,
        codeContainerStyle: `margin: 24px 0; border-radius: 8px; border: 2px dashed ${color}; overflow: hidden; background-color: #fef3c7;`,
        codeHeaderStyle: `background-color: #fcd34d; padding: 8px 12px; font-size: 0; line-height: 1; border-bottom: 2px solid ${hexToRgba(color, 0.125)};`,
        codeBlockStyle: `margin: 0; padding: 16px; overflow-x: auto; color: #9f1239; font-size: 13px; font-family: monospace; white-space: pre-wrap; word-break: break-all; line-height: 1.5;`,
        imgStyle: `max-width: 100%; border: 4px solid #fef3c7; border-radius: 12px; display: block; margin: 20px auto;`,
        hrStyle: `border: none; border-top: 2px dashed ${color}; margin: 32px 0;`,
        linkStyle: `color: #9f1239; font-weight: bold; text-decoration: none; border-bottom: 2px solid #fcd34d;`,
        tableStyle: `width: 100%; max-width: 100%; border-collapse: collapse; margin: 24px 0; border: 2px solid ${color}; font-size: 0.9em; table-layout: fixed; word-wrap: break-word;`,
        thStyle: `border: 1px solid ${color}; padding: 10px; background-color: #fef3c7; color: ${color}; font-weight: bold; text-align: center; margin: 0;`,
        tdStyle: `border: 1px solid ${color}; padding: 10px; color: #92400e; margin: 0; word-wrap: break-word; word-break: break-all;`,
        delStyle: `text-decoration: line-through; color: #b45309;`,
        defaultH2Layout: 'center',
      };
  }
}

function generateTemplates() {
  const result = [];

  // 1. 极简风 (Minimalist) - 圆点、清爽边框
  colorPalettes.minimalist.forEach((color, i) => {
    result.push({
      id: `minimalist-${i}`,
      name: names[i],
      desc: '标准的点与线排版，适合日常阅读',
      category: 'minimalist',
      ...getStylesByCategory('minimalist', color),
    });
  });

  // 2. 商务风 (Business) - 方块、实底、专业
  colorPalettes.business.forEach((color, i) => {
    result.push({
      id: `business-${i}`,
      name: names[i],
      desc: '方块标识符，适合严谨的行业报告',
      category: 'business',
      ...getStylesByCategory('business', color),
    });
  });

  // 3. 文艺风 (Literary) - 花朵、括号、留白
  colorPalettes.literary.forEach((color, i) => {
    result.push({
      id: `literary-${i}`,
      name: names[i],
      desc: '配有小花图标，给文字呼吸喘息的空间',
      category: 'literary',
      ...getStylesByCategory('literary', color),
    });
  });

  // 4. 科技风 (Tech) - 尖角、极客终端
  colorPalettes.tech.forEach((color, i) => {
    result.push({
      id: `tech-${i}`,
      name: names[i],
      desc: '打破常规的终端 /> 标识设计',
      category: 'tech',
      ...getStylesByCategory('tech', color),
    });
  });

  // 5. 节庆风 (Festive) - 星星、双线元素
  colorPalettes.festive.forEach((color, i) => {
    result.push({
      id: `festive-${i}`,
      name: names[i],
      desc: '星星标识与浓烈色彩传递节日喜悦',
      category: 'festive',
      ...getStylesByCategory('festive', color),
    });
  });

  // 6. 新粗野主义 (Neo-Brutalism) - 粗黑边框、硬投影、高对比
  colorPalettes.neoBrutalism.forEach((color, i) => {
    result.push({
      id: `neo-brutalism-${i}`,
      name: names[i],
      desc: '高饱和度色彩、纯黑边框与硬投影，大胆不羁',
      category: 'neo-brutalism',
      ...getStylesByCategory('neo-brutalism', color),
    });
  });

  return result;
}

export const allTemplates = generateTemplates();
export const groupedTemplates = categoriesList.map((cat) => ({
  ...cat,
  templates: allTemplates.filter((t) => t.category === cat.id),
}));

export { hexToRgb, hexToRgba, getStyleValue, ensureStyleValue, getStylesByCategory };
