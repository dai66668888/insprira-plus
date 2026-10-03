# 灵感熔炉 · 创作链路与热点趋势优化方案

> 状态标记：`[x]` 已完成 / `[ ]` 待实施。本文档是改写工作的对照清单，实施时按 Phase 顺序推进，
> 每阶段完成后运行 `npm run check` + `npm test` 回归。

## 0. 背景与目标

两个已确认的问题：

1. **AI 创作/改写访问量过大导致功能失败**（含「只消耗 token 不返回文章」）：
   - 非流式调用 + 80s/100s 硬超时，GLM 思考型模型长文必然超时，abort 后 token 照常计费；
   - 全链路无并发控制（前端 `doRewrite` 不防重入、后端无 single-flight、无 LLM 全局并发闸）；
   - LLM 层无重试/退避，429 判定只靠 message 正则（`err.status` 未参与），tools 路径连 fallback 都不走；
   - RedFox 业务调用（`redfoxData`）绕过 `api_cache` 缓存；豆包搜索 submit+20 次轮询无缓存；
   - 无用量预算与熔断。
2. **热点趋势获取资料后不在 Web 端显示**：
   - `/api/_/hot/trends` 硬编码 `analyzed: true`，前端「AI 深度分析趋势」按钮分支成死代码（`hotlist.js` legacy 分支不可达）；
   - `getHotTrends` 需要 ≥2 天 `hot_daily_keywords` 报告才出主题卡；
   - 趋势分析只统计 `data_date = 昨天` 的批次，「刷新热点」落库的 realtime 批次 `data_date = 今天` 永远不参与；
   - 分析强依赖 LLM 成功，与问题 1 叠加放大。

原则：**业务层（rewrite/inspiration 等）尽量零改动**，改造收敛在 `lib/llm.js`、`lib/redfox.js`、
两个前端页面和两个路由；所有新配置项走 `.env` 且带默认值，向后兼容。

---

## Phase 1（P0）：LLM 调用层重构 — `lib/llm.js`（+ 新增 `lib/llm-stream.js`）

### 1.1 流式聚合 `[x]`

- 新建 `lib/llm-stream.js`：SSE 解析/聚合纯函数（`createStreamState` / `feedSse` / `flushSse` / `toStreamMessage`），
  兼容 OpenAI 兼容接口流式格式，处理 `delta.content` / `delta.reasoning_content`（GLM 思考）/ `delta.tool_calls` 分片拼接、
  `[DONE]`、注释心跳行、CRLF、跨 chunk 截断行；
- `lib/llm.js` 的 `doCall` 非工具路径改走 `stream: true`，逐 chunk 聚合完整文本后再交给现有
  `parseLlmJson` —— 业务层零改动；
- 服务端不支持流式时自动降级：响应非 `text/event-stream` 按整包 JSON 解析；HTTP 400 且报错含 "stream"
  时降级为非流式重试。

### 1.2 三级超时语义替代整包超时 `[x]`

| 参数 | env | 默认值 | 含义 |
|---|---|---|---|
| `firstTokenTimeoutMs` | `LLM_FIRST_TOKEN_TIMEOUT_MS` | 90000 | 连接+思考阶段首包时限（覆盖 GLM 深度思考） |
| `idleTimeoutMs` | `LLM_IDLE_TIMEOUT_MS` | 45000 | 相邻 chunk 最大间隔 |
| `totalTimeoutMs` | `LLM_TOTAL_TIMEOUT_MS` | 300000 | 单次尝试总时长兜底 |

带工具路径（联网创作）保持非流式，单轮上限 100s（可用 `options.timeoutMs` 覆盖），并纳入重试层。

### 1.3 重试 + 退避 + fallback 修复 `[x]`

- 对 `429 / 5xx / 408 / 超时 / 网络错误` 自动重试：默认非工具路径 2 次、带工具路径 1 次（`LLM_RETRIES` 可配），
  指数退避 1s/2s + jitter，尊重 `Retry-After` 响应头；
- 可重试判定改为 **`err.status` 优先、message 正则为辅**（修复中文报错匹配不上的漏洞）；
- **tools 路径失败也接入 fallback**（`LLM_FALLBACK_MODEL`），判定规则：可重试类错误，或状态码 ≥400
  且非 400/401/403（换模型可能解决的模型类错误）。

### 1.4 空内容兜底与思考参数 `[x]`

- 流式聚合后 `content` 为空：`finish_reason=length` 时报「生成被 max_tokens 上限截断」并附思考片段提示；
  其余情况报「LLM 返回内容为空」，不再让 `parseLlmJson('')` 抛裸的「JSON 解析失败」；
- 新增 `LLM_THINKING=disabled|enabled`：非空时向请求体下发 `thinking: { type }`（GLM 等思考型模型用），
  留空不下发（兼容其它 OpenAI 兼容服务）。

### 1.5 参数可配 + 全局并发闸 + 用量 `[x]`

