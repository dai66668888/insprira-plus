# 灵感熔炉 · 产品分析与 V1 优化建议

> **文档性质**：基于仓库现状（`insprira` 工作树快照）的产品分析与 V1 范围建议。由产品经理专家产出，主理人对承重事实逐条复核后定稿（复核范围与修正见 §6）。
> **阅读约定**
> - 未标注的陈述 = **仓库事实**，均附 `文件:行号`；标 **【建议】** = 产品判断，非仓库既有结论。
> - 涉及「用户会怎样 / 用户需要什么」的判断一律写 **需确认**，不编造调研数据。
> - 本文档为分析文档，未改动任何代码；分析期间未运行 `npm install` / `npm test`（本环境无 `node_modules`）。
> - 已确认的用户问题（AI 创作超时失败、热点趋势不显示、marked 爆栈、`docs/optimization-plan.md` Phase 1-5 已交付）作为输入，不重复论证。
> - 行号基于本工作树快照：实施后会有漂移，定位时请以函数名 / 接口名 / 表名检索为准，不要只依赖行号。
>
> **与 `docs/optimization-plan.md` 的分工**：那份是**工程视角**的实施清单（LLM 调用层、缓存、趋势口径、预算熔断，多数已 `[x]`）；本文是**产品视角**的范围与验收定义（目标用户 / 核心场景 / V1 范围 / 暂缓事项 / 可观察验收标准）。两者互补，不互相替代。
> **落地实施看** `docs/product-plan-v1-execution.md`：把本文 §3 的 P0/P1 拆成带勾选、改动落点、门禁与回滚的任务卡（A1~J3 验收编号的定义仍在本文 §5）。

## 目录

