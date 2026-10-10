// .env 路径解析（ENV_FILE_PATH 覆盖语义）与「隔离后一律回退 process.env」的前提
// 无 DB 依赖：只 require 纯工具模块，不经过 _helper.js / _server.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveEnvFile, readEnvValues } = require('../lib/env');

const DEFAULT_ENV_FILE = path.join(__dirname, '..', '.env');
const ABSENT_ENV_FILE = path.join(__dirname, '.env.absent-for-test');

function withEnvFilePath(value, fn) {
  const saved = process.env.ENV_FILE_PATH;
  try {
    if (value === undefined) delete process.env.ENV_FILE_PATH;
    else process.env.ENV_FILE_PATH = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.ENV_FILE_PATH;
    else process.env.ENV_FILE_PATH = saved;
  }
}

test('① 未设置 ENV_FILE_PATH 时解析到仓库根的 .env（默认行为不变）', () => {
  withEnvFilePath(undefined, () => {
    assert.equal(resolveEnvFile(), DEFAULT_ENV_FILE);
  });
});

test('② 设置 ENV_FILE_PATH 时按覆盖值解析（测试隔离 / 多实例各用一份配置）', () => {
  withEnvFilePath(ABSENT_ENV_FILE, () => {
    assert.equal(resolveEnvFile(), ABSENT_ENV_FILE);
  });
});

test('③ 临时 ENV_FILE 不存在时 readEnvValues 读空（这是隔离能挡住真实 .env 的前提）', () => {
  assert.equal(fs.existsSync(ABSENT_ENV_FILE), false);
  assert.deepEqual(readEnvValues(ABSENT_ENV_FILE), {});
});

test('④ 覆盖值两端空白会被裁剪（避免手写环境变量时多一个空格就失效）', () => {
  withEnvFilePath(`  ${ABSENT_ENV_FILE}  `, () => {
    assert.equal(resolveEnvFile(), ABSENT_ENV_FILE);
  });
});