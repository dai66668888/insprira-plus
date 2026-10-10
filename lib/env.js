// .env 文件读写 + 服务重启逻辑
// 不持有运行时状态，纯文件 + 进程操作
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const EDITABLE_ENV_KEYS = [
  'REDFOX_API_KEY', 'REDFOX_WEB_COOKIE', 'REDFOX_HOST', 'REDFOX_APPLY_URL',
  'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_FALLBACK_MODEL', 'LLM_THINKING',
  'KB_ENCRYPTION_KEY', 'GITHUB_API_TOKEN', 'ENABLE_SCHEDULER', 'USER_TIMEZONE',
  'CODEX_BIN', 'CLAUDE_BIN', 'KIMI_BIN', 'OPENCLAW_BIN', 'HERMES_BIN',
  'MP_APP_ID', 'MP_APP_SECRET', 'MP_ACCOUNT_NAME', 'CHROME_PATH',
  // P0-5：预算与稳定性开关（其中数值键的取值范围见 ENV_NUMBER_RANGES）
  'LLM_MAX_TOKENS', 'LLM_MAX_CONCURRENCY', 'LLM_QUEUE_TIMEOUT_MS',
  'LLM_FIRST_TOKEN_TIMEOUT_MS', 'LLM_IDLE_TIMEOUT_MS', 'LLM_TOTAL_TIMEOUT_MS',
  'LLM_RETRIES', 'LLM_DAILY_CALL_LIMIT', 'REDFOX_DAILY_CALL_LIMIT', 'INGEST_TOKEN',
];

// 取值受限的键：写入前校验，防止设置页/手工提交非法值
// LLM_THINKING：'default' = 不下发 thinking 参数（跟随模型默认），disabled/enabled 见 lib/llm.js
const ENV_VALUE_WHITELIST = {
  LLM_THINKING: ['default', 'disabled', 'enabled'],
};

// 数值型键的取值范围（闭区间）：写入前校验，挡住手滑填出的 abc / 0 / 天量值。
// 上界按 .env.example 的注释给（默认值见注释），下限取「业务上仍说得通」的最小值。
const ENV_NUMBER_RANGES = {
  LLM_MAX_TOKENS: [256, 32768],
  LLM_MAX_CONCURRENCY: [1, 16],
  LLM_QUEUE_TIMEOUT_MS: [1000, 600000],
  LLM_FIRST_TOKEN_TIMEOUT_MS: [1000, 600000],
  LLM_IDLE_TIMEOUT_MS: [1000, 600000],
  LLM_TOTAL_TIMEOUT_MS: [1000, 600000],
  LLM_RETRIES: [0, 5],
  LLM_DAILY_CALL_LIMIT: [0, 100000],
  REDFOX_DAILY_CALL_LIMIT: [0, 100000],
};

// 纯函数：校验单个键的取值（枚举 + 数值范围）。返回 { ok: true } 或 { ok: false, error }。
// 调用方在传进来之前已 trim，且空值会被跳过（空 input 保留 .env 原值）。
function validateEnvValue(key, value) {
  const text = String(value ?? '').trim();
  const allowed = ENV_VALUE_WHITELIST[key];
  if (allowed && !allowed.includes(text)) {
    return { ok: false, error: `${key} 仅允许以下取值：${allowed.join(' / ')}` };
  }
  const range = ENV_NUMBER_RANGES[key];
  if (range) {
    const [min, max] = range;
    if (!/^\d+$/.test(text)) return { ok: false, error: `${key} 只能是整数（${min}~${max}）` };
    const num = Number(text);
    if (num < min || num > max) return { ok: false, error: `${key} 超出范围：应在 ${min}~${max} 之间` };
  }
  return { ok: true };
}

// .env 路径解析：默认仓库根的 .env，可用 ENV_FILE_PATH 覆盖。
// 覆盖的用途：测试隔离（test/_server.js、test/_helper.js 指向不存在的临时路径，
// 避免真实 .env 的密钥/开关污染测试进程），以及多实例各用一份配置。
function resolveEnvFile() {
  const override = (process.env.ENV_FILE_PATH || '').trim();
  return override || path.join(__dirname, '..', '.env');
}

// 进程内解析一次的路径：server.js 的启动加载、启动期同步与热加载共用它
const ENV_FILE = resolveEnvFile();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function readEnvValues(envFile) {
  const values = {};
  if (!fs.existsSync(envFile)) return values;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

// 秘密键判定：命中密钥类命名就一律不回传值（宁可多脱敏）。
// 例外：LLM_MAX_TOKENS 名字里含 TOKEN，但它只是「生成 token 数上限」，必须能在设置页看见当前值。
const SECRET_KEY_PATTERN = /KEY|PASSWORD|COOKIE|TOKEN|SECRET/;
function isSecretKey(key) {
  return key !== 'LLM_MAX_TOKENS' && SECRET_KEY_PATTERN.test(key);
}

function publicEnvConfig(envFile) {
  const values = readEnvValues(envFile);
  return Object.fromEntries(EDITABLE_ENV_KEYS.map(key => [key, {
    configured: Boolean(values[key]),
    value: isSecretKey(key) ? '' : (values[key] || ''),
    secret: isSecretKey(key),
  }]));
}

function updateEnvConfig(envFile, input) {
  const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
  const updates = new Map();
  for (const key of EDITABLE_ENV_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    const value = String(input[key] ?? '').trim();
    // 空值一律 skip：保留 .env 已有值，避免前端空 input 误清空
    if (!value) continue;
    const check = validateEnvValue(key, value);
    if (!check.ok) throw new Error(check.error);
    updates.set(key, value);
  }
  const seen = new Set();
  const lines = existing.map(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match || !updates.has(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates.get(match[1]).replace(/\r?\n/g, '')}`;
  });
  for (const [key, value] of updates) {
    if (!seen.has(key)) lines.push(`${key}=${value.replace(/\r?\n/g, '')}`);
  }
  fs.writeFileSync(envFile, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);
  // 同步到 process.env，让运行中的服务立即生效（无需重启）
  for (const [key, value] of updates) {
    process.env[key] = value;
  }
  return publicEnvConfig(envFile);
}

function restartCurrentService() {
  setTimeout(() => {
    if (process.env.FURNACE_RESTART_CMD) {
      const [cmd, ...args] = process.env.FURNACE_RESTART_CMD.split(/\s+/);
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    // Docker 容器：直接 exit，Docker restart 策略自动拉起
    const isDocker = fs.existsSync('/.dockerenv');
    if (isDocker) {
      console.log('[restart] Docker 容器内重启：进程退出，Docker restart 策略自动拉起');
      process.exit(0);
      return;
    }
    const isSystemd = fs.existsSync('/run/systemd/system') || fs.existsSync(path.join(os.homedir(), '.config/systemd/user/insprira.service'));
    if (isSystemd) {
      spawn('systemctl', ['--user', 'restart', 'insprira.service'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return;
    }
    console.warn('[restart] 未检测到 systemd / Docker，进程将退出。请用外层管理器（pm2 / npm start / nohup）重启。');
    process.exit(0);
  }, 500);
}

module.exports = {
  EDITABLE_ENV_KEYS,
  ENV_VALUE_WHITELIST,
  ENV_NUMBER_RANGES,
  validateEnvValue,
  isSecretKey,
  ENV_FILE,
  resolveEnvFile,
  loadEnvFile,
  readEnvValues,
  publicEnvConfig,
  updateEnvConfig,
  restartCurrentService,
};
