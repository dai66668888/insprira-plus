# 灵感熔炉 · V1 产品优化实施计划

> **本文定位**：把 `docs/product-plan-v1.md` 的产品结论落成**可直接开工的代码改动清单**——每个任务给出改动落点、分步勾选、验收判定、回归与回滚。
>
> **三份文档的分工**
>
> | 文档 | 回答的问题 | 状态 |
> |---|---|---|
> | `docs/product-plan-v1.md` | 做什么、为什么、验收标准怎么判定（A1~J3） | 已完成（产品定义，不在本文重复整表） |
> | `docs/optimization-plan.md` | 前置工程地基（LLM 调用层/缓存/趋势口径/预算熔断） | 已完成（Phase 1-5 全 `[x]`，**不要重做**） |
> | **本文** | **怎么做、按什么顺序、怎么验收、怎么回滚** | 待实施 |
>
> **状态标记**：`[ ]` 待做 / `[~]` 进行中 / `[x]` 已完成 / `[!]` 阻塞（阻塞原因写在任务末尾）
> **行号会漂移**：所有 `文件:行号` 基于当前工作树快照，定位时以**函数名 / 接口路径 / 表名**检索为准。
> **验收编号**：A1~J3 的定义在 `docs/product-plan-v1.md` §5，本文只写「怎么做 + 判定命令」，不复制整表。

---

## 0. 执行前置与全局约定

### 0.1 已具备的地基（复用，不要重写）

| 能力 | 位置 | 对本计划的用法 |
|---|---|---|
| 前端请求取消 | `js/api.js:6-14`（`cancelApi(key)` / `cancelAllApi()`）、`:96-101`（设 `abortKey` 会**先取消同 key 的上一请求**） | P0-1/P0-2 的「取消」直接用它；切页由 `js/navigation.js:67` 的 `cancelAllApi()` 兜底 |
| 请求去重范式 | `lib/routes/misc.js:16-21`（`sha1(stableObject)`）、`:162-176`（5s 窗口 + 复用 Promise + `.finally(delete)`） | P0-2 照抄 |
| KV 存储 | `lib/local-data.js:6-25`（`getLocalData/setLocalData(module, key, data, expiresAt)`）、表 `local_data`（`lib/db.js:355-363`） | P0-4 的服务端草稿，**不改表结构** |
| 用量埋点 | `lib/observability.js:33-53`（`usageSummary()` 已含 `requests/calls/cache_hits/errors` + `topEndpoints`）、表 `api_usage`/`llm_usage`/`action_logs` | P0-5 直接读，不要新造指标 |
| 运行时统计 | `GET /api/_/stats`（`lib/routes/misc.js:38-57`，含 `llm.live`/`llm.todayCalls`）、`GET /api/_/quota`（`:64-73`） | P0-5 的 LLM 区块接它 |
| env 读写 | `lib/env.js:47-86`（`publicEnvConfig` 脱敏、`updateEnvConfig` 写文件+同步 `process.env` 热加载、空值跳过）、路由在 `lib/routes/auth.js:164-172` | P0-5 只加键与校验，不改读写机制 |
| 长任务作业化范式 | `lib/routes/mp-whitelist.js:31`（job 轮询）+ `js/pages/dashboard.js:533-560`（UI） | P1-2 照抄 |
| 跨页传递范式 | `js/core/itemCache.js:27-43`（模块级缓存 + `registerItemCacheHandlers`）、`js/app.js:29-32` 注册、`js/pages/creator.js:131`（**目标页导出接收函数**） | P0-4 照这套，**不要**用 `state.formatDraft = …`（见 §8 修正 1） |
| 渲染降级护栏 | `js/core/markdown-guard.js` + `engine.renderArticleSafe`（本次已在 `/` 修复） | 排版相关改动必须保留 D3/D4 回归 |
| 推送截图/图片链路 | `js/pages/format.js:185`（占位符替换）、`:481` 附近（粘贴截图） | P0-4 不破坏 dataURL 占位符流程 |

### 0.2 硬约束

1. **不新增运行时依赖**（无 npm 包、无构建器）；后端 CommonJS、前端浏览器 ESM，不要混用。
2. **无构建前端**：改 `index.html` / `js/**` 的 Tailwind class 必须跑 `npm run build`；**优先复用已有 class 或内联样式**，减少 build 面。
3. **数据库**：加列一律 `ensureColumn`（`lib/db.js`），不改既有 `CREATE TABLE` 的破坏性语义；时间戳用毫秒整数。
4. **单用户、自托管**为前提，不引入账号/权限/多租户概念（见产品文档 §4 暂缓）。
5. 注释、日志、提交信息、文档**全部中文**；2 空格缩进、LF、UTF-8。
6. 前端渲染外部内容一律走 `esc()` / `renderMarkdown`，不裸拼 `innerHTML`。
7. **不加长任务阻塞主线程**：前端长任务必须可取消（`abortKey`），后端长任务走 0.1 的 single-flight 或 job 范式。

### 0.3 门禁与测试基线

| 门禁 | 命令 | 说明 |
|---|---|---|
| 语法 | `npm run check` | 后端 `server.js` 语法 |
| 全量测试 | `npm test` | `node --test`，当前 **167 例**（各 `test/*.test.js` 的 `^test(` 计数），**本轮不得减少** |
| 样式 | `npm run build` | 仅当新增/修改了 Tailwind class |
| 定向测试 | `node --test test/<file>.test.js` | 改哪个模块跑哪个 |

**本工作树的已知限制（如实记录）**：`node_modules` 未安装（`better-sqlite3` 缺失），且沙箱禁止 npm 默认缓存写入与 `node --test` 的 spawn 管道 → 依赖 `test/_helper.js` / `test/_server.js` 的用例（需要 DB 与监听端口）**只能在装了依赖的环境跑**；不依赖 DB 的用例（如 `test/markdown-guard.test.js`、`test/frontend-utils-render.test.js`）可用 `node test/<file>.test.js` 直接跑。
`test/wechat-format-kernel.test.js` 走 npm `marked`（无 `node_modules` 时报 `MODULE_NOT_FOUND`），可临时用 `NODE_PATH` 指向「导出 `Marked`/`Renderer` 的 vendor/marked.min.js 同版本 shim」离线运行（本环境已验证 **15/15**）；`test/security-hardening.test.js` 会 `spawn` 子进程，在本沙箱下必然 EPERM —— 属沙箱边界，不是用例失败。

### 0.4 每个任务的标准作业流程（SOP）