- `LLM_MAX_TOKENS`（默认 4096）替代硬编码；
- 进程内动态信号量：`LLM_MAX_CONCURRENCY`（默认 2）+ 排队超时 `LLM_QUEUE_TIMEOUT_MS`（默认 120s），
  保护手动创作与所有 cron 任务不互相踩踏；
- 新增 `llm_usage` 表（db.js）：记录每次模型调用的模型名/状态码/token 用量，供预算与统计使用；
- 并发状态（active/queued/limit）通过 `stats()` 暴露给 `/api/_/stats`。

**验收**：创作 90s+ 仍能完整返回；mock 429 后重试成功；`test/llm-stream.test.js` 覆盖聚合边界。

---

## Phase 2（P0）：创作链路防重入 — `js/pages/creator.js` + `lib/routes/misc.js` `[x]`

- 前端 `doRewrite`：模块级 in-flight 标志 + 按钮禁用（`#doRewriteBtn`），完成/失败后恢复；
- 后端 `/api/_/rewrite` single-flight：按 `sha1(stableObject(body))` 做进行中去重（5s 窗口），
  相同请求复用同一个 Promise，不重复起 LLM 链。

**验收**：双击「开始创作」只发一次请求、只跑一条 LLM 链。

---

## Phase 3（P1）：RedFox 业务层缓存 — `lib/redfox.js` + `server.js` `[x]`

- `redfoxData` / `redfoxGetData` 接入既有 `getCached`/`setCache`（SQLite `api_cache`），
  但仅对**热点/榜单类端点白名单**生效（`hotKeyword/list`、`hotSpot/*`、`dy/search/*`、`cozeSkill/*`、
  `gzh/search/hotArticle`、`parseWork/query*Msgs`）——账号/查询类端点（`dyData/*`、`xhsUser/*`、`gzhData/*`、
  `syncUserNotes` 等）时效敏感，业务层不缓存；
- `doDoubaoWebSearch` 增加结果缓存（query 级，TTL 10 分钟，内存 Map，上限 100 条 LRU 淘汰）：
  同题重复创作不再重复 submit+轮询。

**验收**：同参数二次调用命中缓存（`api_usage.cached=1`），豆包搜索 10 分钟内同 query 零 API 消耗。

---

## Phase 4（P1）：热点趋势显示修复 — `lib/routes/hot.js` + `lib/hot.js` + `js/pages/hotlist.js` `[x]`

1. **恢复分析入口（修死代码）**：
   - 路由 `analyzed` 改为反映真实状态（`Boolean(result.analyzedThrough)`）；
   - 前端 `loadHotTrends` 重写空数据分支：themes 为空时显示原因 summary + 「AI 深度分析趋势」按钮
     （原 legacy 分支按旧数组结构编写且永不可达，直接删除）。
2. **数据日期口径修复**（`analyzeDailyHotKeywords`）：
   - 首选日期（昨天）数据 <10 行时，按「昨天 → 今天(实时批次) → 再往前回溯至 7 天」找第一个
     ≥10 行的日期分析，返回结果中的 `dataDate` 即实际分析日期；
   - 全部不足时给出明确错误（提示先去热榜页抓取数据），而非只报昨天不足。
3. **联动**：`analyzeHotTrendsLlm` 返回值附带 `analyzedDate`；前端分析完成后 toast 提示实际分析日期。

**验收**：新装用户点击按钮能看到明确引导；只刷实时热点的用户（今天 realtime 批次 ≥10 行）当天即可生成首份报告。

---

## Phase 5（P2）：用量预算与熔断 — `.env` + `lib/redfox.js` + `lib/llm.js` + `lib/routes/misc.js` `[x]`

- `REDFOX_DAILY_CALL_LIMIT` / `LLM_DAILY_CALL_LIMIT`（0 = 不限制）：调用前检查当日用量，
  超限抛「今日配额已用尽」友好错误而非裸 429；RedFox 侧计数复用 `api_usage`（30s memo 防频繁 COUNT），
  LLM 侧用新 `llm_usage` 表；
- `/api/_/stats` 增加 `llm` 块：实时并发/排队状态 + 今日调用次数。

**验收**：limit 设小后第 N+1 次调用快速失败且不再产生真实 API/模型消耗。

---

## 实施顺序与依赖

```
Phase 1 (llm.js 流式/重试/并发闸)   ← 地基，先做
   ├→ Phase 2 (防重入 + single-flight)
   ├→ Phase 3 (RedFox 缓存 + 豆包搜索缓存)
   ├→ Phase 4 (趋势显示；日期回溯依赖 Phase 1 重试兜底)
   └→ Phase 5 (预算熔断；最后加闸，避免影响调试)
```

每阶段完成：`npm run check`（语法）+ `npm test`（全量回归）；新增 `test/llm-stream.test.js` 纯函数单测。

## 回归风险控制