1. [目标用户](#1-目标用户)
2. [核心场景](#2-核心场景)
3. [第一版范围（V1）](#3-第一版范围v1)
4. [暂缓事项](#4-暂缓事项)
5. [核心能力的可观察验收标准](#5-核心能力的可观察验收标准)
6. [事实抽验与修正记录](#6-事实抽验与修正记录)
- [事实来源清单](#事实来源清单)

---

## 1. 目标用户

### 1.1 一句话画像

**一个人同时担任选题、写作、排版、发布、复盘全部角色，以公众号为主战场、小红书/抖音为分发端，靠 Docker 自托管「灵感熔炉」，把日更从 3-4 小时压到 1 小时内的自媒体主理人。**

| 维度 | 画像 | 仓库依据 |
|---|---|---|
| 工作流 | 追热点 → 选题 → 多平台改写 → 排版 → 手动发布到公众号后台 → 看数据 → 周复盘 | `README.md:5-15`；`index.html`（11 个 `nav-item` 侧边栏入口）；`docs/wechat-formatter-integration.md:11-15`（排版+进草稿是链路缺口） |
| 能力约束 | 会跑 Docker、会改 `.env`、会看 `.env.example` 注释；不写代码、不做前端构建 | `README.md:18-49`；`.env.example`（全部配置项带中文注释）；`AGENTS.md`（Tailwind 需 `npm run build`） |
| 资源约束 | 两个硬预算：RedFox API 点数、LLM token；单机单进程，无并发预算 | `lib/redfox.js:158-177`（每日调用预算）；`lib/llm.js:162-175`（每日 LLM 预算）；`ENABLE_SCHEDULER`、`server.js:1114-1147` |
| 使用频率 | 每天多次：早/午/晚看热榜（cron 08/14/18/20），白天写作，23:00 等趋势报告，07:00 账号刷新 | `server.js:314-324`（内置 cron）；`index.html`（热榜刷新时间说明） |
| 动机 | 用最低边际时间成本把「今日一轮」跑完；产出质量靠「对标自己账号基线」而非行业大盘 | `lib/article-analysis.js:14-15, 90-115`（48h 成熟门槛 + 账号自身基线）；`lib/work-stats.js:71-87`（账号典型 24h 增速中位数） |
| 身份模型 | 单用户单身份：`users` 表有 `role` 但无角色校验；「账号」指「我运营的号」（`my_accounts`），不是「人」 | `lib/db.js:398-417`（users/sessions）；`AGENTS.md`（明确「单用户」） |

### 1.2 非目标用户（本轮明确不服务）

| # | 非目标用户 | 为什么不是目标用户 | 仓库事实依据 |
|---|---|---|---|
| 1 | **多账号团队 / MCN / 代运营** | 全套数据模型以「单人单身份」为前提：无成员、无角色校验、无数据分区；「我的账号」是运营者的号而非成员账号 | `lib/db.js:398-417`（`users.role`、`sessions` 无 workspace 概念）；`lib/routes/*` 无任何 `role` 判断 |
| 2 | **不懂技术、想要注册即用的创作者** | 上手门槛 = 必填 RedFox key + 任意 OpenAI 兼容 LLM key + 可选公众号 AppID 白名单 + Docker；无注册/找回密码 | `README.md:22-49`；`.env.example:2-9`（必填段）；`lib/routes/auth.js:18-88`（只有 login/logout/status/version） |
| 3 | **需要审稿-审批流的品牌方内容团队** | 无审稿、评论、审批状态机；`inspirations.status` 是个人看板字段而非流程节点 | `lib/db.js:191-201`（inspirations 无 approver/review 列）；全仓库无 comments/approval 表 |
| 4 | **短视频为主战场的创作者（剪辑/分发）** | 视频侧只有「数据读取」与一个本地 MCP 的发布接口，没有素材、剪辑、多平台视频分发链 | `lib/routes/xhs-mcp.js:107-119`（publish / publish-video，依赖用户自建容器与登录态）；产出物体系是「文本 + 内联样式 HTML」（`js/core/wechat-format/render.js`） |
| 5 | **只买数据看板、不做内容的纯分析用户** | 所有数据能力都挂在「我的账号/追踪账号」，且必须自备 RedFox key；无公共榜单订阅与分享 | `lib/routes/accounts.js:24`（`my-accounts/dashboard`）；`lib/routes/trackers.js:13-24`（追踪需手动添加账号）；`.env.example:3` |

> **【建议】** 第 1、2 条是「用户量增长时最先被问到、但最不该现在做」的两类需求：它们都要动鉴权与数据分区的地基（`lib/auth.js`、`lib/db.js` 的主键设计），与本文档第 3 节的「日更闭环」无直接关系。放入第 4 节暂缓，并写清启动信号。

---

## 2. 核心场景

### 2.1 日更闭环时序与依赖

```
S1 抓热点 ──► S2 判趋势 ──► S3 生成/筛选题 ──► S4 多平台改写 ──► S5 排版 → 复制进公众号后台
                  ▲                                    ▲                        │
                  │                                    │                        ▼
                  └──────── S7 周复盘行动项 ◄── S6 数据追踪/文章诊断 ◄────────── 真实发文
```

| 场景 | 触发时机 | 依赖 |
|---|---|---|
| S1 抓热点 | cron `hot-realtime`（08/14/18/20）+ 平台昨日榜（12:00/20:00）或手动「刷新热点」 | 起点，无依赖 |
| S2 判趋势 | 热榜页「热点趋势」区；cron `hot-trend-analysis`（23:00） | 依赖 S1（≥10 条落库标题；主题卡还需 ≥2 天报告） |
| S3 生成选题 | 灵感页「生成选题」；cron `inspiration-generate` | 依赖 S1/S2 的热点证据 |
| S4 多平台改写 | AI 创作页「开始创作」，素材来自热点/灵感/知识库/追踪文章 | 依赖 S2/S3 + 风格档案（`my_accounts.style_profile`） |
| S5 排版 → 发布 | 侧边栏「公众号排版」；从成稿复制到公众号后台粘贴 | 依赖 S4 的成稿 |
| S6 数据追踪/诊断 | dashboard 账号概览行动按钮；tracker 页同步/诊断；cron 07:00 刷新、09:00 诊断 | 依赖真实发文（与 S4/S5 无代码耦合） |
| S7 周复盘行动项 | dashboard「AI 运营总结」；`weekly_actions` 勾选 | 依赖 S6 |

### S1 抓热点（早/午/晚各一次）

- **用户目标**：8:00 打开就知道今天有什么可用，并且能判断「这份榜单是不是今天的、是不是真的」。
- **当前实现落点**：`index.html`（tpl-hotlist）→ `js/pages/hotlist.js:71`（`renderHotlist`）、`:162`（`renderHotTab`）；路由 `GET /api/_/hot/keywords`、`GET /api/_/hot/list?platform=`、`POST /api/_/hot/keywords/sync`（`lib/routes/hot.js:29-39`）、`GET /api/_/hot/platforms`（`:68`，只返回已启用 cron 的平台）；落库 `hot_batches` / `hot_batch_items`（`lib/db.js:152-182`）；业务层缓存 `lib/redfox.js:132-156`（热点/榜单类端点白名单，TTL 10min-1h）。
- **已经很好的一点（值得复用为范式）**：每个 tab 有细粒度可信度元信息条——数据来源徽标 + 数据日期 + 抓取时间 + 最近一次 API 尝试的失败原因（`js/pages/hotlist.js:53-69`、`:177-184`）。这比「toast 报成功」可信得多。
- **当前断点**：
  1. 手动「刷新热点」是一次阻塞式全平台抓取，等待期只有一句 toast「正在刷新全网热点…」，**无进度、无耗时、无取消、失败不区分平台**（`js/pages/hotlist.js:150-160`；服务端 `lib/routes/hot.js:35-39` 在同一次请求内 await 全平台）。
  2. 平台级「自动刷新：开/关」开关埋在 tab 元信息条里（`js/pages/hotlist.js:180-183`），新用户不知道要打开才会有每日数据；而 `GET /api/_/hot/platforms` **只返回已启用 cron 的平台**（`lib/routes/hot.js:69-77`），所以「没开」的平台的 tab 直接不存在，用户看不到自己缺什么。
- **【建议】** 这两个断点都是「沉默的失败/沉默的空缺」，与已确认问题 2（拿到资料不显示）同源：**能力存在但入口不可见**。

### S2 判趋势（已确认问题 2 的主战场）

- **用户目标**：知道哪些题材在涨、哪些在冷，并且相信这张卡的依据。
- **当前实现落点**：`js/pages/hotlist.js:279`（`loadHotTrends`）、`:342`（`analyzeTrends`）、`:309`（`renderLlmTrends`）；`GET /api/_/hot/trends?days=`（`lib/routes/hot.js:14-21`）、`POST /api/_/hot/trends/analyze`（`:23-27`）；`lib/hot.js:632`（`getHotTrends`）、`:523`（`analyzeDailyHotKeywords`）；表 `hot_daily_keywords`（`lib/db.js:184-189`）。
- **输入中已确认「已交付」的部分（本文档只做一致性核对，不再当待做项）**：路由 `analyzed` 反映真实状态（`lib/routes/hot.js:19`）；空态给原因 + 分析按钮（`js/pages/hotlist.js:288-302`）；分析日期回溯「昨天 → 今天 realtime → 前 7 天」（`lib/hot.js:517-543`）；320 条按 80 条/批分批提取、单批失败跳过（`lib/hot.js:565-593`）；`analyzeTrends` 成功后 toast 实际分析日期（`js/pages/hotlist.js:351`）。
- **当前残留断点（均为可判定的事实）**：

| # | 断点 | 事实依据 | 用户可感知的后果 |
|---|---|---|---|
| 1 | 分析窗口选择器无效：前端把 `?days=` 传给分析接口（`js/pages/hotlist.js:345-349`），路由 `POST /api/_/hot/trends/analyze` 不读参数（`lib/routes/hot.js:23-27`），`analyzeHotTrendsLlm()` 固定返回 `getHotTrends(14)`（`lib/hot.js:713-716`） | 三处代码连线 | 选「最近 7 天」与「最近 14 天」得到**完全一样**的分析与主题卡 → 控件是装饰 |
| 2 | 「重新分析」无条件 `force=true`，绕过 fingerprint 缓存，4 批全量重跑 LLM | `lib/hot.js:556`（`force` 分支）、`:714`（`force=true`）、`:565`（320/80=4 批） | 连点「重新分析」= 每次都重新烧 token；缓存命中逻辑（`:556`）在手动路径不可达 |
| 3 | 分批失败数 `batchStats.failed` 写入库后**全仓库无人读取** | 写入：`lib/hot.js:619`；检索 `batchStats` 仅此 1 处命中 | 4 批中掉 1 批时，趋势卡看起来「正常」，但数据实际缺失 → 用户会把缺失当结论 |
| 4 | 分析等待期只有一行静态文字，无进度/耗时/取消 | `js/pages/hotlist.js:346`（把 `#hot-trends` 换成一行「AI 正在分析热榜趋势…」） | 与已确认问题 1 同构：长任务黑箱（服务端已有重试+分批日志，`lib/hot.js:585-589`，但用户看不到） |

### S3 生成/筛选选题

- **用户目标**：10 分钟内拿到 6 条能写的选题，并知道「这批选题用了多少 API/LLM」。
- **当前实现落点**：`index.html`（tpl-inspiration）→ `js/pages/inspiration.js:367`（`generateInspirations`）；`POST /api/_/inspirations/generate`（`lib/routes/inspiration.js:124-134`）；`lib/inspiration.js`；表 `inspirations` / `inspiration_keyword_configs`（含 `daily_api_budget` 默认 3，`lib/db.js:215`）/ `inspiration_runs` / `inspiration_feedback`；审计 `logAction('generate-inspirations', …, apiCalls, llmCalls)`（`lib/routes/inspiration.js:127-131`、`lib/inspiration.js:1019`）。
- **当前断点**：
  1. **无防重入**：`generateInspirations` 全文无 in-flight 标志、按钮不禁用（`js/pages/inspiration.js:367-405`），与已修复的 `doRewrite` 模式不一致（`js/pages/creator.js:290-300` 有 `rewriteInFlight` + 按钮禁用）。后端也没有对应 single-flight（`/api/_/rewrite` 有，`lib/routes/misc.js:14-21,162-176`；generate 没有）。
  2. **失败不可分型**：结果文案里本可区分 `api / database / skipped-budget / api-failed`（`js/pages/inspiration.js:376-381`），但这段只在**成功路径**渲染（`:398`）；失败路径只给 toast + 状态文字「生成失败」（`:401-404`），「预算跳过」与「API 挂了」对用户是同一件事。
  3. 等待期只有一行状态文字「正在生成选题…」（`:372`），无阶段/耗时——深层搜索 + LLM + JSON 修复可能数分钟（`js/pages/settings.js` 的成本说明已承认这一点）。

### S4 多平台改写（最贵的一步）

- **用户目标**：把素材变成可发的成稿（标题 + 前言 + 正文），并可选地自然蹭上当天热点。
- **当前实现落点**：`index.html`（tpl-creator）→ `js/pages/creator.js:292`（`doRewrite`）；`POST /api/_/rewrite`（single-flight 5s 窗口，`lib/routes/misc.js:14-21,162-176`）；`lib/rewrite.js`；蹭热点 `POST /api/_/rewrite/hotspots`（`lib/routes/misc.js:156-160`，前端用 `confirm()` 明确征求「是否允许调用 API」，`js/pages/creator.js:211-220` ← 这是一个**值得保留的好设计**）；风格档案下拉 `#rewriteStyleProfile`；素材入口 `sendToCreator` / `sendIdeaToCreator` / `sendKbToCreator` / detail 页「发送到创作」（`js/core/itemCache.js:36-38`、`js/pages/detail.js:140`）。
- **当前断点**：

| # | 断点 | 事实依据 | 后果 |
|---|---|---|---|
| 1 | 等待期是「假进度」：把三个输出框写死为「正在生成标题…/正在生成前言…/正在调用 LLM 重构内容…」 | `js/pages/creator.js:301-303` | 90s 内用户无法判断「在跑」还是「卡死」 |
| 2 | **失败即清稿**：`catch` 里把三个框清空 | `js/pages/creator.js:321-325` | 上一版可用成稿不可恢复（且生成前就已被占位文案覆盖，`:301-303`） |
| 3 | 前端全程无流：全仓库无面向浏览器的 `res.write` / `text/event-stream` 响应 | 唯一命中是 `lib/llm.js:292`（服务端**解析上游** SSE） | Phase 1 的流式聚合只降低了服务端超时风险，用户端仍是黑箱 |
| 4 | 主页面的 LLM 调用没有审计记录 | `logAction(` 全仓库 11 处，`lib/rewrite.js` 只有 `rewrite-hotspots`（`:19,64,100`）；`/api/_/rewrite` 主链路与 `mp-format/ai-layout` 均无 | `action_logs` 审计日志看不到最贵的那次调用 → 事后无法归因「这天为什么烧了这么多」 |
| 5 | `doRewrite` 未传 `abortKey`，切页不中断 | `js/pages/creator.js:306-316` 无 `abortKey`；对比 `js/pages/format.js:429` 有 `abortKey:'format-ai'` | 用户放弃离开页面后，token 继续消耗 |

### S5 排版 → 发布（链路唯一没闭环的一步）

- **用户目标**：成稿一键变成「能粘进公众号后台不丢样式」的 HTML，少一次手工搬运。
- **当前实现落点**：`index.html`（tpl-format，三栏：编辑/手机框预览/模板+微调）→ `js/pages/format.js:406`（AI 一键排版）、`:651`（复制排版）、`:581`（渲染管线）；内核 `js/core/wechat-format/{engine,render,templates}.js` + `js/core/markdown-guard.js`；唯一后端接口 `POST /api/_/mp-format/ai-layout`（`lib/routes/mp-format.js:51-83`，输入上限 15000 字符，错误文案分型 `:38-46`，导出面 `:88`）。
- **已交付且必须回归保护的部分**：marked 爆栈护栏——dataURL 抽占位符、畸形图片修复、定界符折叠、嵌套封顶、`renderArticleSafe` 纯文本降级（`js/pages/format.js:578-611`；测试 `test/markdown-guard.test.js` 8 例 + `test/wechat-format-kernel.test.js` 15 例 + `test/frontend-utils-render.test.js` 4 例）。
- **当前断点**：

| # | 断点 | 事实依据 |
|---|---|---|
| 1 | **发布未闭环**：产物只能「复制排版」再手工粘贴；方案 PR-3「同步草稿箱」未实现——`lib/routes/mp-format.js` 只有 `ai-layout`；`lib/mp-publisher.js` 不存在；`lib/wechat-official.js:174` 只导出 `{ make, dateStr }`，未暴露 `getMpConfig/getAccessToken` | `lib/routes/mp-format.js:88`；`docs/wechat-formatter-integration.md:179`（要求的前置重构未做） |
| 2 | **从创作流进排版无入口**：creator 模板无「排版预览」按钮；`state.formatDraft` 全仓库 0 命中 | `docs/wechat-formatter-integration.md:147`（PR-4 未做） |
| 3 | 草稿只在浏览器本地：`LS.set('wf:markdown', …)` | `js/pages/format.js`；服务端无排版草稿（可用于承载的 `local_data` 表与 `lib/local-data.js:27` 助手已存在，`lib/db.js:355-363`） |
| 4 | 合规件缺失：`THIRD_PARTY_NOTICES.md` 不存在 | `docs/wechat-formatter-integration.md:77,257` 列为必做；全仓库仅该文档提及 |

### S6 数据追踪与文章诊断

- **用户目标**：知道哪篇该复制、哪篇该放弃，且判据是「我自己账号的基线」。
- **当前实现落点**：dashboard「账号概览」行按钮 `analyzeMyWorks` / `syncMpOfficial` / `fetchMpStats`（`js/pages/dashboard.js:272-279`）→ `POST /api/_/my-accounts/:id/analyze-works`（`lib/routes/accounts.js:53`）、`/sync-mp-official`（`:65`）；tracker 页同步/诊断/趋势（`js/pages/tracker.js:418, 511, 545, 654`）→ `lib/routes/trackers.js:24`；判定内核 `lib/article-analysis.js`（48h 成熟门槛 `:14-15`、账号基线 `:90-115`）；时间序列 `lib/work-stats.js:23-46`；官方数据 `lib/wechat-official.js:97`（T+1 权威阅读数）；插件采集 `extension/mp-stats` → `POST /api/_/ingest/mp-stats`（`lib/routes/ingest.js:14`，唯一 token 鉴权公开接口）。
- **当前断点**：
  1. **「没涨」与「没同步」在曲线上不可区分**：`recordWorkStats` 对与上一个点完全相同的指标直接跳过（`lib/work-stats.js:41`），且不记录「同步发生过」 → 平坦曲线无法解释（需人工看日志）。
  2. **被跳过的篇目不上屏**：未满 48h 的作品返回在 `observing`（`lib/article-analysis.js:290, 395`），但 UI 只给 toast；用户不知道「我昨天那篇为什么没被点评」。
  3. 同步/诊断都是单次长请求 + toast（`js/pages/tracker.js:421-441, 545+`），无进度、无队列、失败无重试；唯一的「作业化」范式是公众号白名单任务（`lib/routes/mp-whitelist.js:31` 的 job 轮询 + `js/pages/dashboard.js:533-560`）——**仓库里已有可复用的正确做法**。

### S7 周复盘行动项

- **用户目标**：把「上周做错了什么」变成「这周做哪几件事」，并能勾掉。
- **当前实现落点**：`lib/dashboard-overview.js:214`（`generateSummary`）→ 落 `weekly_actions`（`:289-296`）；`GET/POST /api/_/dashboard/summary`、`POST /api/_/dashboard/actions/:id`（`lib/routes/dashboard.js:17-38`）；前端勾选 `setActionStatus`（`js/pages/dashboard.js:75-79, 134`）。
- **当前断点**：
  1. `weekly_actions` 只有 `week/text/status`，**无任何指向账号或文章的关联列**（`lib/db.js:127-135`）→ 行动项只能「勾掉」，不能「跳过去改」。
  2. 行动项无分类/无优先级（同上列结构），LLM 一次给 2-4 条（`lib/dashboard-overview.js:276, 285`），用户无法按「今天能不能做」排序。
  3. **需确认**：`generateSummary` 的 prompt 是否把 `buildOverview()` 的问题分布作为可核对证据显式列出（`lib/dashboard-overview.js:214-296` 仅局部读过），若未列出，则「总结的可信度」无法自查。

---

## 3. 第一版范围（V1）

**V1 主题（【建议】）**：把「日更闭环里最贵的三次等待 + 一次手工搬运」变成**可见、可中断、可追溯、不丢内容**。不新增任何需要新账号、新平台接口、新存储引擎的能力。

### 3.1 P0（5 项，本轮必做）

#### P0-1 LLM 等待期可信化：统一等待态 + 可取消 + 失败不清稿

| 项 | 内容 |
|---|---|
| 对应场景 | S2、S3、S4（S5/S6 复用同一组件） |
| 改动落点 | `js/components.js`（新增统一「生成中」组件：阶段文案 + 计时 + 取消）；`js/pages/creator.js:292-330`（取消按钮、失败保留上一版、补 `abortKey`）；`js/pages/inspiration.js:367-405`（同款等待态 + 防重入）；`js/pages/format.js:406-443`（已有 `abortKey`，补计时/取消）；`js/api.js`（`localApi` 支持外部取消与超时提示文案） |
| 工作量 | **M** |
| 依赖 | 无（纯前端；`lib/llm.js` 的并发闸/重试已交付，无需改后端） |
| 为什么进 V1 | 已确认问题 1 的服务端成因已修，但用户体感的「只消耗 token 不返回文章」**残留在前端**：假进度（`creator.js:301-303`）、失败清稿（`:321-325`）、无取消（无 `abortKey`）。这是全链路唯一的通用等待体验，一次修好四个页面 |

#### P0-2 灵感页防重入 + 生成结果/失败分型

| 项 | 内容 |
|---|---|
| 对应场景 | S3 |
| 改动落点 | `js/pages/inspiration.js:367-405`（in-flight 标志 + 按钮禁用，照抄 `creator.js:290-300` 模式）；`lib/routes/inspiration.js:124-134`（按 `sha1(stableObject(body))` 做 5s single-flight，照抄 `lib/routes/misc.js:14-21,162-176`）；失败路径补 `sourceLabels` 分型渲染（`js/pages/inspiration.js:376-386` 的逻辑挪到 try/catch 两侧共用） |
| 工作量 | **S** |
| 依赖 | P0-1 的取消/等待组件（可并行） |
| 为什么进 V1 | 同一类缺陷在 creator 已修而灵感页未修，且灵感页是**链路起点**：起点重复触发会同时烧 RedFox 预算（`daily_api_budget`，`lib/db.js:215`）与 LLM |

#### P0-3 趋势卡可信化：窗口生效 + 重分析幂等 + 批次完整度上屏

| 项 | 内容 |
|---|---|
| 对应场景 | S2 |
| 改动落点 | `lib/routes/hot.js:23-27`（把 `days` 透传给分析入口）；`lib/hot.js:713-716`（`analyzeHotTrendsLlm(days)`，返回体带 `analyzedDays`；注意 `getHotTrends` 只接受 7/14，`lib/hot.js:633`）；`lib/hot.js:556`（手动重分析区分「强制重跑」与「复用」，默认复用）；`js/pages/hotlist.js:309-340`（趋势卡显示「数据截至 / 生成时间 / 批次完整度 N/M / 实际窗口天数」，复用 `js/pages/hotlist.js:53-69` 的元信息条范式） |
| 工作量 | **M** |
| 依赖 | 无（服务端能力已交付，本轮是口径与展示一致性） |
| 为什么进 V1 | 已确认问题 2 修的是「能不能显示」，没修「显示得可不可信」：窗口控件无效、force 每次都烧 4 批 LLM、批次失败静默（`lib/hot.js:619` 无读取方）。趋势是选题的输入，输入不可信则闭环质量无从谈起 |

#### P0-4 排版入口闭环：创作 → 排版直达 + 服务端草稿 + 复制前自检

| 项 | 内容 |
|---|---|
| 对应场景 | S5（上游 S4） |
| 改动落点 | creator 头部加「排版预览」按钮 + `js/pages/creator.js` 写入 `state.formatDraft`；`js/pages/format.js` 进入时优先读 `formatDraft`；`js/state.js`（新增 `formatDraft`）；草稿落服务端 `local_data`（`lib/db.js:355-363` + `lib/local-data.js:27` 的 `getLocalData/setLocalData`，module=`format-draft`，**不改表结构**）+ 新增 `GET/PUT /api/_/mp-format/draft`（`lib/routes/mp-format.js`）；`js/pages/format.js:651-675`（复制前自检：降级状态、超长、图片数量提示） |
| 工作量 | **M** |
| 依赖 | 无（`lib/routes/mp-format.js` 已在 `server.js` 接线，只需加分支）；**不依赖** MP 凭证 |
| 为什么进 V1 | 方案 PR-4 与 PR-3 里**不需要公众号凭证**的那部分，是投入产出比最高的一段：它消灭「复制成稿 → 切页 → 粘贴」的手工搬运与 localStorage 丢失风险，且不引入新风险面 |

#### P0-5 预算与杠杆可视化：用量上屏 + 稳定性键进设置页

| 项 | 内容 |
|---|---|
| 对应场景 | 全链路（成本可控性） |
| 改动落点 | `lib/env.js:8-14`（`EDITABLE_ENV_KEYS` 增加 `LLM_MAX_TOKENS / LLM_MAX_CONCURRENCY / LLM_QUEUE_TIMEOUT_MS / LLM_FIRST_TOKEN_TIMEOUT_MS / LLM_IDLE_TIMEOUT_MS / LLM_TOTAL_TIMEOUT_MS / LLM_RETRIES / LLM_DAILY_CALL_LIMIT / REDFOX_DAILY_CALL_LIMIT / INGEST_TOKEN`）；`js/pages/settings.js`（「API 额度与用量」卡片补当日 requests/calls/cache_hits/errors + LLM 并发/排队 + 今日 LLM 调用数）；补 `logAction` 到 `/api/_/rewrite` 主链路与 `mp-format/ai-layout`（`lib/rewrite.js`、`lib/routes/mp-format.js`） |
| 工作量 | **S/M** |
| 依赖 | 无（`usageSummary()` 与 `/api/_/stats` 的 `llm` 块已存在：`lib/observability.js:33`、`lib/routes/misc.js:38-57`；`GET /api/_/quota` 在 `lib/routes/misc.js:64-73`） |
| 为什么进 V1 | 全部稳定性/预算开关目前**只存在于 `.env.example` 的注释里**，设置页改不到（`lib/env.js:8-14` 白名单不含它们）；且两个每日预算默认 0=不限制（`lib/llm.js:162-175`、`lib/redfox.js:158-177`）＝已交付的熔断默认关闭。同时最贵的 `rewrite` 调用没有 `action_logs` 记录，成本归因是空的 |

### 3.2 P1（本轮尽量做，可延到下轮）

| # | 项 | 场景 | 改动落点 | 工作量 | 依赖 | 为什么是 P1 而非 P0 |
|---|---|---|---|---|---|---|
| P1-1 | **服务端流式透传到前端（SSE）**：把已聚合的增量推给浏览器，先做 `/api/_/rewrite/stream` | S4 | 新增流式路由（`lib/routes/misc.js`）+ `lib/rewrite.js` 暴露 `onDelta` + `js/api.js` 加流式读取 + `js/pages/creator.js` 增量渲染 | **L** | P0-1（等待态骨架先立，避免两套 UI 逻辑） | 价值最高但改动最大（触及路由层与前端 IO 模型）；P0-1 已能消除「黑箱」的大部分负面体感 |
| P1-2 | **长任务作业化**：热点全量刷新、账号同步、诊断改为「提交即返回 jobId + 进度轮询」 | S1、S6 | 复用 `lib/routes/mp-whitelist.js:31` 的 job 模式与 `js/pages/dashboard.js:533-560` 的 UI 模式；`hot_batches.status/error/item_count` 已具备逐平台记录能力（`lib/db.js:152-165`） | **M** | 无 | 不改也能用（toast + 元信息条），属体验升级；但它是「失败原因可见」的唯一根治路径 |
| P1-3 | **公众号草稿箱同步**（方案 PR-3） | S5 | `lib/wechat-official.js:174` 导出 `getMpConfig/getAccessToken/mpError`（纯导出层变更）+ 新增 `lib/mp-publisher.js`（图片转存 + 封面上传 + `draft/add`）+ `lib/routes/mp-format.js` 加 `sync-draft` / `config` / `ip-diagnostic` 三个分支 | **L** | `MP_APP_ID/MP_APP_SECRET` + 认证号 + IP 白名单 | 可用性强依赖用户账号形态（需认证号），且 1MB 图限制无 sharp；P0-4 已把「素材进排版」的成本降到最低 |
| P1-4 | **作品数据可信度**：区分「没涨」与「没同步」；诊断把 `observing` 篇数上屏 | S6 | `lib/work-stats.js:23-46`（无变化也落一条同步事件）+ `lib/db.js`（`ensureColumn` 加标记列，遵循 `AGENTS.md` 加列约定）+ `js/pages/tracker.js`/`dashboard.js` 展示 | **S** | 无 | 影响「看数据」的信任度，但不阻塞日更生产 |
| P1-5 | **周行动项关联化**：`weekly_actions` 加 `account_id/work_id` + 点击跳转 | S7 | `lib/db.js:127-135` + `ensureColumn`；`lib/dashboard-overview.js:214-296`（让 LLM 输出带账号/文章锚点）；`js/pages/dashboard.js:75-79`（跳转） | **S** | P1-4（锚点数据先可信） | 周频而非日频，ROI 靠后 |

---

## 4. 暂缓事项

> 每条包含：**为什么暂缓**（仓库事实）+ **可观察的启动信号**（不问用户感受，能被查询/计数触发）。

| # | 暂缓项 | 为什么暂缓（仓库事实） | 启动信号（可观察） |
|---|---|---|---|
| 1 | **多用户 / 权限体系** | `users` 表有 `role`（`lib/db.js:403`）但全部路由无角色校验（`lib/routes/auth.js` 只有会话校验）；`sessions` 无 workspace 维度；「我的账号」语义是「我运营的号」，不是成员；`AGENTS.md` 明确「单用户、自托管」。改造要动鉴权地基与全表主键语义 | 满足**任一**：① `SELECT COUNT(*) FROM users` ≥ 2 且 `SELECT COUNT(DISTINCT user_id) FROM sessions` ≥ 2（同一实例被两人真实共用）；② 出现「把某个 `my_accounts` 只给某人看」的明确需求。两者都没有时不动 |
| 2 | **云托管与账号体系（SaaS 化）** | 密钥模型是「用户自带 key」（`REDFOX_API_KEY` 必填，`.env.example:2-43`）；无注册/找回（`lib/routes/auth.js:18-88`）；`data/` 是本地单目录（`lib/db.js:7-14`）；Docker 单容器假设 | 满足**任一**：① 需要「不开 VPN 也能远程访问」的请求出现 ≥2 次；② 出现愿意为「免配置 key」付费的第三方（届时与第 5 条合流评估） |
| 3 | **移动端** | 已有响应式雏形（`js/navigation.js:45-51` 的 `mobile-sidebar-open/close`），但排版工作台是「编辑区 + 手机框预览 + 设置区」三栏，手机上不可编辑；且**当前无任何访问来源/设备埋点**，无法判断需求真伪 | 先补 UA 维度的最小埋点；此后 30 天移动端会话占比 ≥30%，或出现 ≥3 次明确的移动端诉求。**在此之前不投入** |
| 4 | **第三方平台自动发布** | 唯一写能力是本地 MCP 的小红书发布（`lib/routes/xhs-mcp.js:107-119`，依赖用户自建容器 + 登录态）；公众号侧只有读（`lib/wechat-official.js:97`），连草稿箱写入都还没有（`lib/mp-publisher.js` 不存在） | P1-3（草稿箱同步）上线后 30 天内，使用过「同步草稿」的用户中 ≥50% 主动要求「连发布也自动」；或出现平台官方写接口可申请。**顺序上必须先做 P1-3** |
| 5 | **商业化 / 计费** | 无计费字段与支付链路；且排版内核移植自上游 `wechat-formatter`（AGPL-3.0 + README 附加「未经书面授权禁止商用」条款），`docs/wechat-formatter-integration.md:74-78` 与风险表 `:273` 已明确：**商业化前需替换实现或取得书面授权**；`THIRD_PARTY_NOTICES.md` 也尚未创建 | 出现付费询价，**且**已完成「替换排版实现或取得上游书面授权」这一前置条件。在授权未落地前，商业化讨论不进入范围 |
| 6 | **向量检索 / 知识库重构** | 现在是三源适配（`kb_obsidian.js`/`kb_notion.js`/`kb_wersss.js`）+ `kb_entries_cache` 全量扫描缓存（`lib/db.js:287-302`），无 embedding 依赖、无向量库；条目规模小时扫描成本可接受 | ① `SELECT COUNT(*) FROM kb_entries_cache` 超过实测阈值（建议由一次全量扫描耗时确定，例如 >5s）；② 「知识库匹配不准」的返工率上升——可用代理指标：`kb/entries/link` 之后用户手动改绑的次数（当前无埋点，**需先补埋点再谈重构**） |
| 7 | **继续扩热点源 / 新平台适配** | 已有 17 组 `buildRequest` 配置覆盖 11+ 源（`lib/hot.js:23-167`），且 `GET /api/_/hot/platforms` 只暴露已启用 cron 的平台（`lib/routes/hot.js:67-83`）——问题在「启用率」，不在「源不够」 | 现有源连续 30 天出现 ≥20% 的平台级空数据（`SELECT platform, status, COUNT(*) FROM hot_batches WHERE data_date >= ? GROUP BY platform, status` 可查），或某个源 API 停服。**加源之前先看启用率** |

---

## 5. 核心能力的可观察验收标准

**北极星**：单人自媒体的**日更效率与产出质量**。

- 效率代理指标（【建议】：均需 P0-5 的埋点补齐后才能算）：`action_logs.created_at` 中 `generate-inspirations` → 成稿导出/复制的时间差（当前 `rewrite` 无审计记录，**现状不可度量**，这正是 P0-5 要补的）。
- 质量代理指标（已存在）：`article_analysis` 中 `hot` 占比（`lib/article-analysis.js`）、`work_stats_history` 的 24h 增速 vs 账号中位数（`lib/work-stats.js:59-87`）、`weekly_actions.status='done'` 比率（`lib/db.js:127-135`）。

**通用判定约定**

- SQL 一律针对 `data/cache.db`（`lib/db.js:12-14`），可用 `sqlite3 data/cache.db "<SQL>"`；`<today>` 指 `USER_TIMEZONE`（默认 `Asia/Shanghai`）当日的 00:00 毫秒时间戳。
- 每条均给「通过阈值」与「失败判定」；**失败判定成立即视为回归阻塞发布**。
- 门禁命令：`npm run check` + `npm test`（`package.json`）+ 改了 Tailwind class 必须 `npm run build`（`AGENTS.md`）。
- 测试基线（现有用例数，本轮不得减少；计数方式：各 `test/*.test.js` 中 `^test(` 静态计数，**全仓库合计 167 例**）：
  `routes 26 / utils 16 / wechat-format-kernel 15 / article-analysis 13 / cron 11 / auth 10 / dashboard-overview 9 / normalize 9 / redfox 9 / llm-stream 8 / markdown-guard 8 / mp-format.routes 7 / security-hardening 6 / wechat-official 6 / frontend-utils-render 4 / work-stats 4 / ingest 3 / mp-whitelist 3`。

### A. P0-1 LLM 等待期可信化

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| A1 | `#doRewriteBtn` / `#rewriteResult`（`js/pages/creator.js:292-330`） | UI 路径：点「开始创作」；同时开 Network 面板计并发 `POST /api/_/rewrite` | 0-2s 内出现计时/阶段文案，按钮 `disabled`；等待期重复点击始终**只有 1 个**在飞请求 | 等待期无任何进度元素，或出现 ≥2 个并发 POST → 失败 |
| A2 | single-flight 复用（`lib/routes/misc.js:162-176`） | 复用 `test/_server.js` 的 `boot()/req()`，断言同 body 的第 2 次 POST 返回 `data.deduplicated === true` | 断言通过 | 返回 2 份独立结果 → 失败 |
| A3 | 失败不清稿 | 先成功生成一版；再把 `LLM_API_KEY` 置空（或 mock 502）后重试 | `#rewriteResult.value` **等于上一版全文** | 内容被清空或变成占位文案 → 失败（当前行为即失败，`creator.js:321-325`） |
| A4 | 取消即停（`llm_usage` 表） | 等待期点取消，记录 T；随后 `SELECT COUNT(*) FROM llm_usage WHERE created_at >= T` | 取消后 30s 内新增 ≤1 行（允许已发出的那一次）；按钮 1s 内恢复可用 | 取消后仍持续新增行，或按钮不可恢复 → 失败 |

### B. P0-2 灵感防重入与分型

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| B1 | `action_logs`（`action='generate-inspirations'`，`lib/routes/inspiration.js:127`） | 5 分钟内连点 3 次「生成选题」，`SELECT COUNT(*) FROM action_logs WHERE action='generate-inspirations' AND created_at >= ?` | 新增 **1** 行 | ≥2 行 → 失败 |
| B2 | 三类结果文案（`#inspiration-status` / `#inspiration-engine`） | 分别构造：正常 / `daily_api_budget=0`（`lib/db.js:215`）/ 清空 `LLM_API_KEY` | 3 种情况显示 3 种不同文案（成功含「预算跳过」或「API 失败」字样） | 全部显示「生成失败」或只有 toast → 失败 |
| B3 | 结果可追溯（`action_logs.detail_json`） | `SELECT detail_json, api_calls, llm_calls FROM action_logs WHERE action='generate-inspirations' ORDER BY created_at DESC LIMIT 1` | 含 `keywords` 与 `searches` 数组，且 `api_calls`/`llm_calls` 非空 | 字段缺失或为 0 而实际有消耗 → 失败 |

### C. P0-3 趋势卡可信化

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| C1 | 分析窗口生效（`POST /api/_/hot/trends/analyze?days=7`，当前被丢弃：`js/pages/hotlist.js:349` → `lib/routes/hot.js:23-27` → `lib/hot.js:713-716`） | 同一库先后 POST `?days=7` 与 `?days=14`，读响应体中的实际窗口字段与 `hot_daily_keywords` 选中的 `data_date` 区间 | 7 天请求实际只读取近 7 天报告，响应体显式携带实际窗口（如 `analyzedDays`/`analyzedDate`），且 `getHotTrends` 仍只接受 7/14（`lib/hot.js:633`） | 两个窗口产出**完全相同**且响应体无窗口字段 → 失败（当前即失败） |
| C2 | 重分析幂等（`llm_usage` + `hot_daily_keywords.generated_at`） | `source_fingerprint` 未变时，同一天点两次「重新分析」，查两次之间新增的 `llm_usage` 行数 | 第 2 次新增 **0** 行；且 `generated_at` 不变 | 第 2 次新增 4 行（4 批全量重跑，`lib/hot.js:565,714`）→ 失败 |
| C3 | 批次完整度上屏（`hot_daily_keywords.result_json.batchStats`，写入 `lib/hot.js:619`） | 构造 1 批失败（mock 该批 400/审核拒绝），打开热榜趋势区 | 趋势卡显示「批次 N/M 失败」类提示，且与 `SELECT json_extract(result_json,'$.batchStats.failed') FROM hot_daily_keywords ORDER BY data_date DESC LIMIT 1` 一致 | 页面无任何提示（`batchStats` 无人读取）→ 失败 |
| C4 | 空态与新库冷启动（`js/pages/hotlist.js:288-302, 351`） | 参照 `test/_helper.js` 把 `DATA_DIR` 指向空目录启动，进热榜页；当天 realtime 批次 ≥10 条后点分析 | 空态显示原因 + 「AI 深度分析趋势」按钮；点击 **1 次** 成功并 toast 实际分析日期 | 按钮缺失，或仅报「昨天不足」→ 失败 |

### D. P0-4 排版入口闭环

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| D1 | creator → format 直达（新增 `state.formatDraft`） | 在 AI 创作页生成成稿 → 点「排版预览」→ 读 `#formatEditor.value` | 1 次点击，内容与成稿（标题+前言+正文按约定拼接）**逐字节一致** | 需手工复制粘贴，或内容错位/丢段 → 失败 |
| D2 | 服务端草稿（`local_data`，`lib/db.js:355-363` + `lib/local-data.js:27`） | 在排版页编辑 → 清浏览器 localStorage → 重进排版页 | 内容完整恢复；`SELECT data_json FROM local_data WHERE module='format-draft'` 有落库 | 仍依赖 `LS.set('wf:markdown')` → 失败 |
| D3 | 复制前自检与降级 | 输入含 dataURL 大图与畸形图片的 Markdown（复用 `test/markdown-guard.test.js` 的用例构造） | 预览显示降级提示条（`format.js:604-607`）而非红字异常；产物含内联 `style` 且不含 `<script>` | 出现「渲染失败：Maximum call stack size exceeded」类红字 → 失败（已修，属回归） |
| D4 | 回归门禁 | `node test/wechat-format-kernel.test.js test/markdown-guard.test.js test/frontend-utils-render.test.js`（本环境用 in-process 运行；已装依赖时可用 `node --test`） | 27 例全绿；`npm run check`；`npm run build` 后 `css/tailwind.css` 含新增 class | 任一失败 → 失败 |

### E. P0-5 预算与杠杆可视化

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| E1 | 设置页「API 额度与用量」+ `GET /api/_/quota`（`lib/routes/misc.js:64-73`、`lib/observability.js:33`） | 页面数值 vs `SELECT COUNT(*) r, SUM(cached=0) c, SUM(cached=1) h, SUM(status_code>=400) e FROM api_usage WHERE created_at >= <today>` | 4 个数字（requests/calls/cache_hits/errors）与 SQL **完全一致** | 缺字段或与 SQL 不一致 → 失败 |
| E2 | 并发/排队可见（`GET /api/_/stats` 的 `llm` 块，`lib/routes/misc.js:38-57`） | 同时发起 3 个创作（`LLM_MAX_CONCURRENCY` 默认 2，`lib/llm.js:178`），期间轮询 `/api/_/stats` | 观察到 `llm.live.active ≤ 2` 且 `queued ≥ 1`；`llm.todayCalls` 与 `SELECT COUNT(*) FROM llm_usage WHERE created_at >= <today>` 一致 | 返回 `null` 或 `active` 超过上限 → 失败 |
| E3 | 预算/稳定性键可配（`lib/env.js:8-14`，`GET/PUT /api/_/env`） | 设置页保存 `LLM_RETRIES / LLM_MAX_CONCURRENCY / LLM_DAILY_CALL_LIMIT / REDFOX_DAILY_CALL_LIMIT`，再读 `GET /api/_/env` | 4 个键 `configured:true` 且非敏感值可读；`.env` 文件被写入 | 仍只能改 `.env.example`（当前即失败） |
| E4 | 熔断可验证（`lib/llm.js:162-175`） | 设 `LLM_DAILY_CALL_LIMIT=1`，连续触发 2 次生成 | 第 2 次快速失败且文案为「今日 LLM 调用已达上限（…）」（`lib/llm.js:171`）；`llm_usage` 不新增行 | 出现裸 429/超时，或仍产生真实调用 → 失败 |
| E5 | 成本归因覆盖（`action_logs`） | 触发一次 `/api/_/rewrite` 与一次 `mp-format/ai-layout` | `action_logs` 各新增 1 行，`llm_calls ≥ 1` | 无记录（当前即失败，`lib/rewrite.js` 只记录 `rewrite-hotspots`）→ 失败 |

### F. P1-1 流式透传（SSE）

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| F1 | 新流式端点首字节时间（Network 面板 TTFB） | 10 次创作取分布 | ≥90% 的请求 TTFB ≤ 30s（对齐 `LLM_FIRST_TOKEN_TIMEOUT_MS=90000`） | 与改造前（一次整包 JSON，TTFB≈总耗时）无差别 → 失败 |
| F2 | 增量可见（`#rewriteResult`） | 生成过程中每秒记录一次文本长度 | 长度**单调增长 ≥5 次** | 只出现一次最终文本 → 失败 |
| F3 | 中断即停 | 生成中点取消，观察 10s 内 `llm_usage` 与 `server.js` 日志 | 无新增 `llm_usage` 行；日志无未捕获异常 | 新增行或出现未捕获异常 → 失败 |
| F4 | 回归 | `node --test test/llm-stream.test.js test/routes.test.js` | 8 + 26 例全绿 | 任一失败 → 失败 |

### G. P1-2 长任务作业化

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| G1 | 热点全量刷新（现为阻塞式 `lib/routes/hot.js:35-39`） | 点「刷新热点」，统计最长的单个 HTTP 请求时长 | 无任何请求超过 30s（提交即返回 jobId，进度靠轮询） | 单请求仍等待 60s+ → 失败 |
| G2 | 平台级失败可见（`hot_batches`，`lib/db.js:152-165`） | `SELECT platform, status, item_count, error FROM hot_batches WHERE data_date = ? ORDER BY started_at DESC` 与页面展示比对 | 页面展示的失败平台与 error 摘要与该查询一致 | 只有一条笼统 toast → 失败 |

### H. P1-3 草稿箱同步

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| H1 | 未配置引导 | `node --test test/mp-format.routes.test.js`（7 例，含「未配置 `MP_APP_ID` 时 `sync-draft` 400 且文案含引导」） | 400 + 引导文案；未登录 401 | 500 或无提示 → 失败 |
| H2 | 图片转存 | 同步成功后取草稿 `content`，统计 `<img src>` 域名 | **100%** 为 `mmbiz.qpic.cn`（方案 `docs/wechat-formatter-integration.md` 同口径） | 存在外链或 `data:` → 失败 |
| H3 | 安全 | `node --test test/security-hardening.test.js` + 新增用例：断言任一 `GET /api/_/mp-format/*` 响应体不含 `MP_APP_SECRET` 值 | 全绿；`config` 只返回脱敏 appId | 任一响应泄露 secret → 失败 |

### I. P1-4 作品数据可信度

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| I1 | 「没涨」vs「没同步」（`work_stats_history`，`lib/work-stats.js:23-46`） | 连续 2 天各同步一次不变数据的账号，`SELECT COUNT(*) FROM work_stats_history WHERE account_id=? AND captured_at BETWEEN ? AND ?` | ≥2 个点（每次同步都有事件记录），且能区分「值未变」 | 0 点且与「未同步」不可区分 → 失败（当前行为，`:41` 跳过相同点） |
| I2 | 观察中篇目上屏 | 对有未满 48h 新作的账号点「分析作品」（`lib/article-analysis.js:290, 395` 返回 `observing`） | 页面显示「N 篇发布未满 48 小时观察中」，N 与接口返回一致 | 不显示 → 失败 |
| I3 | 回归 | `node --test test/article-analysis.test.js test/work-stats.test.js test/dashboard-overview.test.js` | 13 + 4 + 9 例全绿 | 任一失败 → 失败 |

### J. P1-5 周行动项关联化

| # | 观测对象 | 判定方式 | 通过阈值 | 失败判定 |
|---|---|---|---|---|
| J1 | 关联字段（`weekly_actions` 新增列，`lib/db.js:127-135` + `ensureColumn`） | 生成一次总结后：`SELECT COUNT(*) FROM weekly_actions WHERE week=? AND account_id IS NULL` | 带账号语境的行动项 ≥80% 有 `account_id` | 全部为 NULL → 失败 |
| J2 | 可跳转 | UI 路径：dashboard 行动项 → 点击 | 1 次点击到达对应账号（tracker）或对应文章（detail） | 只能勾选完成，无跳转 → 失败 |
| J3 | 闭环不重复 | 完成一条行动项后重新生成总结（`lib/dashboard-overview.js:276` 要求「已完成的上周行动不要原样重复」） | 新一批行动项不含已完成条目原文 | 原文重复出现 → 失败 |

---

## 6. 事实抽验与修正记录

产品经理产出后，主理人对**承重事实**独立复核（不依赖专家的自述），逐条对齐仓库：

**通过复核的关键事实（抽样）**

| 事实 | 复核结果 |
|---|---|
| `doRewrite` 假进度 + 失败清稿 + 无 `abortKey` | ✅ `js/pages/creator.js:290-330`（防重入标志已存在于 `:290`，缺的是取消与失败保留） |
| `generateInspirations` 无防重入、失败只 toast | ✅ `js/pages/inspiration.js:367-405` |
| 分析接口丢弃 `?days=`、固定 14 天窗口 | ✅ `js/pages/hotlist.js:349` → `lib/routes/hot.js:23-27` → `lib/hot.js:713-716`；`getHotTrends` 仅接受 7/14（`lib/hot.js:633`） |
| 手动刷新为阻塞式全平台抓取 | ✅ `js/pages/hotlist.js:150-160`、`lib/routes/hot.js:35-39` |
| `hot/platforms` 只返回已启用 cron 的平台 | ✅ `lib/routes/hot.js:67-83` |
| 稳定性/预算键不在设置页白名单 | ✅ `lib/env.js:8-14`（含 `LLM_THINKING`/`LLM_FALLBACK_MODEL`，缺并发/超时/重试/预算键） |
| `lib/mp-publisher.js`、`THIRD_PARTY_NOTICES.md`、`state.formatDraft` 均不存在 | ✅ 全仓库仅 `docs/wechat-formatter-integration.md` 提及 |
| `lib/wechat-official.js:174` 只导出 `{ make, dateStr }` | ✅ 行号与内容一致 |
| `/api/_/rewrite` 主链路无 `logAction` | ✅ `logAction(` 全仓库 11 处，`lib/rewrite.js` 仅 `rewrite-hotspots` |
| `batchStats` 写入后无人读取 | ✅ 写入 `lib/hot.js:619`，全仓库无读取方 |
| `usageSummary` / `stats.llm` / `quota` 已存在 | ✅ `lib/observability.js:33`、`lib/routes/misc.js:38-57,64-73` |
| `LLM_MAX_CONCURRENCY` 默认 2、预算文案位置 | ✅ `lib/llm.js:178`、`lib/llm.js:171` |

**修正（2 处）**

1. **`test/routes.test.js` 用例数 27 → 26**：按 `^test(` 静态计数为 26；修正后各文件计数相加（140）+ 本会话新增的 3 个测试文件（15+8+4=27）= **167**，与全仓库实测总数一致，可交叉校验。
2. **C1 验收口径**：原表述比对 `GET /api/_/hot/trends?days=7` 与 `?days=14` 的报告数——但该 GET **确实**透传 `days`（`lib/routes/hot.js:15-16`，`lib/hot.js:633`），拿它当失败判据会误判。已改为针对**真正有缺陷的 `POST /trends/analyze` 路径**（窗口被丢弃、响应无窗口字段）。

**补充说明（1 处）**

- `js/pages/my.js`（被 `js/app.js:20` import）的渲染入口依赖 `#my-account-list` / `#my-empty` / `#my-sub`（`js/pages/my.js:12-15`），但 `index.html` **无 `tpl-my` 模板**、`js/navigation.js` 的 `PAGES` **无 `my` 键** → 该渲染入口当前不可达（`if (!list) return;`，`:15`）。属遗留代码，**未列入 V1**；若确有「我的账号」独立页需求，应作为独立小项评估（**需确认**）。

**未验证/保留不确定**

- 各「用例数」为静态计数，未执行（本环境无依赖）；`lib/dashboard-overview.js` 的运行期 prompt 全文只读了片段（§2 S7 断点 3 已标 **需确认**）。
- 移动端占比、知识库匹配返工率等阈值需先补埋点才可量化（§4 已写明「先补埋点」）。

---

## 事实来源清单

**关键文件（只读）**

| 文件 | 用途 |
|---|---|
| `README.md`、`AGENTS.md` | 功能全景；架构、模块划分、命令、测试策略、安全约定、加列约定 |
| `package.json` | npm scripts、devDependencies |
| `.env.example` | 全部可配置项与默认值（= 运营杠杆） |
| `index.html` | 11 个 `nav-item` 侧边栏入口 + 各页 `tpl-*` 模板与 `data-action` 清单 |
| `server.js` | 内置 cron 定义、`runCronTask`、`scheduleCronJob`、`handleLocalApi` 路由接线 |
| `lib/db.js` | 全部表结构与索引（= 现成数据埋点）；`ensureColumn` 加列机制 |
| `lib/observability.js` | `logAction` / `listActionLogs` / `usageSummary`（`:33`）/ `getOfficialQuota` |
| `lib/redfox.js` | 端点允许列表、`CACHE_TTL`、业务层缓存白名单、每日预算 |
| `lib/llm.js` | 并发信号量（`:103,178`）、`logLlmUsage`、`checkLlmBudget`（`:162-175`）、超时/重试/fallback/thinking |
| `lib/hot.js` | `HOT_SOURCE_CONFIG`、`analyzeDailyHotKeywords`（`:523-630`）、`getHotTrends`（`:632-711`）、`analyzeHotTrendsLlm`（`:713-717`） |
| `lib/article-analysis.js`、`lib/work-stats.js`、`lib/dashboard-overview.js` | 48h 门槛与账号基线；`work_stats_history` 写入语义；周闭环行动项 |
| `lib/wechat-official.js`、`lib/local-data.js`、`lib/env.js` | 公众号官方数据源与导出面（`:174`）；`local_data` 读写助手；`EDITABLE_ENV_KEYS` 白名单 |
| `lib/routes/*.js`（15 个文件） | `/api/_/*` 接口清单、single-flight、job 模式 |
| `js/app.js`、`js/navigation.js`、`js/api.js`、`js/config.js` | 模块聚合与动作注册表；`PAGES` 路由；`localApi`/`abortKey`；平台与 cron 常量 |
| `js/pages/creator.js`、`inspiration.js`、`hotlist.js`、`format.js`、`tracker.js`、`dashboard.js`、`my.js` | 各页在飞状态、进度 UI、失败处理、跨页传递 |
| `js/core/markdown-guard.js`、`js/core/wechat-format/{engine,render,templates}.js` | 爆栈护栏与排版内核 |
| `test/`（19 个文件） | 现成验收手段与测试引导（`_helper.js` / `_server.js`） |
| `docs/optimization-plan.md`、`docs/wechat-formatter-integration.md` | 已确认问题与完成状态；排版方案详细设计与风险表 |

**存在性实测**（区分「方案写了」与「仓库真有」）

- 存在：`js/core/wechat-format/*`、`js/pages/format.js`、`lib/routes/mp-format.js`（仅 `ai-layout`）、`lib/local-data.js`、`test/{markdown-guard,wechat-format-kernel,frontend-utils-render,mp-format.routes}.test.js`、`vendor/*`
- 不存在：`lib/mp-publisher.js`、`THIRD_PARTY_NOTICES.md`、`state.formatDraft`、`index.html` 的 `tpl-my` 与 `js/navigation.js` 的 `my` 路由键、面向浏览器的 SSE 响应实现