```
1. [ ] 读落点文件 + 确认行号（用函数名/接口名检索）
2. [ ] 按步骤卡逐条改（改动尽量收敛在落点表列出的文件）
3. [ ] 补测试（纯函数 → 直接单测；DB/路由 → test/_helper.js 或 test/_server.js 引导）
4. [ ] 跑定向测试 + 门禁（0.3）
5. [ ] 按验收编号做人工/命令验收，把结论写进 §7 进度看板
6. [ ] 勾选步骤卡；若失败，按任务内「回滚」处理并记 [!]
```

---

## 1. 实施顺序与批次

```
Batch 1  P0-1 统一等待态（纯前端，零依赖）        ← 先做：后续三个页面复用同一组件
   ├─► Batch 2  P0-2 灵感防重入 + single-flight （依赖 Batch 1 的等待态）
   ├─► Batch 3  P0-3 趋势卡可信化（口径/幂等/完整度）
   ├─► Batch 4  P0-4 创作→排版闭环 + 服务端草稿
   └─► Batch 5  P0-5 用量与杠杆上屏 + 成本归因   ← 与 2~4 无耦合，可并行
Batch 6  P1-1 SSE 流式（依赖 Batch 1）  →  P1-2 长任务作业化（独立）
       →  P1-3 草稿箱同步（依赖 MP 凭证）→ P1-4 数据可信度（独立）→ P1-5 行动项关联（依赖 P1-4）
```

| 批次 | 任务 | 可并行性 | 建议交付单位 |
|---|---|---|---|
| 1 | P0-1 | 起点 | 1 个 PR |
| 2 | P0-2、P0-5 | 互不依赖 | 2 个 PR（可同批提） |
| 3 | P0-3 | 独立 | 1 个 PR |
| 4 | P0-4 | 独立 | 1 个 PR |
| 5 | P1-1 | 依赖 Batch 1 | 1 个 PR（改动最大） |
| 6 | P1-2 / P1-4 | 互不依赖 | 各 1 个 PR |
| 7 | P1-3 | 依赖凭证与 P0-4 | 1 个 PR |
| 8 | P1-5 | 依赖 P1-4 | 1 个 PR |

> **里程碑**：Batch 1-5 全绿 = V1 达成（产品文档 §3.1 的 P0 五项）；Batch 6-8 为 P1，可分迭代。

---

## 2. P0 任务卡

### P0-1 统一等待态 + 可取消 + 失败不清稿　`[x]` 代码完成（A1/A3/A4 待人工验收）　工作量 M

**目标**：消灭「假进度」（写死文案）、「失败即清稿」、「切页不中断」三类体验缺陷，一次修好四个长任务页面。

**改动落点**

| 文件 | 位置 | 改什么 |
|---|---|---|
| `js/components.js` | 新增导出（对齐现有 `toast`/`skeleton`/`Modal` 风格，文件顶部 `import { esc } from './utils.js'` 已有） | 新增 `busyState(hostEl, { label, abortKey })`：插入「阶段文案 + 实时计时 + 取消按钮」，返回 `{ setStage(text), stop() }`；取消按钮内部调 `cancelApi(abortKey)`。**用内联样式或既有 class**，避免新增 Tailwind class |
| `js/api.js` | `localApi`（`:91-146`） | 不改签名；把 `AbortError` 语义显式化：导出 `isAbortError(e)`（`e?.name === 'AbortError'`），供页面区分「用户取消」与「真失败」 |
| `js/pages/creator.js` | `doRewrite`（`:292-330`） | ① 传 `abortKey:'creator-rewrite'`（`:306`）；② 删掉 `:301-303` 三行写死文案，改由 `busyState` 显示阶段；③ `catch`（`:321-325`）**不再清空** 三个输出框，仅 toast；`AbortError` → toast「已取消（上一版已保留）」；④ `busyState.stop()` 放 `finally` |
| `js/pages/inspiration.js` | `generateInspirations`（`:367-405`） | 同款：`abortKey:'inspiration-generate'`、等待态、失败保留上次结果（注意 `:403` 的「生成失败」文案改为更准确的分型，见 P0-2） |
| `js/pages/format.js` | `doAiLayout`（`AI 一键排版`，`:406-443`，已有 `abortKey:'format-ai'`） | 复用 `busyState` 补计时/取消 |
| `index.html` | creator / inspiration / format 模板 | **尽量不改**；若必须挂容器，优先复用现有块并在 `js` 内 `insertBefore` |

**实施步骤**

- [x] 1. `js/components.js` 加 `busyState`（状态点 + 阶段文案 + 实时计时 + 取消；内联样式 + 复用已编译 class）
- [x] 2. `formatElapsed` 抽到 `js/utils.js` 纯函数并补测试：新增 `test/frontend-utils.test.js`（3 例，见 §8.1-4）
- [x] 3. `js/api.js` 导出 `isAbortError`（取消 ≠ 失败）
- [x] 4. `js/pages/creator.js`：`abortKey:'creator-rewrite'` + `busyState` + 失败保留上一版 + 取消提示
- [x] 5. `js/pages/inspiration.js`：等待态 + `abortKey` + 失败分型（与 P0-2 的防重入在同一函数内一次改完）
- [x] 6. `js/pages/format.js`：复用 `busyState`，取消文案与失败文案区分
- [x] 7. 门禁：`node test/frontend-utils.test.js` 3/3、6 个改动文件 ESM 语法检查通过；未新增 Tailwind class → 无需 `npm run build`
- [ ] 8. 人工验收 A1 / A3 / A4（需浏览器 + 已装依赖环境；本环境无浏览器 provider、无 `node_modules`），结论待写入 §7

**验收**（编号见产品文档 §5-A）

- A1：点「开始创作」后 0-2s 出现计时/阶段文案、按钮 `disabled`；等待期连点 → Network 面板始终只有 **1 个** `POST /api/_/rewrite`。
- A3：成功生成一版 → 清空 `LLM_API_KEY` 重试 → 三个框**仍是上一版全文**（当前行为会全清空，属回归）。
- A4：取消后 30s 内 `SELECT COUNT(*) FROM llm_usage WHERE created_at >= <取消时刻>` ≤ 1；按钮 1s 内恢复可用。

**回归风险与回滚**

- 风险：结果框不再显示占位文案，若用户靠「框里有字」判断在跑 → 由 `busyState` 的可见计时替代，验收 A1 已覆盖。
- 风险：`AbortError` 未被识别会弹「网络错误: The user aborted a request」→ 步骤 3/4 必须先落地。
- 回滚：纯前端、无接口与数据变更，`git revert` 对应提交即可。

---

