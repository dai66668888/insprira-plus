// 前端 SSE 工具（纯函数，node 可直接 import 单测）
// ① parseSseFrames：把 fetch 流式读取到的文本切成 { event, data } 帧；
// ② extractPartialJsonField：从「还没闭合的 JSON 文本」里抽出某个字符串字段的当前值。
//
// 为什么需要 ②：改写链路走 JSON 模式（lib/rewrite.js 要求 {"title","intro","content"}），
// 流式透传拿到的是一段段 JSON 文本（{"title":"…","intro":"…","content":"正文…）。
// 直接把 JSON 片段贴进输出框全是引号与 \n 转义，所以边流边把 content 解出来，
// 用户才能真的看见「正文在长」。解不出来（字段还没轮到/结构不符）就返回空串，前端退化成进度文案。

// 把缓冲切成完整帧，返回剩余未闭合部分（调用方把 rest 回喂下一次）
export function parseSseFrames(buffer) {
  // 换行归一：CRLF → LF。必须对「整段缓冲」归一（rest 会回喂），
  // 这样 \r 与 \n 恰好分处两个 chunk 时也能拼对。
  let rest = String(buffer || '').replace(/\r\n/g, '\n');
  const frames = [];
  let idx;
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const frame = parseSseBlock(block);
    if (frame) frames.push(frame);
  }
  return { frames, rest };
}

// 单个事件块 → { event, data }；纯注释块（心跳）返回 null
function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  let sawField = false;
  for (const rawLine of String(block || '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue; // 空行与注释（: keep-alive）都跳过
    const colon = line.indexOf(':');
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : '';
    if (value.startsWith(' ')) value = value.slice(1);
    sawField = true;
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (!sawField) return null;
  if (!dataLines.length) return { event, data: null };
  const raw = dataLines.join('\n');
  let data = raw;
  try { data = JSON.parse(raw); } catch { /* 非 JSON 的 data 原样透传 */ }
  return { event, data };
}

// 从部分 JSON 文本里尽力抽取某个字符串字段的当前值。
// 规则：
//  1. 只有「"field" 后面（可有空白）跟冒号，再跟引号」才算命中，正文里恰好出现的同名字面量会被跳过；
//  2. 支持 \n \r \t \b \f \" \\ \/ 与 \uXXXX 转义；遇到只到一半的转义（帧被截断）就地停下，
//     等下一帧补齐 —— 这样已经解出的部分永远是完整字符，不会出现半个汉字；
//  3. 遇到未转义的 " 视为字段结束；文本结束仍未闭合则返回已有部分。
export function extractPartialJsonField(text, field) {
  const src = String(text || '');
  const needle = `"${field}"`;
  let from = 0;
  for (;;) {
    const key = src.indexOf(needle, from);
    if (key < 0) return '';
    let i = key + needle.length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== ':') { from = key + needle.length; continue; }
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '"') { from = key + needle.length; continue; }
    i++;
    let out = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"') return out; // 字段闭合
      if (ch === '\\') {
        const esc = src[i + 1];
        if (esc === undefined) return out; // 转义被截断，等下一帧
        if (esc === 'u') {
          const hex = src.slice(i + 2, i + 6);
          if (hex.length < 4) return out; // \u 只到一半
          out += String.fromCharCode(parseInt(hex, 16) || 0);
          i += 6;
          continue;
        }
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
        out += map[esc] ?? esc;
        i += 2;
        continue;
      }
      out += ch;
      i++;
    }
    return out; // 文本结束仍在字段内：返回已有部分（下一帧继续长）
  }
}