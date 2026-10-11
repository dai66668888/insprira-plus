// 公众号草稿箱同步（P1-3 / 方案 PR-3）：把「排版页的成果」一键送进公众号草稿箱。
//
// 链路：正文 HTML → 收集图片 → 逐张转存（cgi-bin/media/uploadimg 返回 mmbiz.qpic.cn 链接）
//       → 改写正文 → 校验「正文图片 100% 已托管」（验收 H2）→ 封面转永久素材（thumb_media_id）
//       → cgi-bin/draft/add。
//
// 设计要点：
// 1. 「可离线验证的部分」全部是纯函数（图片收集/改写/校验、dataURL 解析、multipart 组装、
//    草稿载荷组装、配置脱敏、草稿校验），HTTP 调用集中在 make() 里 ——
//    因此单测不需要网络、更不需要真实公众号凭据。
// 2. H3（不泄露 MP_APP_SECRET）：对外配置只回报「配没配」，任何字段都不携带 secret 片段。
// 3. 封面是草稿的必填项（微信要求 thumb_media_id），所以正文无图又没指定封面时宁可
//    明确报错，也不去发一个必然失败的草稿。
const { mpError } = require('./mp-errors');

const WX_API_BASE = 'https://api.weixin.qq.com';
// 微信的硬限制（依据官方 draft/add 文档，2026-07 口径）：
//   title ≤32 字、author ≤16 字、digest ≤120 字（不填则默认抓正文前 54 字）、
//   content 必须少于 2 万字符、小于 1M，且「涉及图片 url 必须来源『上传图文消息内的图片获取URL』
//   接口获取，外部图片 url 将被过滤」→ 这正是本模块坚持「先转存 + 转存后复查」的依据（H2）。
// 超限接口会直接拒绝，本地提前拦下给出可读原因。
const LIMITS = { title: 32, author: 16, digest: 120, content: 20000 };
// 正文可外链的图床：只有微信自家域名（H2 的判定依据）。
// szmmbiz.qpic.cn 是微信另一个真实存在的图片 CDN 域名（转载/外部图常见），同样算已托管。
const HOSTED_HOSTS = ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'szmmbiz.qpic.cn'];
const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;

function hostOf(url) {
  const match = String(url || '').match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return match ? match[1].toLowerCase().replace(/:\d+$/, '') : '';
}