### P0-2 灵感页防重入 + single-flight + 失败分型　`[x]` 代码完成（B1-B3 待人工验收）　工作量 S

**目标**：链路起点不再重复烧 RedFox 预算与 LLM；「预算跳过」与「API 挂了」不再显示成同一句「生成失败」。

**改动落点**

| 文件 | 位置 | 改什么 |
|---|---|---|
| `js/pages/inspiration.js` | `generateInspirations`（`:367-405`） | ① 模块级 `inspirationInFlight` + 按钮禁用（对齐 `js/pages/creator.js:290-300`）；② 把 `:376-396` 的**分型文案构造**提到 `try` 之外（或抽成小函数），成功/失败/预算跳过三种路径都能渲染 |
| `lib/routes/inspiration.js` | `/api/_/inspirations/generate`（`:124-134`） | 加 single-flight：`Map` + `sha1(JSON.stringify(stableObject(data)))` + 5s 窗口（对齐 `lib/routes/misc.js:16-21,162-176`）；命中返回 `{ ok:true, data, deduplicated:true }` |
| `js/api.js` | 元数据透传白名单（`:141-144`） | **加 `'deduplicated'`**，否则前端拿不到去重标记（顶层字段会被 `localApi` 丢弃，只返回 `payload.data`） |
| `test/inspiration.routes.test.js`（**新增**） | 用 `test/_server.js` 引导 | 同 body 连发两次：第二次 `deduplicated === true`；LLM 只被调用一次（可对 `ctx.logAction` 记录或计数打桩） |

**实施步骤**

- [x] 1. 后端：抽出 `lib/single-flight.js`（可单测），`lib/routes/inspiration.js` 接上；`action_logs` 只在「真的跑了一次」时写
- [x] 2. 前端：`js/api.js` 白名单加 `deduplicated`；`js/pages/inspiration.js` 加 in-flight 标志 + 取消 + 失败分型 + 复用提示
- [x] 3. 新增 `test/single-flight.test.js`（6 例，纯函数、本环境可跑），见 §8.1-5
- [ ] 4. 人工验收 B2（三种文案）、B1（连点 3 次只 1 行 `action_logs`）—— 需 DB + LLM 环境
- [x] 5. `node --check lib/single-flight.js lib/routes/inspiration.js` 通过；`node test/single-flight.test.js` 6/6

**验收**（§5-B）

- B1：5 分钟内连点 3 次，`SELECT COUNT(*) FROM action_logs WHERE action='generate-inspirations' AND created_at >= ?` 只新增 **1** 行。
- B2：正常 / `daily_api_budget=0` / 清空 `LLM_API_KEY` 三种情况显示**三种不同文案**（含「预算跳过」「API 失败」字样）。
- B3：`action_logs.detail_json` 含 `keywords`/`searches`，`api_calls`/`llm_calls` 非空。

**回归风险与回滚**：去重窗口 5s 内相同请求会共享结果，若前端依赖「每次都是新结果」需注意（本身就是需求）；回滚 = 去掉 Map 分支 + 前端 in-flight。

---

### P0-3 趋势卡可信化：窗口生效 + 重分析幂等 + 批次完整度上屏　`[x]` 代码完成（C1-C3 待依赖环境实测）　工作量 M

**目标**：让「7 天 / 14 天」真的生效、连点「重新分析」不再重复烧 4 批 LLM、批次缺失可见。

**改动落点**

| 文件 | 位置 | 改什么 |
|---|---|---|
| `lib/routes/hot.js` | `/api/_/hot/trends/analyze`（`:23-27`） | 读 `url.searchParams.get('days')`，**校验 ∈ {7,14}**（与 `getHotTrends` 的 `safeDays` 对齐，`lib/hot.js:633`），body 里读可选 `force`（默认 `false`），一并传入 |
| `lib/hot.js` | `analyzeHotTrendsLlm`（`:713-717`） | 签名改 `analyzeHotTrendsLlm(days = 14, { force = false } = {})`；返回 `{ ...getHotTrends(days), analyzedDate, analyzedDays: days, batchStats }` |
| `lib/hot.js` | `analyzeDailyHotKeywords`（`:523-556`） | ① 新增 `windowDays` 形参，回溯候选用 `candidateAnalysisDates(windowDays)`（`:517-521`）；② **保留** `:555-556` 的缓存判据（`!force && fingerprint 相同 → 复用`），使幂等成立；③ `:619` 已写 `batchStats`，无需改写入 |
| `lib/hot.js` | `getHotTrends`（`:632-711`） | 返回值补 `batchStats`（从最新报告的 `result_json` 读取，`:634-643` 已有 `parseJson(row.result_json)`），供前端展示「批次 N/M 失败」 |
| `js/pages/hotlist.js` | `renderLlmTrends`（`:309-340`） | 趋势卡头部加元信息条（复用 `:53-69` / `:177-184` 的范式）：数据截至 / 生成时间 / 实际窗口 / 批次完整度；`:337`「重新分析」按钮改为**显式二次确认**后才传 `{ force: true }` |
| `js/pages/hotlist.js` | `analyzeTrends`（`:342-355`） | 已有 `?days=`（`:349`），无需改；成功后 toast 保留实际分析日期 |
| `test/hot-trends.test.js`（**新增**） | `test/_helper.js` 引导（`DATA_DIR` 指向临时目录） | 用例：① 同指纹二次调用 `analyzeDailyHotKeywords(..., false)` 不新增 `llm_usage`；② `windowDays=7` 时只读取近 7 天报告；③ `batchStats.failed > 0` 时 `getHotTrends` 能带出该字段 |

**实施步骤**

- [x] 1. 后端：`analyzeDailyHotKeywords(dataDate, force, windowDays)`（候选取 `candidateAnalysisDates(windowDays)`）、`analyzeHotTrendsLlm(days = 14, { force = false })`、`getHotTrends(days)` 补 `analyzedDays` + `batchStats`，三处共用 `lib/utils.js` 的 `normalizeTrendDays`
- [x] 2. 路由：`lib/routes/hot.js` 校验 `days ∈ {7,14}`、读 body 的 `force`（空 body/非 JSON 容错）；`GET /trends` 换用同一套归一化
- [x] 3. 前端：`js/pages/hotlist.js` 元信息条（实际窗口/数据截至/生成时间/批次完整度）+「重新分析」带 `data-force` 二次确认 + 防重入 + 复用 P0-1 的 `busyState`（计时/取消）；`js/app.js` 把 `dataset` 传给 `analyzeTrends`
- [x] 4. 新增 `test/hot-window.test.js`（3 例，纯函数、本环境可跑）与 `test/hot-trends.test.js`（3 例 DB 用例，需依赖环境）
- [ ] 5. 验收 C1/C2/C3/C4：C1 的窗口归一化已测（`hot-window` 3/3）；C1-C3 的落库口径需在依赖环境跑 `node --test test/hot-trends.test.js test/routes.test.js`；C4 需人工验收

