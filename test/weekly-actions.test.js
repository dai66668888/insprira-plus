// P1-5 周行动项锚点与去重（纯函数，可离线跑）：J1 的达成口径 + J3 的代码约束
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeActionText, normalizeActionAnchors, actionAnchorRatio, dedupeAgainstHistory,
} = require('../lib/weekly-actions');

const ACCOUNTS = [
  { id: 11, name: '公众号A', plat: 'gzh' },
  { id: 22, name: '抖音B', plat: 'dy' },
];

test('normalizeActionAnchors：accountId 精确匹配真实账号才保留锚点', () => {
  const rows = normalizeActionAnchors(
    [{ text: '把公众号A 的标题改成数字型', accountId: '11' }, { text: '抖音B 多发实测视频', accountId: 22 }],
    ACCOUNTS,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].account_id, '11');
  assert.equal(rows[1].account_id, '22', '数字类型也要归一为字符串');
  assert.deepEqual(rows.map(r => r.anchored), [true, true]);
});

test('normalizeActionAnchors：模型只报账号名（或带空白）也能回填 id', () => {
  const rows = normalizeActionAnchors(
    [{ text: 'x', accountId: '公众号A' }, { text: 'y', accountId: ' 抖音B ' }],
    ACCOUNTS,
  );
  assert.equal(rows[0].account_id, '11');
  assert.equal(rows[1].account_id, '22');
});

test('normalizeActionAnchors：编造的 id / 未知名字 → 锚点留空，但行动项保留（不丢建议）', () => {
  const rows = normalizeActionAnchors(
    [{ text: '整站优化', accountId: '999' }, { text: '泛化建议', accountId: '不存在的账号' }, { text: '无锚点建议' }],
    ACCOUNTS,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.account_id), ['', '', '']);
  assert.deepEqual(rows.map(r => r.anchored), [false, false, false]);
});

test('normalizeActionAnchors：账号锚点无效时，作品锚点一并丢掉（避免跳到没头没尾的详情）', () => {
  const rows = normalizeActionAnchors(
    [{ text: 'a', accountId: '999', workId: 'w-1' }, { text: 'b', accountId: '11', workId: 'w-2' }],
    ACCOUNTS,
  );
  assert.equal(rows[0].work_id, '', '账号都不认识，就别认作品');
  assert.equal(rows[1].work_id, 'w-2');
});

test('normalizeActionAnchors：兼容纯字符串老格式、空文本/空值丢弃', () => {
  const rows = normalizeActionAnchors(
    ['老格式一句话', { text: '' }, { text: '   ' }, null, { action: '另一种字段名' }, { title: '第三种字段名' }],
    ACCOUNTS,
  );
  assert.deepEqual(rows.map(r => r.text), ['老格式一句话', '另一种字段名', '第三种字段名']);
  assert.deepEqual(rows.map(r => r.account_id), ['', '', '']);
  assert.deepEqual(normalizeActionAnchors(null, ACCOUNTS), []);
});

test('normalizeActionAnchors：workId 的 none/null 字面量视为没有', () => {
  const rows = normalizeActionAnchors([{ text: 'a', accountId: '11', workId: 'null' }], ACCOUNTS);
  assert.equal(rows[0].work_id, '');
  assert.equal(normalizeActionAnchors([{ text: 'a', accountId: '11', contentKey: 'w-9' }], ACCOUNTS)[0].work_id, 'w-9');
});

test('actionAnchorRatio：J1 口径 —— 4/5 条 = 0.8；空列表 ratio 记 0（不假装 100%）', () => {
  const rows = normalizeActionAnchors(
    [
      { text: '1', accountId: '11' }, { text: '2', accountId: '22' },
      { text: '3', accountId: '11' }, { text: '4', accountId: '抖音B' }, { text: '5' },
    ],
    ACCOUNTS,
  );
  const stat = actionAnchorRatio(rows);
  assert.deepEqual(stat, { total: 5, anchored: 4, ratio: 0.8 });
  assert.equal(stat.ratio >= 0.8, true, '恰好达到 J1 门槛');
  assert.deepEqual(actionAnchorRatio([]), { total: 0, anchored: 0, ratio: 0 });
  assert.deepEqual(actionAnchorRatio(null), { total: 0, anchored: 0, ratio: 0 });
});

test('normalizeActionText：忽略空白与中英文标点差异，便于「原样重复」判定', () => {
  assert.equal(normalizeActionText('把标题改成数字型。'), normalizeActionText('  把标题改成数字型  '));
  assert.equal(normalizeActionText('A：改标题'), normalizeActionText('a 改标题'));
  assert.notEqual(normalizeActionText('改标题'), normalizeActionText('改开头'));
  assert.equal(normalizeActionText(null), '');
});

test('dedupeAgainstHistory：上周已完成项原样重复 → 丢掉并说明原因（J3）', () => {
  const rows = normalizeActionAnchors(
    [{ text: '给公众号A 加互动引导。', accountId: '11' }, { text: '抖音B 换开场三秒', accountId: '22' }],
    ACCOUNTS,
  );
  const { kept, dropped } = dedupeAgainstHistory(rows, [
    { text: '给公众号A加互动引导', status: 'done' },
    { text: '抖音B 换开场三秒', status: 'pending' },
  ]);
  assert.deepEqual(kept.map(r => r.text), ['抖音B 换开场三秒'], '未完成的上周行动可以重提');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].droppedBy, 'done-last-week');
});

test('dedupeAgainstHistory：批次内自我重复也去掉；已忽略项不构成禁令', () => {
  const rows = normalizeActionAnchors([{ text: '同一条建议' }, { text: '同一条建议。' }], ACCOUNTS);
  const first = dedupeAgainstHistory(rows, []);
  assert.equal(first.kept.length, 1);
  assert.equal(first.dropped[0].droppedBy, 'duplicate-in-batch');

  const second = dedupeAgainstHistory(normalizeActionAnchors([{ text: '已忽略过的建议' }], ACCOUNTS), [
    { text: '已忽略过的建议', status: 'dismissed' },
  ]);
  assert.equal(second.kept.length, 1, '「已忽略」不该被当成「已完成」去封杀');
  assert.deepEqual(dedupeAgainstHistory(null, null), { kept: [], dropped: [] });
});