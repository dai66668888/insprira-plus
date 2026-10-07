// ============= Markdown 解析护栏（防 marked 栈溢出 / 解析期崩溃） =============
// 现象：页面报「渲染失败：Maximum call stack size exceeded Please report this to
//   https://github.com/markedjs/marked.」
// 那句「Please report this to …」来自 marked 的 Marked.onError —— 它给【任何】解析期异常
// 追加这句尾巴。所以真正抛出来的是原生 RangeError（V8 调用栈耗尽），不是 marked 的 bug 提示。
//
// 已实测复现（Node 20/24 + marked 15.0.12，与 vendor/marked.min.js 同版本）的两类形态：
//   ① 行内定界符风暴：同一段落里出现几千个连续/成对的定界符（`**` 成对风暴、AI 生成的
//      `********` 装饰线、图片标签被截断后 URL/alt 里的 `_ ~ = *` 漏回正文）
//      → Parser.parseInline 逐层递归 → 爆栈；
//   ② 块级嵌套：单行几千个 `>`（引用嵌套）→ Lexer.blockTokens 递归 → 爆栈。
// 浏览器调用栈比 Node 小，同样的输入更容易触发，所以这里按「宁可多挡一点」处理。
//
// 本模块是纯函数、不碰 window/DOM，浏览器与 node:test 共用。接入顺序固定为：
//   const { markdown, restore } = extractDataUrls(source);   // ① dataURL 不进解析器
//   const safe = normalizeMarkdown(markdown);                // ② 修畸形图片 + 折定界符 + 封嵌套
//   ... marked.parse(safe) ...
//   restore(html)                                            // ③ 渲染后把 dataURL 回填
// 解析仍失败时用 markdownToPlainText + escapeHtml 降级输出纯文本。