**验收**（§5-C）

- C1：`POST /api/_/hot/trends/analyze?days=7` 与 `?days=14` 的**结果窗口不同**且响应体带 `analyzedDays`；`getHotTrends` 仍只接受 7/14。
- C2：同 `source_fingerprint` 下，同日第二次分析新增 `llm_usage` 行数 = **0**，`hot_daily_keywords.generated_at` 不变。
- C3：构造 1 批失败后，趋势卡显示「批次 N/M 失败」，与 `SELECT json_extract(result_json,'$.batchStats.failed') FROM hot_daily_keywords ORDER BY data_date DESC LIMIT 1` 一致。
- C4：空目录启动 + 当天 realtime 批次 ≥10 条 → 空态给原因与按钮，点 1 次成功。

**回归风险与回滚**

- 风险：把「重新分析」默认改为复用缓存后，用户可能觉得「点了没反应」→ 必须**显示缓存命中提示**（本任务步骤 3 已在元信息条上给出生成时间）。
- 风险：窗口参数影响 `getHotTrends` 读取范围，`candidateAnalysisDates` 回溯过深会拉长查询 → 上限锁死在 `days`。
- 回滚：后端三处改动独立，`git revert` 单个提交；数据表无变更。

---

### P0-4 创作 → 排版直达 + 服务端草稿 + 复制前自检　`[ ]`　工作量 M

**目标**：消灭「复制成稿 → 切页 → 粘贴」的手工搬运与 localStorage 丢失风险；**不依赖**公众号凭证。

**改动落点**

| 文件 | 位置 | 改什么 |
|---|---|---|
| `js/pages/format.js` | 模块顶部 + `renderFormat`（`:98` 载入 `LS.get('wf:markdown','')`） | ① 新增模块级 `pendingFormatDraft` 与导出函数 `sendToFormat({ title, markdown })`（**照 `js/pages/creator.js:131 sendToCreator(item)` 的既有范式**）；② 载入优先级：`pendingFormatDraft` → 服务端草稿 → `LS`；③ 有 `title` 时同步写入 `#formatTitle`（若存在，否则忽略） |
| `js/pages/creator.js` | 结果区（`#rewriteResult` 附近） | 调用 `sendToFormat({ title: #rewriteTitle.value, markdown: [#rewriteIntro.value, #rewriteResult.value].filter(Boolean).join('\n\n') })` + `gotoPage('format')`；**按钮入口**见下 |
| `js/app.js` | `registerAction` 区（对齐 `:273` `sendToCreatorByKey`） | 若走按钮驱动：`registerAction('sendDraftToFormat', () => sendDraftToFormat())` |
| `index.html` | creator 模板 | 加「排版预览」按钮；**复用已有 `btn btn-ghost` 类**，避免新 class → 免 `npm run build` |
| `lib/routes/mp-format.js` | 在 `tryRoute` 内新增分支（文件现有 `json/readBody` 风格） | `GET /api/_/mp-format/draft` → `getLocalData('format-draft','default')`；`PUT` → 校验 `data` 为对象且 `markdown` 为字符串、长度 ≤ 200000（独立上限，草稿可比 AI 排版输入大），`setLocalData('format-draft','default', { title, markdown, updatedAt })`；直接 `require('../local-data')`（与 `lib/routes/hot.js:4` 直连 `../db` 同风格） |
| `js/pages/format.js` | 输入保存（`:138` `LS.set('wf:markdown', …)`） | 保留 LS（离线兜底），**追加**防抖 1-2s 的 `PUT /mp-format/draft`；失败静默（不打断编辑） |
| `js/pages/format.js` | 复制排版（`:651-675`） | 复制前自检：降级状态（`renderArticleSafe` 的 `degraded`）、内容超长、图片数量 → toast 提示，不阻断复制 |
| `test/mp-format.routes.test.js` | 现有 7 例上追加 | 新增 2 例：① `PUT` 后 `GET` 回读一致；② `markdown` 超长 400 / 未登录 401 |

**实施步骤**

- [ ] 1. 后端：`lib/routes/mp-format.js` 加 `GET/PUT /draft` 两分支
- [ ] 2. 前端：`js/pages/format.js` 导出 `sendToFormat` + 载入优先级 + 防抖保存 + 复制前自检
- [ ] 3. 前端：`js/pages/creator.js` 入口 + `index.html` 按钮（复用 `btn` 类）
- [ ] 4. 测试：`test/mp-format.routes.test.js` 追加 2 例；确认 D4 的 27 例（`markdown-guard` 8 + `frontend-utils-render` 4 + `wechat-format-kernel` 15）仍全绿
- [ ] 5. 人工验收 D1/D2/D3，写入 §7

**验收**（§5-D）

- D1：创作页生成成稿 → 点「排版预览」→ `#formatEditor.value` 与成稿**逐字节一致**。
- D2：排版页编辑 → 清 localStorage → 重进 → 内容恢复；`SELECT data_json FROM local_data WHERE module='format-draft'` 有落库。
- D3：含 dataURL 大图/畸形图片的输入 → 显示降级提示条而非红字异常；产物含内联 `style`、不含 `<script>`。
- D4：`node test/markdown-guard.test.js`、`node test/frontend-utils-render.test.js`、`node test/wechat-format-kernel.test.js` 共 27 例全绿。

**回归风险与回滚**

- 风险：`sendToFormat` 写入的 markdown 会覆盖用户正在编辑的草稿 → 载入优先级里 `pendingFormatDraft` 只在**本次跳转**生效（消费后置空），不要持久化。
- 风险：防抖 `PUT` 频率过高 → 1-2s 防抖 + 只在内容变化时请求。
- 回滚：新增接口与前端调用独立；停用 `PUT` 即回到「LS 兜底」状态，不影响渲染。

---

### P0-5 用量与杠杆上屏 + 成本归因　`[ ]`　工作量 S/M

**目标**：预算/稳定性开关能在设置页改；用量与并发看得见；最贵的两次调用进入审计。

**改动落点**

