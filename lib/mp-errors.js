// 微信开放接口错误归类（纯函数：无网络、无 DB、无 fetch）
//
// 为什么单独成模块：`lib/wechat-official.js`（datacube 数据源）与
// `lib/mp-publisher.js`（草稿箱同步，P1-3）都要把微信返回的 { errcode, errmsg }
// 变成「人能看懂、且能直接给出下一步动作」的错误。放在这里两边共用，
// 也顺带让「40164 提取被拒 IP」这段逻辑第一次有了单测。
//
// 40164 的 errmsg 形如：
//   invalid ip 1.2.3.4 ipv6 ::ffff:1.2.3.4, not in whitelist
function extractIpFromErrmsg(errmsg) {
  const match = String(errmsg || '').match(/invalid ip ([\d.]+)/);
  return match ? match[1] : '';
}

// 把微信错误结构化：errcode + （40164 时）被拒 IP
function mpError(prefix, data = {}) {
  const err = new Error(`${prefix}：${data.errmsg || `errcode ${data.errcode ?? '未知'}`}`);
  if (data.errcode != null) err.errcode = data.errcode;
  const ip = extractIpFromErrmsg(data.errmsg);
  if (ip) err.ip = ip;
  return err;
}

// 常见错误码 → 可执行建议（前端直接展示，不用用户自己去猜意思）
const HINTS = {
  40164: ip => `出口 IP ${ip || '（见报错信息）'} 不在公众平台的 IP 白名单：请到「设置与开发 → 基本配置 → IP 白名单」把该 IP 追加进去后重试`,
  40001: () => 'access_token 无效（可能已被别处刷新）：重试即可，本机会自动换新 token',
  40014: () => 'access_token 非法：重试即可',
  42001: () => 'access_token 已过期：重试即可',
  41001: () => '缺少 access_token：检查 MP_APP_ID / MP_APP_SECRET 是否填全',
  40125: () => 'AppSecret 不正确：重新从公众平台复制 AppSecret 填进 .env',
  40007: () => '不合法的 media_id：封面素材可能已失效，请重新同步',
  45009: () => '接口调用超过当日限额：明天再试，或降低同步频率',
  53500: () => '草稿接口权限不足：草稿箱接口需要认证号（服务号/订阅号已认证）',
};

function classifyMpError(error) {
  const errcode = error?.errcode ?? null;
  const ip = error?.ip || extractIpFromErrmsg(error?.message) || null;
  const hint = typeof HINTS[errcode] === 'function' ? HINTS[errcode](ip) : '';
  return {
    code: errcode,
    ip,
    message: error?.message || String(error || '未知错误'),
    hint,
  };
}

module.exports = { extractIpFromErrmsg, mpError, classifyMpError, HINTS };