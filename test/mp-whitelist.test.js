// IP 白名单自动配置：纯函数部分（合并/出口 IP 探测/Chrome 定位）
// 浏览器流程依赖真实公众平台登录 + 管理员扫码，不做自动化测试
require('./_helper');
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeWhitelistEntries, detectOutboundIp, findChrome } = require('../lib/mp-whitelist');

test('mergeWhitelistEntries：追加去重不覆盖，兼容多种分隔符', () => {
  assert.equal(mergeWhitelistEntries('', ['1.2.3.4']), '1.2.3.4');
  assert.equal(mergeWhitelistEntries('1.1.1.1', ['2.2.2.2']), '1.1.1.1\n2.2.2.2');
  // 已有条目原样保留，重复不追加
  assert.equal(mergeWhitelistEntries('1.1.1.1\n2.2.2.2', ['2.2.2.2', '3.3.3.3']), '1.1.1.1\n2.2.2.2\n3.3.3.3');
  // 逗号/分号/中文分号/空白混用
  assert.equal(mergeWhitelistEntries('1.1.1.1, 2.2.2.2；3.3.3.3', ['4.4.4.4']), '1.1.1.1\n2.2.2.2\n3.3.3.3\n4.4.4.4');
  // CIDR 条目保留
  assert.equal(mergeWhitelistEntries('10.0.0.0/24', ['1.2.3.4']), '10.0.0.0/24\n1.2.3.4');
});

test('detectOutboundIp：多源容灾，返回合法 IPv4', async () => {
  const ip = await detectOutboundIp(async () => ({ text: async () => '  203.0.113.7\n' }));
  assert.equal(ip, '203.0.113.7');
  // 第一个源失败时 fallback 到第二个
  let n = 0;
  const ip2 = await detectOutboundIp(async () => {
    n++;
    if (n === 1) throw new Error('网络不可达');
    return { text: async () => '198.51.100.2' };
  });
  assert.equal(ip2, '198.51.100.2');
  // 全部失败 → 抛错，不猜 IP
  await assert.rejects(() => detectOutboundIp(async () => { throw new Error('x'); }), /出口 IP 探测失败/);
});

test('findChrome：CHROME_PATH 环境变量优先', () => {
  const old = process.env.CHROME_PATH;
  // findChrome 会校验路径存在性，用临时真实文件代替硬编码路径，
  // 不依赖测试机的操作系统与 Chrome 安装情况（原作者注：无 Chrome 环境需调整该断言）
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const fakeChrome = path.join(os.tmpdir(), `insprira-test-chrome-${process.pid}`);
  fs.writeFileSync(fakeChrome, '');
  try {
    process.env.CHROME_PATH = fakeChrome;
    assert.equal(findChrome(), fakeChrome);
    process.env.CHROME_PATH = path.join(os.tmpdir(), 'nonexistent-chrome-xyz');
    assert.notEqual(findChrome(), process.env.CHROME_PATH); // 不存在的路径被忽略
  } finally {
    if (old === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = old;
    fs.rmSync(fakeChrome, { force: true });
  }
});