| 文件 | 位置 | 改什么 |
|---|---|---|
| `lib/env.js` | `EDITABLE_ENV_KEYS`（`:8-14`） | 增加：`LLM_MAX_TOKENS`、`LLM_MAX_CONCURRENCY`、`LLM_QUEUE_TIMEOUT_MS`、`LLM_FIRST_TOKEN_TIMEOUT_MS`、`LLM_IDLE_TIMEOUT_MS`、`LLM_TOTAL_TIMEOUT_MS`、`LLM_RETRIES`、`LLM_DAILY_CALL_LIMIT`、`REDFOX_DAILY_CALL_LIMIT`、`INGEST_TOKEN` |
| `lib/env.js` | `ENV_VALUE_WHITELIST`（`:18-20`）附近 + `updateEnvConfig` 校验段（`:64-66`） | **新增数值校验**：`ENV_VALUE_WHITELIST` 只做枚举，数值键需范围校验（如 `LLM_MAX_CONCURRENCY ∈ [1,16]`、`LLM_RETRIES ∈ [0,5]`、`*_TIMEOUT_MS ∈ [1000, 600000]`、`*_LIMIT ∈ [0, 100000]`、`LLM_MAX_TOKENS ∈ [256, 32768]`），非法值 → `throw`（前端 toast）。注意 `updateEnvConfig` 第 63 行**空值跳过**，所以「设为 0」要传字符串 `'0'`（非空） |
| `js/pages/settings.js` | env 字段表（`:403-418`，tuple `[key,label,type,tip,link,options]`） | 追加数值字段（沿用 `'text'` 类型即可，建议 `inputmode="numeric"`；秘密键自动脱敏由 `publicEnvConfig` 处理） |
| `js/pages/settings.js` | `loadQuota`（`:481-513`） | ① 现只展示 `today.calls`/`month.calls`（`:493-494`），**补 `requests/cache_hits/errors`**（`usageSummary()` 已提供，`lib/observability.js:37-43`）；② 新增「LLM」小区块：`GET /api/_/stats` 的 `llm.live`（active/queued/limit）+ `llm.todayCalls` |
| `lib/routes/misc.js` | `/api/_/rewrite`（`:162-176`） | 在路由层补审计（`ctx.logAction` 已注入，见 `:28`）：`logAction('rewrite','button','llm',{ model, platform, deduplicated }, 0, 1)`；去重命中算复用，不重复写 LLM 计数 |
| `lib/routes/mp-format.js` | `ai-layout` 成功分支（`:78` 附近） | `logAction('mp-format-ai-layout','button','llm',{ length: markdown.length }, 0, 1)`（需在 `tryRoute` 的 ctx 解构里加 `logAction`；`server.js` 的 `handleLocalApi` 已为其它路由组注入同一 `logAction`） |
| `test/security-hardening.test.js` 或新增 env 用例 | — | 非法数值（如 `LLM_MAX_CONCURRENCY=abc`、`=0`）→ 400 且不写入 `.env` |

**实施步骤**

- [ ] 1. `lib/env.js` 白名单 + 数值校验
- [ ] 2. `js/pages/settings.js` env 字段表加数值项
- [ ] 3. `js/pages/settings.js` 用量卡片补 3 个 API 指标 + LLM 区块（接 `/api/_/stats`）
- [ ] 4. `lib/routes/misc.js` / `lib/routes/mp-format.js` 补 `logAction`
- [ ] 5. 补 env 校验测试用例
- [ ] 6. 验收 E1~E5

**验收**（§5-E）

- E1：设置页 4 个数字与 `SELECT COUNT(*) r, SUM(cached=0) c, SUM(cached=1) h, SUM(status_code>=400) e FROM api_usage WHERE created_at >= <today>` 完全一致。
- E2：并发 3 个创作时 `/api/_/stats` 显示 `llm.live.active ≤ 2`、`queued ≥ 1`，`llm.todayCalls` 与 `llm_usage` 当日行数一致。
- E3：设置页保存 4 个键后 `GET /api/_/env` 返回 `configured:true`；`.env` 文件可见新值（文件权限仍 `0600`）。
- E4：`LLM_DAILY_CALL_LIMIT=1` 时第 2 次生成快速失败且文案为「今日 LLM 调用已达上限（…）」（`lib/llm.js:171`），`llm_usage` 不新增。
- E5：触发 `/api/_/rewrite` 与 `mp-format/ai-layout` 各一次 → `action_logs` 各新增 1 行且 `llm_calls ≥ 1`。

**回归风险与回滚**

- 风险：把 `INGEST_TOKEN` 加进可编辑白名单 = 设置页可改插件上报令牌 → 保持脱敏（`publicEnvConfig` 对 `TOKEN` 自动返回空值，`lib/env.js:51-52`），并确认前端不显示其值。
- 风险：数值校验过严会挡住合法值 → 范围上界按 `.env.example` 注释给出。
- 回滚：`lib/env.js` 与设置页改动可独立回退；审计行只增不删，无破坏性。

---

## 3. P1 任务卡（可延至下一迭代）

### P1-1 服务端 SSE 透传到前端　`[ ]`　工作量 L

- 落点：`lib/rewrite.js`（暴露 `onDelta`，复用 `lib/llm.js` 已有的上游 SSE 聚合）、`lib/routes/misc.js`（新增 `/api/_/rewrite/stream`，`res.write` + `text/event-stream`）、`js/api.js`（新增流式读取）、`js/pages/creator.js`（增量渲染，`busyState` 升级为流式进度）。
- 步骤：- [ ] 1. 后端流式路由（先只支持单条 LLM 链，tools 路径仍非流式）；- [ ] 2. 前端 `EventSource`/`fetch` 流读取；- [ ] 3. 增量渲染 + 错误/中断处理；- [ ] 4. 补 `test/llm-stream.test.js` 相邻用例 + 路由级用例。
- 验收：F1（TTFB ≥90% ≤30s）、F2（文本长度单调增长 ≥5 次）、F3（取消后无新增 `llm_usage`、日志无未捕获异常）、F4（`llm-stream` 8 + `routes` 26 例全绿）。
- 风险：SSE 在反向代理/Docker 下的缓冲 → 需 `X-Accel-Buffering: no` 与心跳；回滚 = 保留原整包接口，前端切回。

### P1-2 长任务作业化（热点刷新 / 账号同步 / 诊断）　`[ ]`　工作量 M

