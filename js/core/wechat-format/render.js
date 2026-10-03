// ============= 公众号排版内核 · renderArticle 渲染器 =============
// 移植自上游项目 https://github.com/mspringjade/wechat-formatter（TypeZen · WeChat Formatter）
// 原作者：mspringjade · 原文件 app/template-engine.ts 的 renderArticle 部分 · 原协议 AGPL-3.0
// 移植日期：2026-10-03 · 修改说明：TS → 原生浏览器 ES Module；Marked/Renderer 改为工厂注入，
//   使同一份代码可在 node:test 中用 npm 版 marked 跑通（与 vendor/marked.min.js 同版本 v15）。
//
// 「粘贴进公众号后台零损失」的关键技巧（务必原样保留，见方案 §2.2）：
// 1. 全部样式写入 style=""，最终产物是 <section> 嵌套结构，无 class、无 <style>；
// 2. bgFallback：把文章底色下放到每个块级元素，防微信粘贴时剥掉外层背景；
//    同时避免整体 <table> 包裹——那会干扰微信广告系统分段；
// 3. 标题用三层 <section> 嵌套（外层 margin/text-align，中层模板样式，内层重置字号字重）；
// 4. 列表用 float 布局（图标列 + 内容列 margin-left + 清浮动），任务列表复选框用内联 section 画；
// 5. 同段纯 <img> 自动等分 inline-block 多排布局；
// 6. 代码块：HTML 实体转义 + Mac 三色圆点 SVG 头部；
// 7. 表格：cellpadding/cellspacing 归零 + <td bgcolor> 属性兜底；
// 8. 扩展语法：==高亮==、^上标^、~下标~；
// 9. breaks: true, gfm: true。
import { hexToRgba, getStyleValue, ensureStyleValue, getStylesByCategory } from './templates.js';

/**
 * 创建 renderArticle(markdownText, baseTemplate, formatTweaks)。
 * @param {{Marked: Function, Renderer: Function}} markedDeps marked 的 Marked 与 Renderer 类（注入以解耦全局）
 */
