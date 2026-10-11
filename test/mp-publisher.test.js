// P1-3 公众号草稿箱同步：错误归类 + 发布器的可离线验证部分
// （图片收集/改写/托管校验、dataURL 解析、multipart 组装、草稿载荷、配置脱敏、主链路 fake fetch）
const test = require('node:test');
const assert = require('node:assert/strict');
const { mpError, classifyMpError, extractIpFromErrmsg } = require('../lib/mp-errors');
const pub = require('../lib/mp-publisher');

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from('PNGBYTES').toString('base64')}`;

test('mpError：带 errcode 与 errmsg，40164 时提取被拒 IP', () => {
  const err = mpError('获取 access_token 失败', {
    errcode: 40164,
    errmsg: 'invalid ip 1.2.3.4 ipv6 ::ffff:1.2.3.4, not in whitelist',
  });
  assert.equal(err.errcode, 40164);
  assert.equal(err.ip, '1.2.3.4');
  assert.match(err.message, /获取 access_token 失败/);
  assert.match(err.message, /not in whitelist/);

  // 没有 errmsg 时退化成 errcode 文案；没有匹配到时不留 ip
  const bare = mpError('失败了', { errcode: 45009 });
  assert.equal(bare.errcode, 45009);
  assert.equal(bare.ip, undefined);
  assert.match(bare.message, /errcode 45009/);
  assert.equal(extractIpFromErrmsg('invalid ip 9.9.9.9 ipv6 ::1, not in whitelist'), '9.9.9.9');
  assert.equal(extractIpFromErrmsg('something else'), '');
  assert.equal(extractIpFromErrmsg(null), '');
});

test('classifyMpError：把错误码翻成可执行建议（40164 指向白名单，未知码不给假建议）', () => {
  const ip = classifyMpError(mpError('获取 access_token 失败', {
    errcode: 40164, errmsg: 'invalid ip 8.8.8.8, not in whitelist',
  }));
  assert.equal(ip.code, 40164);
  assert.equal(ip.ip, '8.8.8.8');
  assert.match(ip.hint, /8\.8\.8\.8/);
  assert.match(ip.hint, /IP 白名单/);

  assert.match(classifyMpError(mpError('保存草稿失败', { errcode: 45009 })).hint, /限额/);
  assert.match(classifyMpError(mpError('草稿失败', { errcode: 53500 })).hint, /认证号/);

  const unknown = classifyMpError(new Error('网络断了'));
  assert.equal(unknown.code, null);
  assert.equal(unknown.hint, '');
  assert.equal(unknown.message, '网络断了');
});

test('isHostedImage：只认微信自家图床（含子域名），data:/外链/相对路径都不算', () => {
  assert.equal(pub.isHostedImage('https://mmbiz.qpic.cn/mmbiz_png/abc/0?wx_fmt=png'), true);
  assert.equal(pub.isHostedImage('http://mmbiz.qpic.cn/a.png'), true);
  assert.equal(pub.isHostedImage('https://mmbiz.qlogo.cn/mmbiz_png/a.png'), true);
  assert.equal(pub.isHostedImage('https://szmmbiz.qpic.cn/a.png'), true);
  assert.equal(pub.isHostedImage('https://mmbiz.qpic.cn.evil.com/a.png'), false);
  assert.equal(pub.isHostedImage('https://example.com/a.png'), false);
  assert.equal(pub.isHostedImage(PNG_DATA_URL), false);
  assert.equal(pub.isHostedImage('/uploads/a.png'), false);
  assert.equal(pub.isHostedImage(''), false);
  assert.equal(pub.hostOf('https://example.com:8443/a'), 'example.com');
});

test('collectImages：按出现顺序去重，单双引号与大小写标签都能认', () => {
  const html = '<p>x</p><IMG SRC="https://a.com/1.png"><img class="c" src=\'https://b.com/2.png\'>'
    + '<img src="https://a.com/1.png"><img src=""><img alt="no-src">';
  assert.deepEqual(pub.collectImages(html), ['https://a.com/1.png', 'https://b.com/2.png']);
  assert.deepEqual(pub.collectImages(''), []);
  assert.deepEqual(pub.collectImages(null), []);
});

test('collectPlaceholderRefs：抓出未替换的 #img-N 占位符并去重', () => {
  assert.deepEqual(pub.collectPlaceholderRefs('a ![图](#img-1) b ![图](#img-1) c #img-12'), ['#img-1', '#img-12']);
  assert.deepEqual(pub.collectPlaceholderRefs('<img src="https://a.com/1.png">'), []);
});

test('replaceImages/findUnhostedImages：替换全部出现处（URL 里的 ? & 不当正则），并只报未托管图', () => {
  const from = 'https://example.com/a.png?x=1&y=2';
  const to = 'https://mmbiz.qpic.cn/mmbiz_png/NEW?wx_fmt=png';
  const html = `<img src="${from}"><img src='${from}'><img src="https://other.com/b.png">`;
  const out = pub.replaceImages(html, [[from, to]]);
  assert.equal((out.match(/mmbiz\.qpic\.cn/g) || []).length, 2);
  assert.equal(out.includes(from), false, '原来的地址不应残留');
  assert.deepEqual(pub.findUnhostedImages(out), ['https://other.com/b.png']);
  assert.deepEqual(pub.findUnhostedImages(out.replace('https://other.com/b.png', to)), []);
});

test('parseDataUrl/imageMetaFor：解出 dataURL 的 mime 与字节，jpeg 归一成 .jpg', () => {
  const parsed = pub.parseDataUrl(PNG_DATA_URL);
  assert.equal(parsed.mime, 'image/png');
  assert.equal(parsed.buffer.toString(), 'PNGBYTES');
  assert.equal(pub.parseDataUrl('data:image/png;base64,@@@').buffer.length >= 0, true);
  assert.equal(pub.parseDataUrl('https://a.com/1.png'), null);
  assert.equal(pub.parseDataUrl('data:text/plain;base64,YQ=='), null);
  assert.equal(pub.parseDataUrl(''), null);

  const jpeg = pub.imageMetaFor(`data:image/jpeg;base64,${Buffer.from('J').toString('base64')}`);
  assert.equal(jpeg.filename, 'image.jpg');
  assert.equal(jpeg.isDataUrl, true);
  assert.equal(pub.imageMetaFor('https://a.com/pic.PNG?x=1').ext, 'png');
  assert.equal(pub.imageMetaFor('https://a.com/noext').filename, 'image.png');
});

test('buildMultipart：boundary 可注入 → 字节确定，二进制原样，结尾有闭合分隔线', () => {
  const { body, contentType, boundary } = pub.buildMultipart(
    [],
    { name: 'media', filename: 'image.png', mime: 'image/png', buffer: Buffer.from('RAW') },
    { boundary: 'BOUND' },
  );
  assert.equal(boundary, 'BOUND');
  assert.equal(contentType, 'multipart/form-data; boundary=BOUND');
  const text = body.toString('binary');
  assert.match(text, /^--BOUND\r\nContent-Disposition: form-data; name="media"; filename="image\.png"\r\nContent-Type: image\/png\r\n\r\nRAW\r\n--BOUND--\r\n$/);
  // 字节层面没有被 utf8 破坏
  assert.ok(body.includes(Buffer.from('RAW')));

  // 带普通字段（微信有些接口要同时带 text 字段）
  const withField = pub.buildMultipart([{ name: 'type', value: 'image' }], null, { boundary: 'B' });
  assert.match(withField.body.toString(), /name="type"\r\n\r\nimage\r\n--B--\r\n/);
});

test('truncateChars：按码点截断，中文与 emoji 不会被切成半个', () => {
  assert.equal(pub.truncateChars('abc', 5), 'abc');
  assert.equal(pub.truncateChars('你好世界', 3), '你好…');
  assert.equal(pub.truncateChars('发布啦🎉🎉', 4), '发布啦…');
  assert.equal(Array.from(pub.truncateChars('🎉🎉🎉🎉🎉', 3)).length, 3, '截断后按码点计数');
  assert.equal(pub.truncateChars(null, 3), '');
});

test('htmlToPlainText：去标签、块级换行、实体解码、剔除 script/style', () => {
  const html = '<style>p{color:red}</style><p>第一段&nbsp;<b>加粗</b></p><p>第二段 &amp; &lt;tag&gt;</p>'
    + '<script>alert(1)</script>';
  const text = pub.htmlToPlainText(html);
  assert.match(text, /第一段 加粗/);
  assert.match(text, /第二段 & <tag>/);
  assert.equal(text.includes('color:red'), false);
  assert.equal(text.includes('alert'), false);
  assert.equal(pub.htmlToPlainText('<br>a<br/>b'), 'a b');
});

test('buildDraftPayload：articles 数组 + 字段齐全，author/digest 按微信上限截断', () => {
  const payload = pub.buildDraftPayload({
    title: '标题', author: '一二三四五六七八九十十一十二十三十四十五十六十七', digest: 'x'.repeat(200),
    content: '<p>正文</p>', thumbMediaId: 'MEDIA', needOpenComment: '1', onlyFansCanComment: undefined,
  });
  const article = payload.articles[0];
  assert.equal(payload.articles.length, 1);
  assert.equal(article.title, '标题');
  assert.equal(Array.from(article.author).length, pub.LIMITS.author);
  assert.equal(Array.from(article.digest).length, pub.LIMITS.digest);
  assert.equal(article.content, '<p>正文</p>');
  assert.equal(article.thumb_media_id, 'MEDIA');
  assert.equal(article.need_open_comment, 1);
  assert.equal(article.only_fans_can_comment, 0);
});

test('validateDraft：缺标题/超长/正文为空/超长都拦下，摘要与封面只提示', () => {
  // 上限依据官方 draft/add 文档：title ≤32 字、author ≤16 字、digest ≤120 字、content <2 万字符
  assert.deepEqual(pub.LIMITS, { title: 32, author: 16, digest: 120, content: 20000 });
  assert.deepEqual(pub.validateDraft({ title: '', content: '<p>x</p>' }).errors, ['缺少标题：公众号草稿必须有标题']);
  assert.match(pub.validateDraft({ title: 'x'.repeat(33), content: 'x' }).errors[0], /超过微信上限 32 字/);
  assert.deepEqual(pub.validateDraft({ title: 'T', content: '  ' }).errors, ['正文为空']);
  assert.match(pub.validateDraft({ title: 'T', content: 'x'.repeat(20001) }).errors[0], /正文 20001 字符/);

  const ok = pub.validateDraft({ title: 'T', content: '<p>正文</p>', digest: 'd'.repeat(200) });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.warnings.length, 2);
  assert.match(ok.warnings[0], /摘要/);
  assert.match(ok.warnings[1], /封面/);
});

test('sanitizeMpConfig：H3 —— 对外配置永不含 appSecret（连片段也不含）', () => {
  const missing = pub.sanitizeMpConfig(null);
  assert.equal(missing.configured, false);
  assert.equal(missing.secretConfigured, false);
  assert.match(missing.hint, /MP_APP_ID/);

  const secret = 'SUPER_SECRET_VALUE_1234567890';
  const cfg = pub.sanitizeMpConfig({ appId: 'wx123', appSecret: secret, accountName: '我的号' });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.appId, 'wx123');
  assert.equal(cfg.accountName, '我的号');
  assert.equal(cfg.secretConfigured, true);
  const serialized = JSON.stringify(cfg);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('SECRET'), false);
  assert.equal(serialized.includes('wx123'), true, 'appId 可以给（前端用于提示配置是否对得上）');
});

// ============= 主链路（fake fetch，离线） =============

function jsonResponse(data) {
  return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data };
}
function imageResponse(bytes, mime = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    headers: { get: () => mime },
    arrayBuffer: async () => Uint8Array.from(Buffer.from(bytes)).buffer,
  };
}
function makeStub({ uploadUrl = 'https://mmbiz.qpic.cn/mmbiz_png/UPLOADED/0?wx_fmt=png', thumbMediaId = 'THUMB', draftMediaId = 'DRAFT' } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    if (target.includes('/cgi-bin/media/uploadimg')) return jsonResponse({ url: uploadUrl });
    if (target.includes('/cgi-bin/material/add_material')) return jsonResponse({ media_id: thumbMediaId });
    if (target.includes('/cgi-bin/draft/add')) return jsonResponse({ media_id: draftMediaId });
    if (!target.includes('api.weixin.qq.com')) return imageResponse('JPEGBYTES', 'image/jpeg');
    throw new Error(`未预期的请求：${target}`);
  };
  return { fetchImpl, calls, count: needle => calls.filter(c => c.url.includes(needle)).length };
}
const stubDeps = fetchImpl => ({
  getMpConfig: () => ({ appId: 'wx1', appSecret: 'sec', accountName: '号' }),
  getAccessToken: async () => 'TOKEN',
  fetchImpl,
});

test('syncDraft：未配置 → MP_NOT_CONFIGURED（不发起任何网络请求）', async () => {
  const { fetchImpl, calls } = makeStub();
  const publisher = pub.make({ getMpConfig: () => null, getAccessToken: async () => 'T', fetchImpl });
  await assert.rejects(() => publisher.syncDraft({ title: 'T', html: '<p>x</p>' }),
    error => { assert.equal(error.code, 'MP_NOT_CONFIGURED'); return true; });
  assert.equal(calls.length, 0);
});

test('syncDraft：本地占位符没换掉 / 标题超长 / 正文无图又没封面 → 都在联网前拦下', async () => {
  const { fetchImpl, calls } = makeStub();
  const publisher = pub.make(stubDeps(fetchImpl));

  await assert.rejects(
    () => publisher.syncDraft({ title: 'T', html: '<p>![图](#img-1)</p><img src="https://a.com/1.png">' }),
    error => { assert.equal(error.code, 'MP_UNRESOLVED_IMAGES'); return true; },
  );
  await assert.rejects(
    () => publisher.syncDraft({ title: 'x'.repeat(80), html: '<p>正文</p><img src="https://a.com/1.png">' }),
    error => { assert.equal(error.code, 'MP_INVALID_DRAFT'); return true; },
  );
  await assert.rejects(
    () => publisher.syncDraft({ title: 'T', html: '<p>正文</p>' }),
    error => { assert.equal(error.code, 'MP_NO_COVER'); return true; },
  );
  assert.equal(calls.length, 0, '三次都应在发起网络请求之前失败');
});

test('syncDraft：全链路（data URL + 外链 → 转存 → 校验 H2 → 封面 → draft/add）', async () => {
  const { fetchImpl, calls, count } = makeStub();
  const publisher = pub.make(stubDeps(fetchImpl));
  const html = '<p>正文</p>'
    + `<img src="${PNG_DATA_URL}">`
    + '<img src="https://example.com/a.jpg">'
    + '<img src="https://mmbiz.qpic.cn/mmbiz_png/already/0?wx_fmt=png">';

  const result = await publisher.syncDraft({ title: '我的标题', html, author: '作者名' });

  assert.equal(count('/cgi-bin/media/uploadimg'), 2, '只有两张未托管的图需要转存');
  assert.equal(count('/cgi-bin/material/add_material'), 1, '封面走永久素材接口');
  assert.equal(count('/cgi-bin/draft/add'), 1);
  assert.equal(result.mediaId, 'DRAFT');
  assert.equal(result.imageCount, 3);
  assert.equal(result.uploadedCount, 2);
  assert.equal(result.hostedSkippedCount, 1, '已托管的 mmbiz 图不重复上传');
  assert.equal(result.coverMediaId, 'THUMB');

  // draft/add 的载荷：正文里的图片全部指向微信图床（H2），且封面与标题正确
  const draftCall = calls.find(c => c.url.includes('/cgi-bin/draft/add'));
  const payload = JSON.parse(draftCall.options.body);
  const article = payload.articles[0];
  assert.equal(article.title, '我的标题');
  assert.equal(article.author, '作者名');
  assert.equal(article.thumb_media_id, 'THUMB');
  assert.equal(article.content.includes('example.com'), false);
  assert.equal(article.content.includes('data:image'), false);
  assert.equal(pub.findUnhostedImages(article.content).length, 0);
  assert.equal((article.content.match(/mmbiz\.qpic\.cn/g) || []).length, 3);
  assert.ok(article.digest.length > 0, '没传摘要时自动从正文生成');

  // multipart 请求体里带的是图片原始字节（不是被 json 包起来的）
  const uploadCall = calls.find(c => c.url.includes('uploadimg'));
  assert.ok(uploadCall.options.body.includes(Buffer.from('PNGBYTES')));
  assert.match(uploadCall.options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.match(uploadCall.url, /access_token=TOKEN/);
});

test('syncDraft：转存返回非微信图床 → 直接失败（不发破图草稿）', async () => {
  const { fetchImpl, count } = makeStub({ uploadUrl: 'https://evil.example.com/a.png' });
  const publisher = pub.make(stubDeps(fetchImpl));
  await assert.rejects(
    () => publisher.syncDraft({ title: 'T', html: `<img src="${PNG_DATA_URL}">` }),
    /非微信图床地址/,
  );
  assert.equal(count('/cgi-bin/draft/add'), 0, '校验失败时绝不能建草稿');
});