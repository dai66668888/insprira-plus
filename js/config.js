// ============= API 配置 =============
export const API_CONF = {
  hotKeyword:    { path: 'hotKeyword/list', source: '全平台热搜推荐-GitHub' },
  hotSpot:       { path: 'hotSpot/getListByPlatform', source: '全平台热点事件-GitHub' },
  dyLikesRank:   { path: 'dy/search/likesRank', source: '每日点赞榜-GitHub' },
  dySearch:      { path: 'dyData/searchArticle', source: '灵感熔炉-跨平台搜索' },
  dyDetail:      { path: 'dyData/queryWork', source: '灵感熔炉-作品详情' },
  dyHotContent:  { path: 'dy/search/hotContentRank', source: '点赞飙升榜-GitHub' },
  dyAccountRank: { path: 'dyData/query', source: '抖音最具影响力账号榜-GitHub' },
  xhsSearch:     { path: 'xhs/search/search', source: '小红书爆款笔记洞察-GitHub' },
  xhsNewSearch:  { path: 'xhsUser/searchArticle', source: '灵感熔炉-跨平台搜索' },
  xhsDetail:     { path: 'xhsUser/queryWorkDetail', source: '灵感熔炉-作品详情' },
  xhsDaily:      { path: 'cozeSkill/getXhsCozeSkillDataOne', source: '小红书每日爆款-GitHub' },
  gzhHotArticle: { path: 'gzh/search/hotArticle', source: '公众号爆款文章洞察-GitHub' },
  gzhNewSearch:  { path: 'gzhData/searchArticle', source: '灵感熔炉-跨平台搜索' },
  gzhDetail:     { path: 'gzhData/queryWork', source: '灵感熔炉-作品详情' },
  gzhArticleDetail: { path: 'gzhData/queryArticleDetail', source: '灵感熔炉-公众号文章详情' },
  aiGzhFeed:     { path: 'parseWork/queryAiMsgs', source: 'AI公众号信息源-GitHub' },
  gzhSearchUser: { path: 'gzhData/searchUser', source: '灵感熔炉' },
  gzhQueryWorks: { path: 'gzhData/queryWorkList', source: '灵感熔炉' },
  sensitiveWord: { path: 'cozeSkill/sensitiveWordSearch', source: '违禁词检测' },
  dyUserQuery:   { path: 'dyUser/query', source: '抖音账号诊断-GitHub' },
  xhsUserQuery:  { path: 'xhsUser/query', source: '小红书账号诊断-GitHub' },
  gzhUserQuery:  { path: 'gzhUser/query', source: '公众号账号诊断-GitHub' },
  imageSubmit:   { path: 'parseWork/imageGen/submitSkill', source: '灵感熔炉-AI封面' },
  imageResult:   { path: 'parseWork/imageGen/result', source: '灵感熔炉-AI封面' },
};

// ============= 平台映射 =============
export const PLATFORMS = {
  dy:     { name: '抖音',    color: 'bg-pink-500' },
  xhs:    { name: '小红书',  color: 'bg-red-500' },
  gzh:    { name: '公众号',  color: 'bg-emerald-500' },
  'ai-gzh': { name: 'AI公众号', color: 'bg-cyan-500' },
  'ai-bili': { name: 'AI B站', color: 'bg-blue-500' },
  'ai-xhs': { name: 'AI小红书', color: 'bg-red-500' },
  wb:     { name: '微博',    color: 'bg-orange-500' },
  bz:     { name: 'B站',     color: 'bg-blue-500' },
  zh:     { name: '知乎',    color: 'bg-blue-600' },
  tt:     { name: '头条',    color: 'bg-red-600' },
  bd:     { name: '百度',    color: 'bg-blue-400' },
  ks:     { name: '快手',    color: 'bg-orange-600' },
};

export const platColor = p => (PLATFORMS[p]?.color || 'bg-gray-500');
export const platName = p => (PLATFORMS[p]?.name || p);
export const platCodeByName = n => ({
  '微博': 'wb', '抖音': 'dy', 'B站': 'bz', '快手': 'ks', '知乎': 'zh', '头条': 'tt', '百度': 'bd'
}[n] || 'dy');

// ============= 路由表 =============
export const ROUTES = {
  dashboard:     { tpl: 'tpl-dashboard' },
  hotlist:       { tpl: 'tpl-hotlist' },
  inspiration:   { tpl: 'tpl-inspiration' },
  search:        { tpl: 'tpl-search' },
  detail:        { tpl: 'tpl-detail' },
  tracker:       { tpl: 'tpl-tracker' },
  library:       { tpl: 'tpl-library' },
  knowledgebase: { tpl: 'tpl-library' },
  creator:       { tpl: 'tpl-creator' },
  skills:        { tpl: 'tpl-skills' },
  agent:         { tpl: 'tpl-agent' },
  settings:      { tpl: 'tpl-settings' },
};

// 保持向后兼容的别名
export const PAGES = ROUTES;

// ============= 通知渠道 =============
export const NOTIFICATION_CHANNELS = [
  ['discord', 'Discord', 'Webhook URL'],
  ['bark', 'Bark', '推送 URL，例如 https://api.day.app/设备Key（也支持 HTTP）'],
  ['webhook', '通用 Webhook', 'HTTPS Webhook URL'],
  ['dingtalk', '钉钉 Bot', '自定义机器人 Webhook URL'],
  ['feishu', '飞书 Bot', '自定义机器人 Webhook URL'],
  ['telegram', 'Telegram Bot', 'Bot Token'],
];

// ============= Cron 常量 =============
export const BUILTIN_CRONS = [
  'hot-realtime', 'hot-daily-dy', 'hot-daily-xhs', 'hot-daily-gzh',
  'hot-trend-analysis', 'hot-daily-report', 'tracked-account-daily', 'cache-clean', 'usage-clean',
  'wersss-sync',
];
export const LOCKED_CRONS = ['cache-clean', 'usage-clean'];

// 系统固定任务：在 cron 列表中禁止删除（与热榜 tab 解耦）
export const PROTECTED_CRONS = [
  'cache-clean', 'usage-clean',
  'hot-realtime', 'hot-trend-analysis', 'hot-daily-report',
  'tracked-account-daily', 'wersss-sync',
];