- 落点：`lib/routes/hot.js:35-39`（改「提交即返回 jobId」）、`lib/routes/trackers.js`、`lib/routes/accounts.js`；job 模式与 UI 照抄 `lib/routes/mp-whitelist.js:31` + `js/pages/dashboard.js:533-560`；进度落 `hot_batches.status/error/item_count`（`lib/db.js:152-165`）。
- 验收：G1（点「刷新热点」无任何 HTTP 请求 >30s）、G2（页面失败平台与 `SELECT platform,status,item_count,error FROM hot_batches …` 一致）。
- 风险：job 状态需过期清理（避免 `local_data` 无限增长）→ 复用 `setLocalData(..., expiresAt)`。

### P1-3 公众号草稿箱同步（方案 PR-3）　`[ ]`　工作量 L

- 前置：`MP_APP_ID`/`MP_APP_SECRET` + 认证号 + IP 白名单；`lib/wechat-official.js:174` 导出面扩展（`getMpConfig/getAccessToken/mpError`）。
- 落点：新增 `lib/mp-publisher.js`（图片转存 + 封面 + `draft/add`）、`lib/routes/mp-format.js` 加 `sync-draft`/`config`/`ip-diagnostic`、README/`THIRD_PARTY_NOTICES.md` 合规件。
- 验收：H1（未配置 400 + 引导）、H2（草稿图片 100% `mmbiz.qpic.cn`）、H3（无 `MP_APP_SECRET` 泄露）。
- 依赖顺序：**必须在 P0-4 之后**（先把素材进排版的成本降下来）。

### P1-4 作品数据可信度（没涨 vs 没同步 / 观察中篇目）　`[ ]`　工作量 S

- 落点：`lib/work-stats.js:23-46`（相同指标也落一条同步事件，或加 `unchanged` 标记列，用 `ensureColumn`）、`js/pages/tracker.js`、`js/pages/dashboard.js`（展示 `observing` 篇数，数据来自 `lib/article-analysis.js:290,395`）。
- 验收：I1（连续 2 天同步不变数据 → `work_stats_history` ≥2 个点且可区分「值未变」）、I2（显示「N 篇观察中」）、I3（13+4+9 例全绿）。

### P1-5 周行动项关联化（可跳转）　`[ ]`　工作量 S

- 落点：`lib/db.js:127-135` + `ensureColumn`（`account_id`/`work_id`）、`lib/dashboard-overview.js:214-296`（让 LLM 输出带锚点）、`js/pages/dashboard.js:75-79`（点击跳转）。
- 验收：J1（≥80% 行动项带 `account_id`）、J2（1 次点击到 tracker/detail）、J3（已完成行动项不原样重复）。
- 依赖：P1-4（锚点数据先可信）。

---

## 4. 变更清单汇总

### 4.1 前端文件

| 文件 | 涉及任务 | 改动性质 |
|---|---|---|
| `js/components.js` | P0-1 | 新增共享等待态组件 |
| `js/api.js` | P0-1、P0-2 | `isAbortError` 导出；元数据透传白名单加 `deduplicated` |
| `js/utils.js` | P0-1 | 新增纯函数 `formatElapsed` |
| `js/pages/creator.js` | P0-1、P0-4 | 取消/失败保留；「排版预览」入口 |
| `js/pages/inspiration.js` | P0-1、P0-2 | 等待态、取消、防重入、失败分型 |
| `js/pages/format.js` | P0-1、P0-4 | 等待态复用；草稿载入优先级/防抖保存/复制前自检；导出 `sendToFormat` |
| `js/pages/hotlist.js` | P0-3 | 趋势卡元信息条；重新分析二次确认 |
| `js/pages/settings.js` | P0-5 | env 数值字段；用量/LLM 区块 |
| `js/app.js` | P0-4 | 动作注册（按钮驱动时） |
| `index.html` | P0-4 | creator 模板加「排版预览」按钮（复用现有 class） |

### 4.2 后端文件

| 文件 | 涉及任务 | 改动性质 |
|---|---|---|
| `lib/single-flight.js`（**新增**） | P0-2 | 可单测的同请求去重模块（`createSingleFlight` / `requestKey`） |
| `lib/routes/inspiration.js` | P0-2 | 接 single-flight；审计只在「真的跑了一次」时记录 |
| `lib/utils.js` | P0-3 | 新增纯函数 `normalizeTrendDays`（路由入参与 `getHotTrends` 共用一套窗口归一化） |
| `lib/routes/hot.js` | P0-3 | 校验 `days`（只认 7/14）并读 body 的 `force` |
| `lib/hot.js` | P0-3 | 窗口参数、幂等沿用缓存判据、`batchStats` 透出 |
| `lib/routes/mp-format.js` | P0-4、P0-5 | 草稿 GET/PUT；`ai-layout` 审计 |
| `lib/routes/misc.js` | P0-5 | `/rewrite` 审计 |
| `lib/env.js` | P0-5 | 白名单扩容 + 数值校验 |
| `lib/work-stats.js`、`lib/db.js`、`lib/article-analysis.js`、`lib/dashboard-overview.js`、`lib/routes/{trackers,accounts,dashboard}.js`、`lib/wechat-official.js`、`lib/mp-publisher.js`（新增） | P1-2~P1-5、P1-3 | 见对应任务卡 |

### 4.3 新增/扩展测试

| 文件 | 任务 | 用例要点 |
|---|---|---|
| `test/frontend-utils.test.js`（**新增**） | P0-1 | `formatElapsed` 边界 + `isAbortError`（前端纯函数；`test/utils.test.js` 属后端 `lib/utils.js`，不要混用） |
| `test/single-flight.test.js`（**新增**） | P0-2 | 去重机制 6 例：并发复用 / 不同 key / 结束后释放 / 窗口过期 / 失败传播且可重试 / 键归一化 |
| `test/hot-window.test.js`（**新增**） | P0-3 | `normalizeTrendDays` 3 例：只认 7 / 非法值兜底 14 / 返回值域（纯函数，本环境可跑） |
| `test/hot-trends.test.js`（**新增**） | P0-3 | DB 用例 3 例：同指纹二次分析不再触达 LLM / `windowDays` 回溯深度与 `getHotTrends` 窗口 / `batchStats` 与库中 `json_extract` 一致 |
| `test/mp-format.routes.test.js`（扩展） | P0-4 | 草稿 PUT→GET 一致 / 超长 400 / 未登录 401 |
| env 校验用例（`test/security-hardening.test.js` 或新增） | P0-5 | 非法数值 400 且不写文件 |

### 4.4 数据库变更

| 任务 | 变更 | 方式 |
|---|---|---|
| P0-4 | **无表结构变更** | 复用 `local_data`（`module='format-draft'`, `data_key='default'`） |
| P1-4 | `work_stats_history` 增标记列（如 `unchanged INTEGER DEFAULT 0`）或新增同步事件行 | `ensureColumn`（`lib/db.js`） |
| P1-5 | `weekly_actions` 增 `account_id`/`work_id` | `ensureColumn` |
| P1-2 | 无变更 | 复用 `hot_batches.status/error/item_count` |