/** 连续同类定界符上限：超过就转义成字面量（`**` 成对风暴 > 8 对即触发） */
export const MAX_DELIMITER_RUN = 8;
/** 引用嵌套上限（单行 `>` 层级） */
export const MAX_BLOCK_DEPTH = 8;
/** 列表缩进上限（空格数），≈8 级嵌套 */
export const MAX_LIST_INDENT = 32;
/** 图片 alt 上限（超出截断）：alt 会再走一遍行内 tokenizer，超长 alt 是放大源 */
export const MAX_IMAGE_ALT = 200;
/** 纯文本降级时的展示上限，避免把几百 KB 的原文塞进 DOM */
export const PLAIN_TEXT_LIMIT = 50000;
/** 渲染器递归深度上限（内核 render.js 用同一常量） */
export const MAX_INLINE_DEPTH = 24;

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_RUN_RE = /([*_~^=`])\1{8,}/g;
const DELIMITER_CHAR_RE = /[*_~^=`]/g;
const QUOTE_MARK_RE = /^[ \t]{0,3}>[ \t]?/;
const LIST_LINE_RE = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])([ \t]+)/;
const IMAGE_ALT_RE = /!\[([^\]]*)\]\(/g;
const DATA_URL_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const SPAN_TOKEN_RE = /\u0000(\d+)\u0000/g;

/** HTML 实体转义（内核与 utils.js 的降级输出共用，避免依赖 DOM） */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/**
 * 逐行变换，但跳过围栏代码块（``` / ~~~）——代码块内容必须原样保留，
 * 否则会把别人代码里的 `********` 改成字面量。
 * @param {string} markdown
 * @param {(line: string) => string} transformLine
 * @returns {string}
 */
export function transformOutsideFences(markdown, transformLine) {
  const lines = String(markdown ?? '').split('\n');
  const out = [];
  let fence = null;
  for (const line of lines) {
    const opened = FENCE_OPEN_RE.exec(line);
    if (fence) {
      out.push(line);
      // 闭合围栏：行首（允许缩进）出现至少同样长度的同类围栏
      if (opened && line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    if (opened) {
      fence = opened[1];
      out.push(line);
      continue;
    }
    out.push(transformLine(line));
  }
  return out.join('\n');
}

/**
 * 把行内的「代码 span」与「链接/图片目标 ](url)」临时抽出来，只对普通文本做变换，
 * 最后原样还原——保证不会改到代码、也不会把 URL 里的定界符当正文。
 * @param {string} line
 * @returns {{text: string, restore: (value: string) => string}}
 */
function protectLineSpans(line) {
  const store = [];
  const keep = (match) => `\u0000${store.push(match) - 1}\u0000`;
  const text = line
    .replace(/(`+)([\s\S]*?)\1/g, keep)
    .replace(/\]\((?:[^()]|\([^()]*\))*\)/g, keep);
  return {
    text,
    restore: (value) => String(value).replace(SPAN_TOKEN_RE, (m, index) => store[Number(index)] ?? m),
  };
}

/**
 * 修复畸形图片标签并加固 alt：
 *   1. alt 里的定界符转义（alt 会再走一遍行内 tokenizer，是嵌套放大源）、超长 alt 截断；
 *   2. `![alt](url` 未闭合时补一个 `)`，避免整段 URL/alt 漏回正文被当行内语法解析。
 * 语法正常的图片（含 dataURL 已抽成短占位符的）产物不变。
 * @param {string} line
 * @returns {string}
 */
export function repairImageLine(line) {
  const source = String(line ?? '');
  let out = source.replace(IMAGE_ALT_RE, (match, alt) => {
    const capped = alt.length > MAX_IMAGE_ALT ? `${alt.slice(0, MAX_IMAGE_ALT)}…` : alt;
    return `![${capped.replace(DELIMITER_CHAR_RE, (char) => `\\${char}`)}](`;
  });
  const open = out.lastIndexOf('](');
  if (open < 0 || out.indexOf(')', open) >= 0) return out;
  return `${out})`;
}

/**
 * 把超长定界符串转义成字面量：`****…(9 个以上)` 这类输入会让 marked 构造出几千层
 * 嵌套的 strong/em token，最终在 parseInline 上爆栈。转义后视觉上仍是那串字符，
 * 但不再参与配对。跳过围栏代码、行内代码与 URL 目标串。
 * @param {string} markdown
 * @returns {string}
 */
export function collapseDelimiterRuns(markdown) {
  return transformOutsideFences(markdown, (line) => {
    const { text, restore } = protectLineSpans(line);
    return restore(text.replace(DELIMITER_RUN_RE, (run) => run.replace(DELIMITER_CHAR_RE, (char) => `\\${char}`)));
  });
}

/**
 * 封顶块级嵌套：单行 `>` 超过 MAX_BLOCK_DEPTH 的部分转义为字面量 `\>`（引用递归在 Lexer 侧，
 * 渲染器护栏拦不到，必须在进 marked 前处理）；列表缩进超过 MAX_LIST_INDENT 的空格裁掉。
 * @param {string} markdown
 * @returns {string}
 */
export function capBlockNesting(markdown) {
  return transformOutsideFences(markdown, (line) => capListIndent(capQuoteDepth(line)));
}

function capQuoteDepth(line) {
  let rest = line;
  let depth = 0;
  let matched;
  while (depth < MAX_BLOCK_DEPTH && (matched = QUOTE_MARK_RE.exec(rest))) {
    rest = rest.slice(matched[0].length);
    depth += 1;
  }
  if (depth === 0) return line;
  const head = line.slice(0, line.length - rest.length);
  const escaped = rest.replace(/^((?:[ \t]{0,3}>[ \t]?)+)/, (run) => run.replace(/>/g, '\\>'));
  return head + escaped;
}

function capListIndent(line) {
  const matched = LIST_LINE_RE.exec(line);
  if (!matched) return line;
  const indent = matched[1].replace(/\t/g, '    ');
  if (indent.length <= MAX_LIST_INDENT) return line;
  return ' '.repeat(MAX_LIST_INDENT) + line.slice(matched[1].length);
}

/**
 * 把 dataURL 图片抽成短占位符——一张手机截图 base64 就有几百 KB~几 MB，
 * 直接塞给 marked 会变成「超长无断点行内 token」，放大 lexer/正则开销，
 * 还会和自定义 `==高亮==` 扩展的 `start()` 候选位置互相干扰。
 * 渲染完成后用 restore() 回填，产物与原来完全一致。
 * @param {string} markdown
 * @param {string} [prefix] 占位符前缀（同一文档内唯一即可）
 * @returns {{markdown: string, count: number, restore: (html: string) => string}}
 */
export function extractDataUrls(markdown, prefix = 'wfdataimg') {
  const found = [];
  const output = String(markdown ?? '').replace(DATA_URL_RE, (url) => {
    const token = `${prefix}${found.length}x`;
    found.push({ token, url });
    return token;
  });
  return {
    markdown: output,
    count: found.length,
    restore: (html) => {
      let result = String(html ?? '');
      for (const { token, url } of found) result = result.split(token).join(url);
      return result;
    },
  };
}

/**
 * 「进 marked 之前」的统一清洗入口。
 * 注意：dataURL 抽取由调用方负责（extractDataUrls），因为回填发生在渲染之后。
 * @param {string} markdown
 * @returns {string}
 */
export function normalizeMarkdown(markdown) {
  const source = String(markdown ?? '');
  if (!source) return '';
  let text = transformOutsideFences(source, repairImageLine);
  text = collapseDelimiterRuns(text);
  text = capBlockNesting(text);
  return text;
}

/**
 * 修「右括号被吞掉」的图片占位符：`![描述](#img-1` → `![描述](#img-1)`。
 * format.js 的占位符替换（#img-N → 真实图片）依赖右括号，AI 排版把括号吃掉时
 * 整张图片会直接丢失；先补括号再替换即可保住图片。
 * @param {string} markdown
 * @returns {string}
 */
export function repairPlaceholderImageSyntax(markdown) {
  // 用「可选的右括号」参与匹配，避免负向断言在最长匹配上失败后回溯到更短的 id
  return String(markdown ?? '').replace(/(!\[[^\]]*\]\(#[A-Za-z0-9_-]+)(\)?)/g, (match, head, close) => (close ? match : `${head})`));
}

/**
 * 解析失败时的降级文本：保留原文（用户能自己复制走），只丢弃体积巨大的 dataURL。
 * @param {string} markdown
 * @param {number} [maxLength]
 * @returns {string}
 */
export function markdownToPlainText(markdown, maxLength = PLAIN_TEXT_LIMIT) {
  let text = String(markdown ?? '').replace(DATA_URL_RE, '[图片：dataURL 已省略]');
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}\n\n…（内容过长，已截断显示）`;
  return text;
}

/**
 * 去掉 marked 给异常追加的尾巴，只留真实原因（供降级提示展示）。
 * @param {unknown} error
 * @returns {string}
 */
export function cleanParseError(error) {
  const message = String((error && error.message) || error || '未知错误');
  return message.replace(/\s*Please report this to https:\/\/github\.com\/markedjs\/marked\.?/i, '').trim();
}