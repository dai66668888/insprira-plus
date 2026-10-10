// 每个测试进程独立 DATA_DIR，避免并发污染生产 data/cache.db
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP_DATA_DIR = process.env.TEST_DATA_DIR
  || path.join(os.tmpdir(), `insprira-test-${process.pid}`);

fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
process.env.DATA_DIR = TMP_DATA_DIR;
// 关闭调度器，避免测试进程注册 cron timer
process.env.ENABLE_SCHEDULER = 'false';
// 隔离真实 .env：否则 .env 里的值会在启动时反向覆盖上面的开关与密钥（见 server.js 的 syncEnvFileOnBoot）
process.env.ENV_FILE_PATH = path.join(TMP_DATA_DIR, '.env.test-absent');

const server = require('../server.js');

module.exports = server;
module.exports.TMP_DATA_DIR = TMP_DATA_DIR;