function isHostedImage(src) {
  const host = hostOf(src);
  return HOSTED_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

// 正文里的图片地址（按出现顺序去重）。只认 <img>：排版内核已把 Markdown 渲染成带内联样式的 HTML。
function collectImages(html) {
  const out = [];
  const re = /<img\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const src = String(match[2] ?? match[3] ?? '').trim();
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

// 前端忘记把 #img-N 占位符换成真实地址时，正文会留一堆无效引用 —— 必须拦下（否则草稿是破图）
function collectPlaceholderRefs(html) {
  return [...new Set(String(html || '').match(/#img-\d+/g) || [])];
}

// 逐条替换图片地址。用 split/join 而不是 replace 正则：URL 里带 ? & : / 时正则语义会变。
function replaceImages(html, mapping = []) {
  let out = String(html || '');
  for (const [from, to] of mapping) {
    if (!from || !to || from === to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

function findUnhostedImages(html) {
  return collectImages(html).filter(src => !isHostedImage(src));
}

function parseDataUrl(src) {
  const match = String(src || '').match(DATA_URL_RE);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
}

// 给上传准备 { mime, ext, filename, buffer }：dataURL 直接解出字节，http(s) 由调用方下载
function imageMetaFor(src) {
  const data = parseDataUrl(src);
  if (data) {
    const ext = (data.mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return { mime: data.mime, ext, filename: `image.${ext}`, buffer: data.buffer, isDataUrl: true };
  }
  const extMatch = String(src || '').match(/\.(png|jpe?g|gif|webp|bmp)(?:[?#]|$)/i);
  const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
  return { mime: 'image/png', ext, filename: `image.${ext}`, buffer: null, isDataUrl: false };
}

// multipart/form-data 组装（media/uploadimg 与 material/add_material 都用它）。
// boundary 可注入 → 产物是确定性的，单测可以直接对着字节断言。
function buildMultipart(fields = [], file = null, options = {}) {
  const boundary = options.boundary || `----insprira${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  const parts = [];
  for (const { name, value } of fields) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`
      + `Content-Type: ${file.mime}\r\n\r\n`, 'utf8'));
    parts.push(Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || ''));
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}`, boundary };
}

// 按「码点」截断（不能用 slice：中文与 emoji 会被切坏）
function truncateChars(value, max) {
  const str = String(value ?? '');
  const chars = Array.from(str);
  if (chars.length <= max) return str;
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// draft/add 的请求体（微信要求 articles 数组）
function buildDraftPayload({
  title, author = '', digest = '', content = '', thumbMediaId = '',
  needOpenComment = 0, onlyFansCanComment = 0,
}) {
  return {
    articles: [{
      title: String(title || ''),
      author: truncateChars(author, LIMITS.author),
      digest: truncateChars(digest, LIMITS.digest),
      content: String(content || ''),
      thumb_media_id: String(thumbMediaId || ''),
      need_open_comment: Number(needOpenComment) || 0,
      only_fans_can_comment: Number(onlyFansCanComment) || 0,
    }],
  };
}

// 发草稿前的本地校验：errors 必须拦下，warnings 只提示
function validateDraft({ title, content, digest = '', cover = '' }) {
  const errors = [];
  const warnings = [];
  const titleLength = Array.from(String(title || '').trim()).length;
  if (!titleLength) errors.push('缺少标题：公众号草稿必须有标题');
  else if (titleLength > LIMITS.title) errors.push(`标题 ${titleLength} 字，超过微信上限 ${LIMITS.title} 字`);

  const contentLength = Array.from(String(content || '')).length;
  if (!String(content || '').trim()) errors.push('正文为空');
  else if (contentLength > LIMITS.content) {
    errors.push(`正文 ${contentLength} 字符，超过微信上限 ${LIMITS.content} 字符（内联样式也计入；长文可改用「复制排版」手动粘贴）`);
  }

  if (Array.from(String(digest || '')).length > LIMITS.digest) {
    warnings.push(`摘要超过 ${LIMITS.digest} 字，将按码点截断`);
  }
  if (!cover) warnings.push('未指定封面：将自动取正文第一张图转成封面素材');
  return { errors, warnings };
}

// H3：对外配置**永远**不含 appSecret，也不含它的任何片段
function sanitizeMpConfig(cfg) {
  if (!cfg) {
    return {
      configured: false,
      appId: '',
      accountName: '',
      secretConfigured: false,
      hint: '未配置公众号：请在 .env 填 MP_APP_ID / MP_APP_SECRET'
        + '（公众平台 → 设置与开发 → 基本配置），并把本机出口 IP 加进 IP 白名单',
    };
  }
  return {
    configured: true,
    appId: String(cfg.appId || ''),
    accountName: String(cfg.accountName || ''),
    secretConfigured: Boolean(cfg.appSecret),
  };
}

function make({ getMpConfig, getAccessToken, fetchImpl = fetch, fetchBytes = null } = {}) {
  // 取图片字节：dataURL 直接解码；http(s) 走 fetch（已托管的 mmbiz 图同样走这里下载）
  async function loadImage(src) {
    const meta = imageMetaFor(src);
    if (meta.isDataUrl) return { buffer: meta.buffer, mime: meta.mime, filename: meta.filename };
    const res = await (fetchBytes || fetchImpl)(src);
    if (!res || res.ok === false) throw new Error(`下载图片失败（HTTP ${res?.status ?? '未知'}）：${src}`);
    const contentType = String(res.headers?.get?.('content-type') || '').split(';')[0].trim();
    const mime = contentType.startsWith('image/') ? contentType : meta.mime;
    const ext = (mime.split('/')[1] || meta.ext).replace('jpeg', 'jpg');
    return { buffer: Buffer.from(await res.arrayBuffer()), mime, filename: `image.${ext}` };
  }

  async function postMultipart(url, file) {
    const { body, contentType } = buildMultipart([], file);
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': contentType }, body });
    return res.json().catch(() => ({}));
  }

  // 正文图片转存：返回 mmbiz.qpic.cn 链接（只有这种链接才能外链进正文）
  async function uploadContentImage(src) {
    const { buffer, mime, filename } = await loadImage(src);
    const token = await getAccessToken();
    const data = await postMultipart(
      `${WX_API_BASE}/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`,
      { name: 'media', filename, mime, buffer },
    );
    if (!data.url) throw mpError('图片转存失败（media/uploadimg）', data);
    if (!isHostedImage(data.url)) throw new Error(`图片转存返回了非微信图床地址：${data.url}`);
    return String(data.url);
  }

  // 封面必须走永久素材（正文图片接口只给 URL，不给 thumb_media_id）
  async function uploadThumbMaterial(src) {
    const { buffer, mime, filename } = await loadImage(src);
    const token = await getAccessToken();
    const data = await postMultipart(
      `${WX_API_BASE}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`,
      { name: 'media', filename, mime, buffer },
    );
    if (!data.media_id) throw mpError('封面上传失败（material/add_material）', data);
    return String(data.media_id);
  }

  async function addDraft(payload) {
    const token = await getAccessToken();
    const res = await fetchImpl(`${WX_API_BASE}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.media_id) throw mpError('保存草稿失败（draft/add）', data);
    return String(data.media_id);
  }

  // 主链路。任一步失败都抛带 code 的错误，路由据此给可读提示（40164 会带 err.ip 与白名单引导）
  async function syncDraft({ title, html, author = '', digest = '', cover = '', thumbMediaId = '' } = {}) {
    const cfg = getMpConfig();
    if (!cfg) {
      throw Object.assign(new Error('未配置公众号（MP_APP_ID / MP_APP_SECRET）'), { code: 'MP_NOT_CONFIGURED' });
    }
    const placeholders = collectPlaceholderRefs(html);
    if (placeholders.length) {
      throw Object.assign(
        new Error(`正文里还有未替换的本地图片占位符：${placeholders.slice(0, 5).join('、')}，请等图片载入完成后重试`),
        { code: 'MP_UNRESOLVED_IMAGES' },
      );
    }
    // 先做便宜且必然失败的校验，避免白上传一轮图片。
    // 注意 content 校验针对**正文 HTML**（微信按 content 字段的字符数算，内联样式也计入）。
    const sources = collectImages(html);
    const preCheck = validateDraft({ title, content: html, digest, cover: cover || sources[0] || '' });
    if (preCheck.errors.length) {
      throw Object.assign(new Error(preCheck.errors.join('；')), { code: 'MP_INVALID_DRAFT' });
    }

    const mapping = [];
    const warnings = [];
    let skippedHosted = 0;
    for (const src of sources) {
      if (isHostedImage(src)) { skippedHosted += 1; continue; }
      mapping.push([src, await uploadContentImage(src)]);
    }
    const content = replaceImages(html, mapping);

    // 验收 H2：正文里的每一张图都必须在微信图床里，否则宁可失败也不发破图草稿
    const unhosted = findUnhostedImages(content);
    if (unhosted.length) {
      throw Object.assign(
        new Error(`正文仍有 ${unhosted.length} 张图片不在微信图床：${unhosted.slice(0, 3).join('、')}`),
        { code: 'MP_UNHOSTED_IMAGES' },
      );
    }

    let coverMediaId = String(thumbMediaId || '').trim();
    if (!coverMediaId) {
      const coverSrc = String(cover || sources[0] || '').trim();
      if (!coverSrc) {
        throw Object.assign(
          new Error('草稿必须带封面：正文里没有图片，请在排版页插入一张图或指定封面地址'),
          { code: 'MP_NO_COVER' },
        );
      }
      coverMediaId = await uploadThumbMaterial(coverSrc);
    }

    const resolvedDigest = String(digest || '').trim() || htmlToPlainText(content);
    const payload = buildDraftPayload({ title, author, digest: resolvedDigest, content, thumbMediaId: coverMediaId });
    const mediaId = await addDraft(payload);
    warnings.push(...preCheck.warnings);
    return {
      mediaId,
      imageCount: sources.length,
      uploadedCount: mapping.length,
      hostedSkippedCount: skippedHosted,
      coverMediaId,
      digest: payload.articles[0].digest,
      warnings,
    };
  }

  return { getMpConfig, getAccessToken, syncDraft, uploadContentImage, uploadThumbMaterial, addDraft, loadImage };
}

module.exports = {
  make,
  WX_API_BASE,
  LIMITS,
  HOSTED_HOSTS,
  hostOf,
  isHostedImage,
  collectImages,
  collectPlaceholderRefs,
  replaceImages,
  findUnhostedImages,
  parseDataUrl,
  imageMetaFor,
  buildMultipart,
  truncateChars,
  htmlToPlainText,
  buildDraftPayload,
  validateDraft,
  sanitizeMpConfig,
};