- `parseLlmJson` 与业务模块零改动 → 选题生成、账号诊断、Skill 分类等 LLM 调用方自动受益、不受影响；
- 新 env 全部有默认值 = 不配置时行为只增强不破坏；
- 流式失败自动降级非流式重试，最坏情况不比改造前差；
- `.env`、`data/` 等敏感内容不触碰。

## 配置项汇总（`.env.example` 已同步）

```bash
# LLM
LLM_THINKING=disabled            # GLM 等思考型模型关思考；留空不下发
LLM_MAX_TOKENS=4096              # 单次生成上限；长文建议 8192
LLM_MAX_CONCURRENCY=2            # 全局并发闸
LLM_QUEUE_TIMEOUT_MS=120000      # 排队超时
LLM_FIRST_TOKEN_TIMEOUT_MS=90000 # 流式首包超时
LLM_IDLE_TIMEOUT_MS=45000        # 流式 chunk 间隔超时
LLM_TOTAL_TIMEOUT_MS=300000      # 单次尝试总时长
LLM_RETRIES=2                    # 失败重试次数（带工具路径默认 1）
LLM_DAILY_CALL_LIMIT=0           # 每日 LLM 调用上限（0=不限）
LLM_FALLBACK_MODEL=              # 备用模型（建议配置）
# RedFox
REDFOX_DAILY_CALL_LIMIT=0        # 每日 RedFox 调用上限（0=不限）
```

---

## 补充修复（实施后线上问题复盘）

### 补 1：`isRetriableError` 中文过载文案 `[x]`

线上出现智谱「该模型当前访问量过大，请您稍后再试」报错。该文案不在可重试正则中，若服务商
以 400（而非 429）返回则完全不重试。已把 `访问量过大|请稍后再试|过载|繁忙|capacity` 加入
`isRetriableError` 正则（lib/llm.js）。**配套动作（需用户在 .env 配置）**：
`LLM_RETRIES=3`（tools 路径默认仅重试 1 次）+ `LLM_FALLBACK_MODEL=<备用模型>`。

### 补 2：趋势分析敏感内容拦截 + 分批提取 `[x]`

`analyzeDailyHotKeywords` 把 ≤320 条热榜标题原文塞进 prompt，热搜榜天然含敏感题材，
智谱输入侧审核直接拒绝整个请求（HTTP 400，重试无效）。已实施：标题按 80 条/批分批提取，
被审核拒绝/超时/空内容的批次跳过并记日志，其余批次关键词正常合并——单批损失不拖垮全局
（详见补 4 第 2 点）。

### 补 3：Docker 配置回退（前端改了模型/API，重启容器后不生效） `[x]`

根因：compose `env_file` 在**容器创建时**把 .env 快照注入 process.env 且 `docker restart`
不会重新读取；前端保存（updateEnvConfig）写文件+同步当前进程生效，但重启后 loadEnvFile 的
"process.env 已存在即跳过"语义让旧快照遮蔽新值。修复：启动时新增 `syncEnvFileOnBoot()`，
以 .env 文件为准覆盖非 docker 管理变量（`DOCKER_MANAGED_ENV` 集合与 fs.watch 热加载共享），
"启动"与"热加载"规则对齐。**替代方案**：不改代码时，改配置后用 `docker compose up -d`
（重建容器、重新注入）代替 `docker restart`。

### 补 4：思考块空内容 + 设置页「LLM 深度思考」开关 `[x]`

线上日志：趋势分析首次调用首包超时 90s，重试"成功"后 `parseLlmJson` 拿到空内容——
根因是 GLM 思考型模型把 token 预算全部耗在思考上（content 仅为 `<think>` 块或为空），
此前的空内容守卫只查"字面为空"拦不住这种情况。三项修复：

1. **思考块感知的空内容守卫**（lib/llm.js）：新增 `meaningfulContent()`（剥掉 `<think>` 块后判空），
   流式/非流式/降级三条路径统一守卫；`finish_reason=length` 时 400 快速失败并提示
   「配置 LLM_THINKING=disabled 或提高 LLM_MAX_TOKENS」，其余空内容 502 参与重试；
   `parseLlmJson` 空内容单独报错（替代误导性的"JSON 解析失败: Unexpected end"）。
2. **趋势分析分批提取**（lib/hot.js，与补 2 同一改动）：320 条标题按 80 条/批逐批提取，
   单批失败只跳过该批；单批 prompt 缩小 4 倍，思考阶段与审核误伤面同步下降；
   每日关键词上限 20 → 60，结果新增 `batchStats: { total, failed }`。
3. **设置页「LLM 深度思考」开关**（settings.js + env.js + routes/auth.js）：
   `LLM_THINKING` 纳入 EDITABLE_ENV_KEYS，设置页三态下拉（跟随模型默认 default /
   关闭 disabled / 开启 enabled），写入白名单校验（非法值 400），保存后立即生效。