export function createArticleRenderer({ Marked, Renderer }) {
  /**
   * @param {string} markdownText
   * @param {import('./templates.js').TemplateConfig} baseTemplate
   * @param {import('./engine.js').FormatTweaks} formatTweaks
   * @returns {string} 内联样式 HTML（<section> 嵌套结构）
   */
  return function renderArticle(markdownText, baseTemplate, formatTweaks) {
    // 用户自定义主题色时按分类整体重生成样式
    const template = formatTweaks.themeColor
      ? {
          ...baseTemplate,
          ...getStylesByCategory(baseTemplate.category, formatTweaks.themeColor),
        }
      : baseTemplate;

    const markedInstance = new Marked();
    const customRenderer = new Renderer();
    const defaultRenderer = new Renderer();

    const tuneBlockStyle = (
      style,
      options = {},
    ) => {
      let nextStyle = style;

      if (options.lineHeight) {
        nextStyle = ensureStyleValue(nextStyle, 'line-height', String(formatTweaks.lineHeight));
      }

      if (options.paragraphSpacing) {
        nextStyle = ensureStyleValue(nextStyle, 'margin', `0 0 ${formatTweaks.paragraphSpacing}px 0`);
      }

      if (options.firstLineIndent) {
        nextStyle = ensureStyleValue(
          nextStyle,
          'text-indent',
          formatTweaks.firstLineIndent ? '2em' : '0',
        );
      }

      if (options.letterSpacing) {
        nextStyle = ensureStyleValue(nextStyle, 'letter-spacing', `${formatTweaks.letterSpacing}px`);
      }

      return nextStyle;
    };

    const paragraphStyle = tuneBlockStyle(template.pStyle, {
      lineHeight: true,
      paragraphSpacing: true,
      firstLineIndent: true,
      letterSpacing: true,
    });

    const blockquoteStyle = tuneBlockStyle(template.blockquoteStyle, {
      lineHeight: true,
      letterSpacing: true,
    });

    const imageStyle = ensureStyleValue(
      template.imgStyle,
      'border-radius',
      `${formatTweaks.imageRadius}px`,
    );

    // 给样式串补上背景色（已有则不动）。把文章底色分散到每个块级元素，
    // 即使微信粘贴时剥掉外层 section 的背景，每个内容块仍保持正确底色；
    // 同时因此无需整体 <table> 包裹——那会干扰微信广告系统的分段。
    const bgFallback = (style) => {
      if (/background-color\s*:/i.test(style)) return style;
      const trimmed = style.trimEnd();
      return `${trimmed}${trimmed.endsWith(';') ? ' ' : '; '}background-color: ${template.backgroundColor};`;
    };

    customRenderer.heading = function (token) {
      const depth = token.depth;
      const textHtml = this.parser.parseInline(token.tokens);

      let baseStyle = '';
      if (depth === 1) baseStyle = template.h1Style;
      else if (depth === 2) baseStyle = template.h2Style;
      else baseStyle = template.h3Style;

      const s = bgFallback(baseStyle);

      // 抽出 margin 与对齐，其余样式留给中层 section
      const marginMatch = s.match(/margin\s*:\s*([^;]+)/i);
      const margin = marginMatch ? marginMatch[1] : depth === 1 ? '32px 0' : '24px 0';
      let cleanStyle = s.replace(/margin\s*:\s*[^;]+;?/gi, 'margin: 0;');

      const textAlignMatch = cleanStyle.match(/text-align\s*:\s*([^;]+)/i);
      let textAlign = textAlignMatch ? textAlignMatch[1] : depth === 1 ? 'center' : 'left';

      // 微调：h1 对齐
      if (depth === 1 && formatTweaks.h1Layout) {
        if (formatTweaks.h1Layout === 'left') {
          textAlign = 'left';
          cleanStyle = cleanStyle.replace(/text-align\s*:\s*[^;]+;?/gi, 'text-align: left;');
        } else if (formatTweaks.h1Layout === 'right') {
          textAlign = 'right';
          cleanStyle = cleanStyle.replace(/text-align\s*:\s*[^;]+;?/gi, 'text-align: right;');
        } else {
          textAlign = 'center';
          cleanStyle = cleanStyle.replace(/text-align\s*:\s*[^;]+;?/gi, 'text-align: center;');
        }
      }

      // 微调：h2 对齐
      if (depth === 2 && formatTweaks.h2Layout) {
        if (formatTweaks.h2Layout === 'left') {
          textAlign = 'left';
          cleanStyle = cleanStyle.replace(/text-align\s*:\s*[^;]+;?/gi, 'text-align: left;');
        } else if (formatTweaks.h2Layout === 'right') {
          textAlign = 'right';
          cleanStyle = cleanStyle.replace(/text-align\s*:\s*[^;]+;?/gi, 'text-align: right;');
        } else {
          textAlign = 'center';
          cleanStyle = cleanStyle.replace(/text-align\s*:\s*[^;]+;?/gi, 'text-align: center;');
        }
      }

      const isInline = cleanStyle.includes('display: inline-block');

      // 三层 <section> 嵌套，规避微信渲染错位
      if (isInline) {
        return `<section style="margin: ${margin}; text-align: ${textAlign};">
          <section style="${cleanStyle} display: inline-block; text-align: left;">
            <section style="margin: 0; padding: 0; font-size: 1em; font-weight: inherit; line-height: 1.4; background: none; border: none; color: inherit;">
              ${textHtml}
            </section>
          </section>
        </section>`;
      }

      return `<section style="margin: ${margin}; text-align: ${textAlign};">
        <section style="${cleanStyle}">
          <section style="margin: 0; padding: 0; font-size: 1em; font-weight: inherit; line-height: 1.4; background: none; border: none; color: inherit;">
            ${textHtml}
          </section>
        </section>
      </section>`;
    };

    customRenderer.paragraph = function (token) {
      const html = defaultRenderer.paragraph.call(this, token);

      // 同段纯多图 → 等分 inline-block 多排布局（高度兼容，避开 table 与 flex）
      const pContent = html
        .trim()
        .replace(/^<p[^>]*>/i, '')
        .replace(/<\/p>$/i, '');
      const textWithoutImg = pContent
        .replace(/<img[^>]*>/gi, '')
        .replace(/<br\s*\/?>/gi, '')
        .trim();

      if (textWithoutImg === '') {
        const imagesMatch = pContent.match(/<img[^>]*>/gi);
        if (imagesMatch && imagesMatch.length > 1) {
          const gapWidth = 4;
          const imgCount = imagesMatch.length;
          const widthPercent = 100 / imgCount - 1.5;

          const flexItems = imagesMatch
            .map((imgHtml) => {
              const styledImg = imgHtml.replace(
                /style="[^"]*"/i,
                `style="width: 100%; height: auto; object-fit: cover; border-radius: ${formatTweaks.imageRadius}px; display: block; vertical-align: middle;"`,
              );
              return `<section style="display: inline-block; width: ${widthPercent}%; padding: 0 ${gapWidth}px; box-sizing: border-box; vertical-align: top;">${styledImg}</section>`;
            })
            .join('');

          return `<section style="text-align: center; margin: 0 0 16px 0; line-height: 0;">${flexItems}</section>`;
        }
      }

      return html.replace(/^<p[^>]*>/i, `<p style="${bgFallback(paragraphStyle)}">`);
    };

    customRenderer.blockquote = function (token) {
      let html = defaultRenderer.blockquote.call(this, token);
      html = html.replace(
        /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i,
        (m, inner) => {
          inner = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '<br>');
          inner = inner.replace(/(<br>)+$/i, '');
          return (
            `<blockquote style="${blockquoteStyle}">` +
            template.blockquoteInnerBefore +
            inner +
            template.blockquoteInnerAfter +
            `</blockquote>`
          );
        },
      );
      return html;
    };

    // 列表最外层（float 布局 + 清浮动）
    customRenderer.list = function (token) {
      const ordered = token.ordered;
      const start = token.start || 1;

      const itemsHtml = token.items
        .map((item, index) => {
          // 用块级解析器渲染列表项内容
          let inner = this.parser.parse(item.tokens);
          // 清掉首个段落的 margin（紧凑列表没有段落则不命中）
          inner = inner.replace(/^<p style="([^"]*)"/i, (m, s) => {
            const cleanS = s.replace(/margin\s*:\s*[^;]+;?/gi, 'margin: 0;');
            return `<p style="${cleanS}"`;
          });
          // 移除 checkbox 渲染出的 span，避免任务列表出现双复选框
          inner = inner.replace(
            /<span style="[^"]*width: 12px; height: 12px;[^"]*">.*?<\/span>/gi,
            '',
          );

          let icon = '';
          if (item.task) {
            icon = item.checked
              ? `<section style="display: inline-block; width: 14px; height: 14px; line-height: 14px; text-align: center; border: 2px solid #000000; background-color: #10b981; color: #000000; font-size: 10px; font-weight: bold; margin-top: 4px; box-sizing: border-box;">√</section>`
              : `<section style="display: inline-block; width: 14px; height: 14px; border: 2px solid #000000; background-color: #ffffff; margin-top: 4px; box-sizing: border-box; overflow: hidden;"><br/></section>`;
          } else if (ordered) {
            const num = start + index;
            if (template.category === 'neo-brutalism') {
              icon = `<section style="display: inline-block; width: 20px; height: 20px; line-height: 20px; text-align: center; background-color: ${template.themeColor}; color: #000000; border: 2px solid #000000; font-size: 12px; font-weight: 900; box-shadow: 2px 2px 0px #000000; box-sizing: border-box; overflow: hidden;">${num}</section>`;
            } else {
              icon = `<section style="display: inline-block; color: ${template.themeColor}; font-weight: bold; font-family: sans-serif;">${num}.</section>`;
            }
          } else {
            icon = template.listIcon;
          }

          const iconWidth = template.category === 'neo-brutalism' ? 32 : 24;

          // float 布局：图标列 + 内容列 + 清浮动，公众号兼容性最好
          return `<section style="display: block; clear: both; margin-bottom: 12px;">
          <section style="float: left; width: ${iconWidth}px; box-sizing: border-box;">
            <section style="text-align: left;">${icon}</section>
          </section>
          <section style="margin-left: ${iconWidth}px; box-sizing: border-box; overflow: hidden;">
            <section style="display: block; overflow: hidden;">
              ${inner}
            </section>
          </section>
          <section style="display: block; clear: both; height: 0; line-height: 0; font-size: 0; overflow: hidden;"></section>
        </section>`;
        })
        .join('');

      return `<section style="${bgFallback(template.listStyle)} padding: 0; margin: 20px 0 16px 0;">${itemsHtml}</section>`;
    };

    customRenderer.strong = function (token) {
      const html = defaultRenderer.strong.call(this, token);
      return html.replace(/^<strong[^>]*>/i, `<strong style="${template.strongStyle}">`);
    };

    customRenderer.em = function (token) {
      const html = defaultRenderer.em.call(this, token);
      return html.replace(/^<em[^>]*>/i, `<em style="${template.emStyle}">`);
    };

    customRenderer.codespan = function (token) {
      const html = defaultRenderer.codespan.call(this, token);
      const inlineCodeStyle = `background-color: #f1f5f9; color: ${template.themeColor}; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em; margin: 0 2px;`;
      return html.replace(/^<code[^>]*>/i, `<code style="${inlineCodeStyle}">`);
    };

    customRenderer.code = function (token) {
      const rawCode = token.text;
      // 实体转义，防止正文里的 HTML 被微信编辑器二次解析
      const escapedCode = rawCode
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const macHeader = `<svg width="42" height="12" viewBox="0 0 42 12" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="6" fill="#ff5f56"/><circle cx="21" cy="6" r="6" fill="#ffbd2e"/><circle cx="36" cy="6" r="6" fill="#27c93f"/></svg>`;
      const headerBg =
        template.codeHeaderStyle.match(/background-color:\s*([^;]+)/i)?.[1] || '#e2e8f0';
      const headerPadding = template.codeHeaderStyle.match(/padding:\s*([^;]+)/i)?.[1] || '8px 12px';
      const headerBorder = template.codeHeaderStyle.match(/border-bottom:\s*([^;]+)/i)?.[1] || '';
      const headerBorderStyle = headerBorder ? `border-bottom: ${headerBorder};` : '';
      return `<section style="${template.codeContainerStyle}"><section style="background-color: ${headerBg}; padding: ${headerPadding}; ${headerBorderStyle}">${macHeader}</section><section style="padding: 0; margin: 0;"><pre style="${template.codeBlockStyle}"><code>${escapedCode}</code></pre></section></section>`;
    };

    customRenderer.image = function (token) {
      const html = defaultRenderer.image.call(this, token);
      return html.replace(/^<img([^>]*)>/i, `<img$1 style="${imageStyle}" />`);
    };

    customRenderer.hr = function () {
      return `<hr style="${template.hrStyle}" />`;
    };

    customRenderer.link = function (token) {
      const html = defaultRenderer.link.call(this, token);
      return html.replace(/^<a([^>]*)>/i, `<a$1 style="${template.linkStyle}">`);
    };

    customRenderer.table = function (token) {
      const html = defaultRenderer.table.call(this, token);
      const tableStyle = ensureStyleValue(
        template.tableStyle,
        'background-color',
        template.backgroundColor,
      );
      return html.replace(
        /^<table[^>]*>/i,
        `<table cellpadding="0" cellspacing="0" border="0" style="${tableStyle}">`,
      );
    };

    customRenderer.tablerow = function (token) {
      return defaultRenderer.tablerow.call(this, token);
    };

    customRenderer.tablecell = function (token) {
      const html = defaultRenderer.tablecell.call(this, token);
      const isHeader = token.header;
      let style = isHeader ? template.thStyle : template.tdStyle;
      // <td>/<th> 的 bgcolor 属性兜底：即使 CSS 被剥，单元格底色仍在
      const fallbackCellBackground = isHeader
        ? getStyleValue(template.thStyle, 'background-color') || template.backgroundColor
        : getStyleValue(template.tdStyle, 'background-color') || template.backgroundColor;

      style = ensureStyleValue(style, 'background-color', fallbackCellBackground);

      if (token.align) {
        style = style.trim().endsWith(';')
          ? `${style} text-align: ${token.align};`
          : `${style}; text-align: ${token.align};`;
      }

      const tag = isHeader ? 'th' : 'td';
      const bgColor = getStyleValue(style, 'background-color') || template.backgroundColor;

      return html.replace(
        new RegExp(`^<${tag}[^>]*>`, 'i'),
        `<${tag} bgcolor="${bgColor}" style="${style}">`,
      );
    };

    customRenderer.del = function (token) {
      const html = defaultRenderer.del.call(this, token);
      return html.replace(/^<del[^>]*>/i, `<del style="${template.delStyle}">`);
    };

    customRenderer.checkbox = function (token) {
      return token.checked
        ? '<span style="display: inline-block; width: 12px; height: 12px; line-height: 12px; text-align: center; border: 1px solid #10b981; color: #10b981; font-size: 10px; font-weight: bold; margin-right: 4px;">x</span>'
        : '<span style="display: inline-block; width: 12px; height: 12px; border: 1px solid #9ca3af; margin-right: 4px;"></span>';
    };

    // 扩展行内语法：==高亮== / ^上标^ / ~下标~
    markedInstance.use({
      extensions: [
        {
          name: 'highlight',
          level: 'inline',
          start(src) {
            return src.indexOf('==');
          },
          tokenizer(src) {
            const match = /^==([^=]+)==/.exec(src);
            if (match) {
              const token = {
                type: 'highlight',
                raw: match[0],
                text: match[1],
                tokens: [],
              };
              this.lexer.inlineTokens(token.text, token.tokens);
              return token;
            }
          },
          renderer(token) {
            return `<mark style="background-color: ${hexToRgba(template.themeColor, 0.5)}; color: inherit; padding: 0 2px;">${this.parser.parseInline(token.tokens)}</mark>`;
          },
        },
        {
          name: 'superscript',
          level: 'inline',
          start(src) {
            return src.indexOf('^');
          },
          tokenizer(src) {
            const match = /^\^([^^]+)\^/.exec(src);
            if (match) {
              const token = {
                type: 'superscript',
                raw: match[0],
                text: match[1],
                tokens: [],
              };
              this.lexer.inlineTokens(token.text, token.tokens);
              return token;
            }
          },
          renderer(token) {
            return `<sup>${this.parser.parseInline(token.tokens)}</sup>`;
          },
        },
        {
          name: 'subscript',
          level: 'inline',
          start(src) {
            return src.indexOf('~');
          },
          tokenizer(src) {
            // 避免与删除线（~~）冲突：要求首尾字符非空白且中间无 ~
            const match = /^~([^~\s][^~]*[^~\s])~/.exec(src);
            if (match) {
              const token = {
                type: 'subscript',
                raw: match[0],
                text: match[1],
                tokens: [],
              };
              this.lexer.inlineTokens(token.text, token.tokens);
              return token;
            }
          },
          renderer(token) {
            return `<sub>${this.parser.parseInline(token.tokens)}</sub>`;
          },
        },
      ],
    });

    const innerHtml = markedInstance.parse(markdownText, {
      renderer: customRenderer,
      breaks: true,
      gfm: true,
    });

    // 文章容器：tweaks 落到容器（字号/行高/字间距/四向留白）+ 底色兜底
    const articleContainerStyle = ensureStyleValue(
      ensureStyleValue(
        `${template.containerStyle} font-size: ${formatTweaks.fontSize}px; line-height: ${formatTweaks.lineHeight}; letter-spacing: ${formatTweaks.letterSpacing}px; color: ${template.baseStyle.color}; font-family: ${template.baseStyle.fontFamily}; word-wrap: break-word; word-break: break-all; box-sizing: border-box;`,
        'padding',
        `${formatTweaks.pagePaddingTop}px ${formatTweaks.pagePaddingRight}px ${formatTweaks.pagePaddingBottom}px ${formatTweaks.pagePaddingLeft}px`,
      ),
      'background-color',
      template.backgroundColor,
    );

    return `<section style="width: 100%; max-width: 100%; box-sizing: border-box; background-color: ${template.backgroundColor};"><section style="${articleContainerStyle}">${innerHtml}</section></section>`;
  };
}