### 4.5 配置项变更

| 键 | 默认（`.env.example`） | 热加载 | 校验 |
|---|---|---|---|
| `LLM_MAX_TOKENS` | 4096 | ✅（`process.env` 每次读取） | 256-32768 |
| `LLM_MAX_CONCURRENCY` | 2 | ✅（`lib/llm.js:178` 动态读） | 1-16 |
| `LLM_QUEUE_TIMEOUT_MS` | 120000 | ✅ | 1000-600000 |
| `LLM_FIRST_TOKEN_TIMEOUT_MS` | 90000 | ✅ | 1000-600000 |
| `LLM_IDLE_TIMEOUT_MS` | 45000 | ✅ | 1000-600000 |
| `LLM_TOTAL_TIMEOUT_MS` | 300000 | ✅ | 1000-600000 |
| `LLM_RETRIES` | 2 | ✅ | 0-5 |
| `LLM_DAILY_CALL_LIMIT` | 0（不限） | ✅ | 0-100000 |
| `REDFOX_DAILY_CALL_LIMIT` | 0（不限） | ✅ | 0-100000 |
| `INGEST_TOKEN` | 空 | ✅（路由内每次 `readEnvValues` 读文件，`lib/routes/ingest.js:17`） | 非空字符串，脱敏显示 |

> 热加载语义（`server.js:97-145`）：`fs.watch(ENV_FILE)` → `readEnvValues` → 覆盖 `process.env`，仅 `DOCKER_MANAGED_ENV`（`HOST/DATA_DIR/NODE_ENV/XHS_MCP_URL/PATH/HOME/TERM`，`server.js:99`）不受 `.env` 影响；`syncEnvFileOnBoot`（`server.js:105-118`）已修掉 Docker `env_file` 快照遮蔽问题 → **设置页保存即时生效，`docker restart` 也不会回退**（见 `docs/optimization-plan.md` 补 3）。

### 4.6 文档更新

- [ ] 每个批次完成后，把 §7 进度看板的状态与验收结论更新为 `[x]`。
- [ ] P1-3 落地时补 `THIRD_PARTY_NOTICES.md`（上游 `wechat-formatter` 署名与协议）。

---

## 5. 风险登记与回滚预案

| # | 风险 | 触发条件 | 预案 / 回滚 |
|---|---|---|---|
| 1 | 取消请求后服务端仍消耗 token | `AbortError` 未传递或后端不感知断连 | 前端取消是「止损」而非「退款」：验收 A4 允许 ≤1 行 `llm_usage`；如需硬止损，纳入 P1-1（服务端感知 socket 关闭） |
| 2 | 去重窗口把「稍后想重跑」的请求也复用 | 5s 窗口内同 body | 二次确认按钮显式传 `force`；窗口可配（默认 5000ms） |
| 3 | 趋势窗口改造后旧报告口径不一致 | 历史 `hot_daily_keywords` 按日一条 | 窗口只影响聚合范围，不改表；C1/C2 已覆盖 |
| 4 | 草稿防抖写入与用户本地编辑冲突 | 多标签页/多设备 | 服务端草稿仅作恢复兜底，冲突时以「最后写入」为准并在复制前自检提示 |
| 5 | 新增 env 键与 Docker 注入值冲突 | compose `environment:` 段显式设了同名变量 | 既有语义：非 `DOCKER_MANAGED_ENV` 的键一律以 `.env` 文件为准（`server.js:105-118`）；若用户确想让 compose 值优先，需把该键加进 `DOCKER_MANAGED_ENV`——本计划不动它，只在设置页提示即时生效 |
| 6 | 新增 Tailwind class 未 build → 样式丢失 | 改了 `class` 未跑 `npm run build` | 优先复用 class/内联样式；一旦新增必须 build 并目视验收 |
| 7 | 测试基线被削减 | 改动删掉旧用例 | 门禁要求 **≥167 例**；每个任务只允许新增用例 |

---

## 6. 完成定义（DoD）

一个任务算完成，必须同时满足：

1. [ ] 落点表内的文件全部改完，且**没有**顺手改无关文件（改动收敛）；
2. [ ] 新增/扩展测试通过；全量门禁 `npm run check` + `npm test` 在具备依赖的环境通过，用例数 **≥167**；
3. [ ] 对应验收编号逐条给出**结论证据**（命令输出 / SQL 结果 / UI 截图路径）写入 §7；
4. [ ] 无新增运行时依赖；DB 变更走 `ensureColumn`；新增 Tailwind class 已 build；
5. [ ] 中文注释与提交信息；提交信息格式 `fix(<scope>): …` / `feat(<scope>): …`；
6. [ ] 回滚方式已写明（默认 = 单提交 revert，无破坏性数据变更）。

---

## 7. 进度看板与验收记录

| 任务 | 状态 | 提交 | 验收编号 | 验收结论 | 备注 |
|---|---|---|---|---|---|
| P0-1 统一等待态 | `[x]` 代码完成，A1/A3/A4 待人工验收 | 本轮工作树 | A1-A4 | 代码级：`test/frontend-utils.test.js` 3/3 + 6 个改动文件 ESM 语法门禁通过；UI 路径未执行（无浏览器 provider / 无 `node_modules`） | 起点，Batch 1 |
| P0-2 灵感防重入 | `[x]` 代码完成，B1/B2/B3 待人工验收 | 本轮工作树 | B1-B3 | 机制级：`test/single-flight.test.js` 6/6；`node --check` 通过；路由级用例需 DB+LLM 环境 | 依赖 Batch 1；`/rewrite` 既有内联去重未统一（§8.1-5） |
| P0-3 趋势卡可信化 | `[x]` 代码完成，C1-C3 待依赖环境实测 | 本轮工作树 | C1-C4 | 纯函数级：`test/hot-window.test.js` 3/3 + 7 个改动文件语法门禁通过；C1-C3 的落库口径已写成 `test/hot-trends.test.js`（3 例）但需 `better-sqlite3` 环境执行；C4 需人工验收 | LLM 走桩注入以免依赖密钥（§8.1-7）；窗口归一化抽成纯函数（§8.1-8） |
| P0-4 排版闭环 | `[ ]` | — | D1-D4 | — | 不依赖 MP 凭证 |
| P0-5 用量与杠杆 | `[ ]` | — | E1-E5 | — | 可与 2-4 并行 |
| P1-1 SSE 流式 | `[ ]` | — | F1-F4 | — | 依赖 Batch 1 |
| P1-2 长任务作业化 | `[ ]` | — | G1-G2 | — | 独立 |
| P1-3 草稿箱同步 | `[ ]` | — | H1-H3 | — | 依赖凭证 + P0-4 |
| P1-4 数据可信度 | `[ ]` | — | I1-I3 | — | 独立 |
| P1-5 行动项关联 | `[ ]` | — | J1-J3 | — | 依赖 P1-4 |

