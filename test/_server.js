// 路由级集成测试引导：启动真实 http server 到随机端口
// 与 _helper.js（纯函数测试）分开，避免互相污染
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP_DATA_DIR = process.env.TEST_ROUTE_DATA_DIR
  || path.join(os.tmpdir(), `insprira-route-${process.pid}`);
fs.mkdirSync(TMP_DATA_DIR, { recursive: true });

process.env.DATA_DIR = TMP_DATA_DIR;
process.env.ENABLE_SCHEDULER = 'false';
process.env.HOST = '127.0.0.1';
// 隔离真实 .env：把 .env 路径指向临时目录下一个「不存在」的文件。
// 必须做这一步 —— server.js 启动时会「以 .env 文件为准覆盖非 docker 管理变量」，
// 光用 process.env 占位挡不住用户本地的真实 .env（现象：测试真去调 LLM/RedFox）；
// 隔离后 readEnvValues(ENV_FILE) 一律读空并回退 process.env。
const ENV_FILE = path.join(TMP_DATA_DIR, '.env.test-absent');
process.env.ENV_FILE_PATH = ENV_FILE;
// 屏蔽真实密钥（loadEnvFile 只在 process.env[key] == null 时填，先占位；隔离后不再被 .env 覆盖）
process.env.REDFOX_API_KEY = '';
process.env.LLM_API_KEY = '';
process.env.LLM_BASE_URL = '';
process.env.LLM_MODEL = '';
process.env.KB_ENCRYPTION_KEY = '';

const { server } = require('../server.js');

let baseUrl = null;

async function boot() {
  if (baseUrl) return baseUrl;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

async function close() {
  if (!baseUrl) return;
  await new Promise((r) => server.close(r));
  baseUrl = null;
}

async function req(pathStr, opts = {}) {
  if (!baseUrl) throw new Error('call boot() first');
  const headers = { ...(opts.headers || {}) };
  let body;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const res = await fetch(`${baseUrl}${pathStr}`, {
    method: opts.method || 'GET',
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, headers: res.headers, body: text, json };
}

module.exports = { boot, close, req, TMP_DATA_DIR, ENV_FILE };
