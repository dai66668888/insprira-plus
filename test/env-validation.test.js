// env 数值校验（P0-5）：lib/env.js 是纯文件模块（不依赖 better-sqlite3），
// 因此这套用例在「没装 node_modules」的宿主环境也能直接跑。
// 覆盖：枚举白名单、数值范围边界、0 = 不限制的语义、非法值不落盘、秘密键脱敏（含 LLM_MAX_TOKENS 豁免）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateEnvValue, ENV_NUMBER_RANGES, EDITABLE_ENV_KEYS,
  updateEnvConfig, publicEnvConfig, isSecretKey,
} = require('../lib/env');

// P0-5 要求可编辑的 10 个键
const P05_KEYS = [
  'LLM_MAX_TOKENS', 'LLM_MAX_CONCURRENCY', 'LLM_QUEUE_TIMEOUT_MS',
  'LLM_FIRST_TOKEN_TIMEOUT_MS', 'LLM_IDLE_TIMEOUT_MS', 'LLM_TOTAL_TIMEOUT_MS',
  'LLM_RETRIES', 'LLM_DAILY_CALL_LIMIT', 'REDFOX_DAILY_CALL_LIMIT', 'INGEST_TOKEN',
];

function tmpEnvFile(content = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insprira-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, content);
  return { dir, file };
}

test('validateEnvValue：枚举键只允许白名单取值', () => {
  assert.equal(validateEnvValue('LLM_THINKING', 'disabled').ok, true);
  assert.equal(validateEnvValue('LLM_THINKING', 'default').ok, true);
  const bad = validateEnvValue('LLM_THINKING', 'maybe');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /仅允许/);
});

test('validateEnvValue：数值键必须是纯整数（挡住 abc / 小数 / 负数 / 空前缀）', () => {
  assert.equal(validateEnvValue('LLM_MAX_CONCURRENCY', '4').ok, true);
  for (const value of ['abc', '2.5', '-1', '', ' ', '2x', '1e3']) {
    const r = validateEnvValue('LLM_MAX_CONCURRENCY', value);
    assert.equal(r.ok, false, `${JSON.stringify(value)} 应被拒绝`);
    assert.match(r.error, /整数/);
  }
});

test('validateEnvValue：范围边界——刚好上下限通过，越界拒绝', () => {
  assert.equal(validateEnvValue('LLM_MAX_CONCURRENCY', '1').ok, true);
  assert.equal(validateEnvValue('LLM_MAX_CONCURRENCY', '16').ok, true);
  assert.equal(validateEnvValue('LLM_MAX_CONCURRENCY', '17').ok, false);
  assert.equal(validateEnvValue('LLM_MAX_TOKENS', '256').ok, true);
  assert.equal(validateEnvValue('LLM_MAX_TOKENS', '32768').ok, true);
  assert.equal(validateEnvValue('LLM_MAX_TOKENS', '255').ok, false);
  assert.equal(validateEnvValue('LLM_MAX_TOKENS', '32769').ok, false);
  assert.equal(validateEnvValue('LLM_TOTAL_TIMEOUT_MS', '1000').ok, true);
  assert.equal(validateEnvValue('LLM_TOTAL_TIMEOUT_MS', '600000').ok, true);
  assert.equal(validateEnvValue('LLM_TOTAL_TIMEOUT_MS', '999').ok, false);
  assert.equal(validateEnvValue('LLM_TOTAL_TIMEOUT_MS', '600001').ok, false);
  assert.equal(validateEnvValue('LLM_RETRIES', '5').ok, true);
  assert.equal(validateEnvValue('LLM_RETRIES', '6').ok, false);
});

test('validateEnvValue：限额类的 0 是「不限制」，必须放行', () => {
  assert.equal(validateEnvValue('LLM_DAILY_CALL_LIMIT', '0').ok, true);
  assert.equal(validateEnvValue('REDFOX_DAILY_CALL_LIMIT', '0').ok, true);
  assert.equal(validateEnvValue('LLM_RETRIES', '0').ok, true);
  assert.equal(validateEnvValue('LLM_DAILY_CALL_LIMIT', '100001').ok, false);
});

test('ENV_NUMBER_RANGES：区间合法、键可编辑，且 P0-5 的 10 个键都已开放', () => {
  for (const [key, [min, max]] of Object.entries(ENV_NUMBER_RANGES)) {
    assert.ok(EDITABLE_ENV_KEYS.includes(key), `${key} 应在 EDITABLE_ENV_KEYS 内`);
    assert.ok(Number.isInteger(min) && Number.isInteger(max) && min <= max, `${key} 区间非法`);
  }
  for (const key of P05_KEYS) {
    assert.ok(EDITABLE_ENV_KEYS.includes(key), `${key} 应加进 EDITABLE_ENV_KEYS`);
  }
});

test('updateEnvConfig：非法数值抛错且不落盘；合法值写入并同步 process.env', () => {
  const { dir, file } = tmpEnvFile('LLM_MAX_CONCURRENCY=2\n');
  assert.throws(() => updateEnvConfig(file, { LLM_MAX_CONCURRENCY: 'abc' }), /整数/);
  assert.throws(() => updateEnvConfig(file, { LLM_MAX_CONCURRENCY: '99' }), /超出范围/);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), 'LLM_MAX_CONCURRENCY=2', '抛错时文件必须保持原样');

  updateEnvConfig(file, { LLM_MAX_CONCURRENCY: '8', LLM_DAILY_CALL_LIMIT: '0' });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^LLM_MAX_CONCURRENCY=8$/m);
  // '0' 是非空字符串 → 不会被「空值跳过」吞掉，这是「设为 0」的唯一正确传法
  assert.match(text, /^LLM_DAILY_CALL_LIMIT=0$/m);
  assert.equal(process.env.LLM_MAX_CONCURRENCY, '8', '应同步到 process.env 以便立即生效');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('publicEnvConfig：秘密键不回传值，INGEST_TOKEN 脱敏但 configured 可见', () => {
  const { dir, file } = tmpEnvFile('INGEST_TOKEN=deadbeef\nLLM_MODEL=glm-4\nLLM_MAX_TOKENS=8192\n');
  const config = publicEnvConfig(file);
  assert.equal(config.INGEST_TOKEN.secret, true);
  assert.equal(config.INGEST_TOKEN.value, '');
  assert.equal(config.INGEST_TOKEN.configured, true);
  assert.equal(config.LLM_MODEL.secret, false);
  assert.equal(config.LLM_MODEL.value, 'glm-4');
  assert.equal(config.LLM_MODEL.configured, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isSecretKey：LLM_MAX_TOKENS 虽是「TOKEN」命名但要能看见，其余密钥类照旧脱敏', () => {
  assert.equal(isSecretKey('INGEST_TOKEN'), true);
  assert.equal(isSecretKey('LLM_API_KEY'), true);
  assert.equal(isSecretKey('REDFOX_WEB_COOKIE'), true);
  assert.equal(isSecretKey('MP_APP_SECRET'), true);
  assert.equal(isSecretKey('LLM_MAX_TOKENS'), false, '数值上限不是密钥');
  assert.equal(isSecretKey('LLM_MODEL'), false);
});