**测试基线变更（Batch 1-3）**：+ `test/frontend-utils.test.js` 3、`test/single-flight.test.js` 6、`test/hot-window.test.js` 3、`test/hot-trends.test.js` 3 → 全仓库静态计数 **167 → 182**（各 `test/*.test.js` 的 `^test(` 之和）。
**本环境可运行验证**：47 例全绿 —— `frontend-utils` 3、`frontend-utils-render` 4、`llm-stream` 8、`markdown-guard` 8、`single-flight` 6、`hot-window` 3、`wechat-format-kernel` 15（用 vendor 同版本 marked 经 `NODE_PATH` shim 离线复跑）。
**依赖环境待跑**：`test/hot-trends.test.js` 与另外 14 个走 `test/_helper.js`/`test/_server.js` 的文件（本 worktree 无 `better-sqlite3`）→ 在装了依赖的检出里执行 `npm install && npm test`。

---

## 8. 落地方式修正记录（编写本计划时对产品文档的 3 处实施级校正）

产品文档给出的是**要达成的效果**，编写实施计划时按仓库实际代码复核，以下 3 处的**落地方式**做了修正（产品文档未改，按本文执行）：

| # | 产品文档原写法 | 仓库实际 | 本文采用的做法 |
|---|---|---|---|
| 1 | `state.formatDraft = { … }` | `js/state.js` 的 `state` 是 `AppState` 实例，其 `set/get/update` API **全仓库无人使用**（`js/app.js:3` 引入但未调用）；仓库真实的跨页传递范式是 `js/core/itemCache.js:27-43` + `js/app.js:29-32` 注册 handler，**由目标页导出接收函数**（`js/pages/creator.js:131 sendToCreator`） | P0-4 改为 `js/pages/format.js` 导出 `sendToFormat({title, markdown})` + 模块级 `pendingFormatDraft`，按钮经 `registerAction` 驱动（对齐 `js/app.js:273`） |
| 2 | 验收 A2「断言第二次 POST 返回 `data.deduplicated === true`」 | single-flight 的 `deduplicated` 写在**响应顶层**（`lib/routes/misc.js:169`），而 `localApi` 只返回 `payload.data`（`js/api.js:134-145` 的元数据白名单不含它）→ 前端**看不到**该标记 | ① 把 `'deduplicated'` 加入 `js/api.js:141-144` 白名单；② A2 判定改为对**原始 HTTP JSON** 断言（或加白名单后断言 `payload.deduplicated`） |
| 3 | P0-5「设置页补当日 requests/calls/cache_hits/errors」 | `usageSummary()`（`lib/observability.js:37-43`）**已提供**这 4 个数字，`GET /api/_/quota` 也已返回；但设置页只渲染了 `today.calls`/`month.calls`（`js/pages/settings.js:493-494`） | 改为**只补渲染**（不补接口）；真正需要新增的是「LLM 并发/排队 + 今日 LLM 调用」（接 `GET /api/_/stats` 的 `llm` 块），以及把 10 个稳定性/预算键加进 `EDITABLE_ENV_KEYS` + 数值校验 |

> 补充：`/api/_/env` 的 GET/PUT 落在 `lib/routes/auth.js:164-172`（不是 `misc.js`），`updateEnvConfig` 会跳过空值（`lib/env.js:63`）——所以「设为 0」必须传字符串 `'0'`，且**无法通过设置页清空**某个键，这是既有语义，任务卡已按此设计。

### 8.1 实施期新增的落地偏差（Batch 1-2 实际执行记录）

| # | 计划写法 | 实际发现 | 最终做法 |
|---|---|---|---|
| 4 | P0-1 步骤 2：把 `formatElapsed` 的测试加到 `test/utils.test.js` | `test/utils.test.js` 走 `./_helper`（require server.js → better-sqlite3），是**后端** `lib/utils.js` 的测试；前端纯函数塞进去会平白拖上 DB 依赖 | 另建 `test/frontend-utils.test.js`（3 例，无 DB 即可跑） |
| 5 | P0-2 步骤 3：新增 `test/inspiration.routes.test.js` 验证去重 | 路由级用例需 DB，且 `test/_server.js` 会屏蔽 LLM/RedFox 密钥 → `/inspirations/generate` 在无 LLM 时必然失败，「去重命中」无法观察 | 抽出 `lib/single-flight.js` **纯模块**并单测 6 例（可跑、可复用）；`/rewrite` 的既有内联去重**保持不动**以降风险，两处语义统一留作后续 |
| 6 | P0-1 步骤 7：「改过 Tailwind class 则 `npm run build`」 | 新增等待态若用新 class 就必须重建 CSS 产物 | 只用**内联样式 + index.html 已出现的 class**（`btn btn-ghost py-0.5 px-1.5 text-[11px]`），本轮**无需** `npm run build` |
| 7 | P0-3 用例 ①「二次调用不新增 `llm_usage`」 | `test/_server.js` 会屏蔽 LLM 密钥，无密钥时真实 `callLlmJson` 必然抛错，「`llm_usage` 新增几行」无法观察 | `test/hot-trends.test.js` 用 `hotLib.make({ callLlmJson: 桩 })` 注入桩并**精确断言桩被调用次数**（等价口径：0 次调用 = 0 行 `llm_usage`），同时不依赖网络与密钥 |
| 8 | P0-3 窗口归一化（原计划在两处各写 `days === 7 ? 7 : 14`） | 路由与 `getHotTrends` 各写一遍会静默漂移 | 抽到 `lib/utils.js` 的 `normalizeTrendDays` 并单测（`test/hot-window.test.js` 3 例）—— 这也是 C1 里本环境唯一可跑的断言 |
| 9 | P0-3 步骤 3 只要求「元信息条 + 二次确认」 | 「强制重新分析」是全应用最长任务（约 4 批 LLM），只给静态「分析中…」等于又一个卡死感 | 顺手接入 P0-1 的 `busyState`（实时计时 + 取消）与同款防重入；不新增 Tailwind class |