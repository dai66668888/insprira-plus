# 「公众号排版助手」集成技术方案

> 上游项目：[mspringjade/wechat-formatter](https://github.com/mspringjade/wechat-formatter)（TypeZen，公众号一键排版工具）
> 目标项目：insprira（灵感熔炉，本地自媒体工作台）
> 方案版本：v1.0（设计稿，未开工）

---

## 1. 背景与目标

insprira 已覆盖「选题 → 改写 → 数据追踪」链路，但产出 Markdown/纯文本后，发布到公众号仍缺两个能力：

1. **排版**：把 Markdown 转成带内联样式的微信公众号兼容 HTML（微信编辑器只认 `style=""` 内联样式，粘贴 `<style>` 标签会全部丢失）；
2. **进草稿**：不离开工作台，直接把排版好的文章推到公众号草稿箱，再人工预览发布。

上游 wechat-formatter 恰好实现了这两点，且核心转换引擎**零框架依赖**（仅 marked），可以低成本抽取移植。本方案的目标：

- 以**内核移植**（而非整站嵌入）方式集成排版引擎，保持 insprira「无构建前端 + 单进程后端」架构不变；
- AI 一键排版复用 insprira 已有的全局 LLM 配置（`lib/llm.js`），用户无需再填 API Key；
- 草稿箱同步复用 insprira 已有的公众号凭证体系（`.env` 的 `MP_APP_ID / MP_APP_SECRET`，`lib/wechat-official.js` 的 token 缓存）与 IP 白名单自救（`lib/mp-whitelist.js`）；
- 不引入任何新的运行时 npm 依赖（sharp / React / Next / Vercel AI SDK 均不进入 insprira）。

**非目标（本期不做）**：多平台发布（知乎/头条等）、图文多篇文章合并、付费模板市场、上游的站点页面（博客/隐私政策/广告）、远程 Worker 同步（`SYNC_WORKER_URL` 模式）。

---

## 2. 上游项目分析（基于 master 分支实测源码）

### 2.1 技术栈与结构

- Next.js 16.2.0 (App Router) + React 19.2.4 + TypeScript 5 + Tailwind 4；Markdown 解析 marked 17.0.4；AI 用 Vercel AI SDK 6（@ai-sdk/openai、@ai-sdk/anthropic）；sharp 用于同步前图片压缩。AGPL-3.0 协议，README 附带「未经书面授权禁止商用」附加条款与署名要求。

关键文件清单与可移植性判定：

| 上游文件 | 大小 | 作用 | 判定 |
|---|---|---|---|
| `app/template-engine.ts` | ~44KB | **核心**：`TemplateConfig` 定义、6 大风格样式函数 × 12 色板程序化生成 72 套模板、`renderArticle()`（marked 自定义 Renderer 输出内联样式 HTML） | ✅ 整体移植（仅依赖 marked + 类型） |
| `app/_types/formatter.ts` | ~1KB | `FormatTweaks`（字号/行高/段距/缩进/留白/字间距/圆角/标题对齐）等类型 | ✅ 移植为 JSDoc/约定 |
| `app/_lib/formatter-constants.ts` | ~3KB | 示例文本、localStorage 键名、OpenRouter 常量 | ✅ 摘取（OpenRouter 部分弃用） |
| `app/api/wechat/utils.ts` | ~6.5KB | 服务端：`getWeChatAccessToken`（含 40164 IP 提取）、`uploadImageToWeChat`（正文图转存，>1MB 用 sharp 压到 1080px JPEG q80）、`uploadCoverToWeChat`（封面 900×383 裁剪）、`processHtmlImages`（正则提取 `<img>` 转存并回写 URL）、`addWeChatDraft` | ✅ 逻辑移植，sharp 用浏览器 Canvas 替代（见 5.4） |
| `app/api/wechat/sync/route.ts` | ~2KB | 同步入口：请求体 `{html, title, config.appId/appSecret/author, coverImage, markdown}` → 草稿 `media_id` | ✅ 契约参考，凭证改为服务端 `.env` |
| `app/api/ai-format/route.ts` | ~4.2KB | AI 排版：`SYSTEM_PROMPT` 全文（只调结构不改内容）、输入上限 15000 字符、temperature 0.3、流式返回 | ✅ 提示词移植，改走 `lib/llm.js` |
| `app/_hooks/use-markdown-tools.ts` | ~11KB | 编辑器工具栏（加粗/标题/列表/链接等对 textarea 选区的操作） | ✅ v1 移植子集 |
| `app/_components/*.tsx`、`app/editor/page.tsx` | — | React 三栏工作台 UI | ❌ 不移植，按 insprira 前端惯例重写 |
| `app/_lib/publishing/adapters/*`、`worker/` | — | 本地/远程同步适配器抽象 | ❌ 本地单用户无需抽象层 |
| `app/api/openrouter-models/route.ts` | ~2.7KB | OpenRouter 模型列表 | ❌ insprira 用全局 LLM 配置 |

### 2.2 核心引擎要点（移植时必须保留的微信兼容技巧）

`renderArticle(markdown, template, tweaks)` 的实现要点，这些是「粘贴进公众号后台零损失」的关键，移植时**原样保留**：

1. 全部样式写入 `style=""`，最终产物是 `<section>` 嵌套结构，无 class、无 `<style>`；
2. **背景色分散兜底**（`bgFallback`）：把文章底色下放到每个块级元素，防微信粘贴时剥掉外层背景；同时避免了整体 `<table>` 包裹——那会干扰微信广告系统分段；
3. 标题用三层 `<section>` 嵌套（外层定 margin/text-align，中层模板样式，内层重置字号字重），规避微信渲染错位；
4. 列表用 **float 布局**（图标列 24/32px + 内容列 margin-left + 清浮动），不用 flex/table；任务列表复选框用内联 section 画；
5. 多图并排：同段落纯 `<img>` 自动等分 `inline-block` 多排布局；
6. 代码块：HTML 实体转义 + Mac 三色圆点 SVG 头部；
7. 表格：`cellpadding=0 cellspacing=0` + `<td bgcolor>` 属性兜底（防 CSS 被剥）；
8. 扩展语法：`==高亮==`、`^上标^`、`~下标~`（marked 自定义 extension）；
9. `breaks: true, gfm: true`。

72 套模板 = `getStylesByCategory(分类, 色值)` 一个 switch 函数 × 6 分类（新粗野/极简/商务/文艺/科技/节庆）× 12 色板，**纯数据生成**，移植成本极低。

---

## 3. 集成策略决策

| 备选方案 | 结论 | 理由 |
|---|---|---|
| A. 整站嵌入（iframe 上游站点 / 内置 Next.js） | ❌ | 与「无构建前端、单进程、零重依赖」架构冲突；Docker 镜像膨胀；升级维护两套体系 |
| B. 运行时依赖上游 npm 包 | ❌ | 上游未发 npm 包；TS/ESM/React 混合需引入构建链 |
| **C. 内核抽取移植（选定）** | ✅ | 核心仅 2 个纯函数模块 + 1 个 API 逻辑文件，全部可翻译为原生 JS；marked insprira 已 vendored（v15.0.12，token 渲染器 API 与上游 v17 同代兼容）；一次性移植后摆脱上游框架演进绑架 |

许可合规：两侧均为 AGPL-3.0，代码移植属协议允许范围；上游 README 附加条款要求署名 + 修改说明 + 非商用（或书面授权）。insprira 为开源自托管工具，满足非商用；落地时执行：

- 被移植文件头部加注释块：来源仓库地址、原作者（mspringjade / WeChat Formatter）、移植日期与修改说明；
- 新增 `THIRD_PARTY_NOTICES.md` 记录上游信息与协议链接；
- 在方案与 README 功能说明中保留出处。若未来 insprira 商业化，排版模块需取得上游书面授权或替换实现（风险表见 §9）。

---

## 4. 总体架构

```
┌─ 前端（无构建 ESM）─────────────────────────────────────────────┐
│ js/pages/format.js            排版工作台页（三栏：编辑/预览/设置）      │
│   ├─ js/core/wechat-format/templates.js   72 套模板数据（移植）        │
│   ├─ js/core/wechat-format/render.js      renderArticle 内核（移植）    │
│   ├─ js/core/wechat-format/engine.js      makeEngine({Marked,Renderer})│
│   └─ vendor/marked.min.js (v15) + vendor/purify.min.js（既有，复用）  │
└──────────────┬──────────────────────────────────────────────┘
               │ /api/_/mp-format/*（登录态 Cookie）
┌─ 后端（CommonJS 单进程）────────────────────────────────────────┐
│ lib/routes/mp-format.js       tryRoute 路由组（3 个接口）             │
│ lib/mp-publisher.js           .make() 工厂：图片转存 + 草稿落箱        │
│   ├─ 复用 lib/wechat-official.js  getMpConfig/getAccessToken（导出复用）│
│   ├─ 复用 lib/llm.js           callLlm（AI 排版）                     │
│   └─ 微信 API：token / media/uploadimg / material/add_material / draft/add │
└──────────────────────────────────────────────────────────────┘
```

数据流：

1. **排版**：编辑区 Markdown → `engine.renderArticle(md, template, tweaks)` → 手机框实时预览（DOMPurify 消毒后展示）；
2. **AI 排版**：Markdown → `POST /api/_/mp-format/ai-layout` → `llm.callLlm` → 返回**结构优化后的 Markdown**（回填编辑区，再走排版渲染）；
3. **复制**：产物 HTML 以 `text/html` 写入剪贴板 → 用户到公众号后台粘贴；
4. **同步草稿**：产物 HTML + 标题 + 封面 → `POST /api/_/mp-format/sync-draft` → 服务端转存正文图 → `draft/add` → 返回 `media_id`。

---

## 5. 详细设计

### 5.1 前端内核 `js/core/wechat-format/`

三个文件，均为浏览器 ESM；`marked` 通过工厂注入而非直接引用全局，保证可在 node:test 中用 npm 版 marked 跑同一份代码：

```js
// engine.js
export function makeEngine({ Marked, Renderer, Tokens }) {
  // templates.js 的生成逻辑在此收口
  return { allTemplates, groupedTemplates, renderArticle, DEFAULT_TWEAKS };
}
// renderArticle(markdown, template, tweaks) => string（inline-style HTML）
```

- `templates.js`：逐行移植 `template-engine.ts` 中的 `colorPalettes`（6×12）、`names`（12 个中文模板名）、`categoriesList`、`hexToRgb/hexToRgba/getStyleValue/ensureStyleValue/getStylesByCategory/generateTemplates`，输出 `TemplateConfig` 同构对象（字段：id/name/desc/category/themeColor/backgroundColor/baseStyle + 各元素 style 串 + defaultH2Layout）。
- `render.js`：移植 `renderArticle` 全部自定义 Renderer（heading/paragraph/blockquote/list/strong/em/codespan/code/image/hr/link/table/tablecell/del/checkbox + 3 个 inline extension），保留 §2.2 列出的全部微信兼容技巧与注释。
- `DEFAULT_TWEAKS`（对齐上游 `FormatTweaks`）：

```js
{ fontSize: 15, lineHeight: 1.8, paragraphSpacing: 16, firstLineIndent: false,
  pagePaddingTop: 24, pagePaddingRight: 24, pagePaddingBottom: 24, pagePaddingLeft: 24,
  letterSpacing: 0, imageRadius: 8, themeColor: '', h1Layout: 'center', h2Layout: 'left' }
```

**marked 版本兼容**：vendor 为 v15.0.12，上游为 v17。两者的 `Marked`/`Renderer` 类 + token 参数签名（`token: Tokens.Heading` 等）+ `use({extensions})` API 一致；UMD 全局 `marked.Marked / marked.Renderer` 可直接注入。落地第一步先跑内核冒烟测试（§7）确认，若个别 renderer 行为有差异，以测试锁行为后做适配垫片。为测试环境把 `marked@15` 加入 `devDependencies`（仅 dev/test 使用，不进运行时）。

### 5.2 前端页面 `js/pages/format.js`

- `index.html`：侧边栏新增 `<a class="nav-item ..." data-page="format">`（图标 `data-lucide="paintbrush"`，文案「公众号排版」）；新增 `#page-format` 容器；`js/app.js` import 并挂 `window`（沿用现有模式）。
- 三栏布局（桌面）：
  - **左·编辑区**：`<textarea>` + 工具栏（移植 `use-markdown-tools.ts` 子集：H1-H3、加粗、斜体、引用、有序/无序列表、表格、链接、图片、代码块、分隔线、`==高亮==`/`^上标^`/`~下标~`）+ 字数统计 + 「AI 一键排版」「粘贴截图插入图片」；粘贴截图/本地插图沿用上游占位符机制：图片存内存 `Map`（`#img-N` → dataURL），Markdown 里写 `![描述](#img-N)`，渲染与同步前统一替换为 data URL，避免编辑区塞超长 base64；
  - **中·预览区**：手机框（max-width 378px 容器）内实时渲染；**展示前用 DOMPurify 消毒但保留 `style` 属性**（与 `renderMarkdown` 的 `FORBID_ATTR: ['style']` 相反，这里是自家引擎产物 + 仍禁 script/iframe/on* 事件），外链图片走既有 `proxyImage` 防热链失败；输入 300ms 防抖重渲染（72 模板渲染单次 <10ms，无性能压力）；
  - **右·设置区**：模板选择（6 分类 Tab × 12 模板缩略卡片，缩略图用各模板 `h1Style/h2Style/pStyle` 画 mini 预览）+ 自定义主题色（`themeColor` 覆盖，引擎已支持按分类重生成样式）+ 微调面板（字号/行高/段距/首行缩进/四向留白/字间距/图片圆角/H1H2 对齐）+ 「复制排版」「同步到草稿箱」按钮 + 同步结果提示。
- 偏好持久化：`localStorage`（键 `wf:templateId`、`wf:tweaks`、`wf:markdown` 草稿防丢），走 `js/state.js` 的 `LS` 约定。
- 复制实现：`navigator.clipboard.write([new ClipboardItem({'text/html': blob, 'text/plain': blob})])`；不支持 ClipboardItem 的浏览器降级「选中隐藏节点 + `document.execCommand('copy')`」（上游 `use-clipboard-copy.ts` 同思路）。
- **从创作流进入**：`creator.js` 改写结果区新增按钮「排版预览」→ `state.formatDraft = { title, markdown: rewriteResult }` + `gotoPage('format')`；`format.js` 渲染时优先取 `state.formatDraft`。同时支持从知识库/灵感条目「发送到排版」（复用 `core/itemCache.js` 的 sendToCreator 通道即可，v1 先做 creator 入口）。

### 5.3 AI 一键排版接口

路由 `lib/routes/mp-format.js` 分支一：

```
POST /api/_/mp-format/ai-layout        （需登录态）
req:  { markdown: string }             // ≤15000 字符，超出 400
resp: { ok: true, markdown: '排版结构优化后的 Markdown' }
       { ok: false, error: '…' }
```

- 服务端用 `llm.callLlm([{ role:'system', content: SYSTEM_PROMPT }, { role:'user', content: markdown }], { temperature: 0.3 })`。`lib/llm.js` 内部已做 SSE 聚合与三级超时（`llm-stream.js`），路由层拿完整文本即可，**无需自建 SSE**；前端用 loading 态替代流式（v1）。
- `SYSTEM_PROMPT` 全文移植上游（关键约束：不改写语义、不增删内容、仅修标题层级/空行/列表化/加粗/引用/分隔线、原样保留图片链接代码表格语法、只输出 Markdown），并追加一句 insprira 语境约束：「输出必须保持原文图片 URL 与数量不变」。
- 并发/预算：沿用 `lib/llm.js` 既有 semaphore 与用量记录，无新逻辑。

### 5.4 草稿箱同步（`lib/mp-publisher.js` + 路由）

模块骨架（`.make()` 工厂，依赖注入便于单测）：

```js
// lib/mp-publisher.js
function make({ mpOfficial, fetchImpl = fetch }) {
  // mpOfficial = lib/wechat-official.js 实例：getMpConfig / getAccessToken 复用
  async function syncDraft({ title, html, coverDataUrl, author = '', digest = '' }) {}
  async function diagnoseIp() {}            // 触发一次 token 获取，40164 时返回 err.ip
  return { syncDraft, diagnoseIp };
}
module.exports = { make };
```

`lib/wechat-official.js` 微重构：把 `getMpConfig`、`getAccessToken`、`mpError` 挂到导出对象上（当前在工厂内部，行为不变，仅暴露引用），`mp-publisher` 经注入复用同一 token 缓存（`local_data`，提前 5 分钟过期），避免双缓存重复刷 token。token 失效重试（40001/40014/42001）沿用其既有模式。

`syncDraft` 步骤（移植 `app/api/wechat/utils.ts`）：

1. 参数校验：`title` 1–64 字；`html` 非空；`coverDataUrl` 必填（草稿 API 必须有 `thumb_media_id`）；
2. **正文图片转存** `processHtmlImages`：正则 `/<img[^>]+src="([^">]+)"/gi` 提取，`data:image` 解 base64、`http(s)` 下载（8s 超时），逐张 `POST /cgi-bin/media/uploadimg` 换成微信 URL 回写 `src` 并补 `data-src`；单图失败跳过并记日志（不阻塞整篇）。**v1 不引入 sharp**：>1MB 的图返回可读错误「请压缩后重试」（uploadimg 硬限制 1MB、仅 jpg/png）；
3. **封面处理在浏览器端完成**（替代 sharp）：设置区封面控件读用户图片文件 → Canvas 裁剪/缩放到 900×383 → `toDataURL('image/jpeg', 0.85)`（通常 ≤300KB）→ 随请求传 `coverDataUrl`；服务端直接 `POST /cgi-bin/material/add_material` 换 `thumb_media_id`。零新增原生依赖；**用户未上传封面时沿用上游兜底逻辑：自动取正文第一张 `<img>` 的图作为封面源**（服务端从 html 提取首个 src，data:image 或 http 均可），仍无图则返回可读错误；
4. `POST /cgi-bin/draft/add`：`articles:[{ title, author, digest, content: html, thumb_media_id, need_open_comment: 0, only_fans_can_comment: 0 }]`，返回 `media_id`；`digest` 缺省取 Markdown 前 120 字符并剥离 `# * \` > [ ] ( )` 等符号（上游同规则）。

`diagnoseIp`：调 `mpOfficial.getAccessToken(true)`，成功 → `{ ok: true }`；抛错且 `err.ip` 存在 → `{ ok: false, ip: err.ip, code: 40164 }`，前端提示「将出口 IP x.x.x.x 加入白名单」并提供按钮直接调既有 `POST /api/_/mp-whitelist/start`（puppeteer 自动加白，dashboard 已有入口 `openMpWhitelistModal`，复用 UI 模式）。

路由组 `lib/routes/mp-format.js`（`tryRoute(req,res,url,ctx)` 模式，`ctx` 注入 `{ mpOfficial, mpPublisher, llm }`；`server.js` 在 `handleLocalApi` 中按既有写法接线，参考 924 行 mp-whitelist 的挂载方式）：

| 接口 | 方法 | 作用 |
|---|---|---|
| `/api/_/mp-format/ai-layout` | POST | AI 结构化排版（§5.3） |
| `/api/_/mp-format/config` | GET | 返回 `{ configured, appIdMasked, accountName }`（appSecret 绝不出后端） |
| `/api/_/mp-format/sync-draft` | POST | `{ title, html, coverDataUrl, author?, digest? }` → `{ ok, mediaId }` / `{ ok:false, error, ip? }` |
| `/api/_/mp-format/ip-diagnostic` | GET | 白名单诊断（§5.4） |

请求体上限沿用 `lib/http.js` 的 `MAX_BODY_SIZE`；`sync-draft` 另设 `html` ≤ 200KB 的软校验（公众号图文正文上限远小于此，防误传超大产物）。

三个接口全部在登录态之后（`/api/_/` 默认鉴权），**不新增任何公开接口**。

### 5.5 与现有功能的关系

- `js/utils.js` 的 `renderWechatArticle` 是**阅读侧**消毒器（展示抓取到的公众号文章），本功能是**发布侧**排版器，二者互不影响；方案落地后在 `renderWechatArticle` 注释中加一句指引避免后续混淆。
- creator 改写流（`doRewrite` → `rewriteResult`）是主要内容入口；「检查敏感词（inspectSensitiveHtml）→ 排版 → 进草稿」形成完整发布链路。
- `.env` 无新增键（复用 `MP_APP_ID/MP_APP_SECRET/MP_ACCOUNT_NAME`）；未配置时排版/复制/AI 排版可用，仅「同步草稿箱」按钮置灰并引导到设置页。

---

## 6. 安全与合规清单

1. `MP_APP_SECRET` 只存在于服务端进程；前端仅见脱敏 appId；同步在服务端完成（优于上游「凭证存浏览器 localStorage」的安全模型，属集成后的增强）；
2. 无新增公开接口；`ai-layout` 受 `llm.js` 预算与并发约束，防滥用；
3. 预览区消毒保留 `style` 但禁 `script/iframe/object/embed/form` 与 `on*` 属性；复制产物虽含原始 HTML，但其唯一去向是公众号编辑器，且引擎对代码块做了实体转义——在「复制」按钮 tooltip 说明产物未经消毒、请勿直接注入页面；
4. AGPL 合规三件套：文件头署名注释、`THIRD_PARTY_NOTICES.md`、功能页「关于」角注（含上游仓库链接与修改说明）；
5. 用户正文图片经服务器转存微信，日志中不打印图片内容只打印 URL 与结果。

---

## 7. 测试计划（node:test，遵循仓库既有策略）

新增 `marked@^15` 到 `devDependencies`（仅为内核测试提供与 vendor 同版实现）。

| 测试文件 | 引导 | 覆盖点 |
|---|---|---|
| `test/wechat-format-kernel.test.js` | 直接 `await import('../js/core/wechat-format/engine.js')` + `require('marked')` 注入 | ① 模板总数 72、6 分类各 12；② 产物无 `class=`、无 `<style>`、全部样式在 `style="`；③ 标题三层 section 嵌套；④ 列表 float 结构与清浮动；⑤ 同段多图触 发多排布局；⑥ 表格含 `bgcolor`；⑦ tweaks 生效（fontSize 落到容器、imageRadius 落到 img）；⑧ `==高亮==`/`^上^`/`~下~` 扩展；⑨ 代码块实体转义（`<script>` 不出现）；⑩ 6 分类 × 抽样色值快照断言（锁视觉回归基线）；⑪-⑭ 防爆栈护栏回归（定界符风暴与超深引用不再爆栈 / 畸形图片被修好 / dataURL 不进解析器且产物回填 / `renderArticleSafe` 降级纯文本） |
| `test/markdown-guard.test.js` | 纯函数，无依赖（没装 node_modules 也能跑） | ① dataURL 抽取与回填；② 畸形图片修复；③ 定界符折叠且不动代码；④ 嵌套封顶；⑤ 正常文档逐字节不变；⑥ 纯文本降级；⑦ 剥离 marked 的报错尾巴；⑧ 占位符补括号 |
| `test/frontend-utils-render.test.js` | `require('../vendor/marked.min.js')` 伪造浏览器全局 | ① 定界符风暴不再爆栈；② dataURL 渲染后回填；③ marked 抛错时降级为转义纯文本；④ 空内容/正常内容行为不变 |
| `test/mp-format.routes.test.js` | `test/_server.js`（随机端口 + 屏蔽密钥 env） | ① 未配置 MP_APP_ID 时 `sync-draft` 400 且错误文案含引导；② 未登录 401（默认鉴权路径）；③ `ai-layout` 空 markdown 400、>15000 字 400；④ `config` 返回脱敏结构 |
| 既有回归 | `npm test` 全量 | 确认 `wechat-official.js` 导出重构无行为变化（auth/routes 测试不动） |

门禁：`npm run check`（语法）+ `npm run build`（新页面 Tailwind class 编译）+ `npm test`。

---

## 8. 实施步骤（建议 4 个 PR，合计 3.5–5.5 人日）

**PR-1 内核 + 排版页（~2 天）**
1. 移植 `js/core/wechat-format/{templates,render,engine}.js`（含文件头署名）；
2. `js/pages/format.js` + `index.html` 页面容器/导航 + `js/app.js` 注册；
3. 三栏工作台：编辑/预览（消毒+防抖）/模板选择/微调面板/复制/偏好持久化；
4. devDependencies 加 marked@15；新增内核测试；`npm run build`。

**PR-2 AI 一键排版（~0.5–1 天）**
1. `lib/routes/mp-format.js`（ai-layout 分支）+ `server.js` 接线注入 `llm`；
2. SYSTEM_PROMPT 落地 + 输入上限 + 错误映射（复用 `llm.js` 错误语义）；
3. 前端按钮 + loading/失败 toast；路由测试。

**PR-3 草稿箱同步（~1–1.5 天）**
1. `lib/wechat-official.js` 导出 `getMpConfig/getAccessToken/mpError`（行为不变）；
2. `lib/mp-publisher.js`（图片转存 + 封面上传 + draft/add + diagnoseIp）；
3. 路由分支 + 前端「同步」弹窗（标题/作者/摘要/封面上传裁剪 + 诊断 + 结果）；
4. 路由测试（未配置/未登录/参数校验分支）。

**PR-4 收尾（~0.5 天）**
1. `THIRD_PARTY_NOTICES.md`、功能页署名角注、README 功能段落；
2. creator「排版预览」入口 + `state.formatDraft` 传递；
3. 全量回归 + 构建产物核对。

**验收标准**：示例 Markdown（§上游 sampleText 精简版）在 6 分类各抽 2 套模板下渲染 → 复制粘贴到公众号后台样式完整（人工验收一次）；配置 `.env` 后一键进草稿箱成功且正文图片均为 `mmbiz.qpic.cn` 域名；`npm test`/`npm run check`/`npm run build` 全绿。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| marked v15 vs v17 渲染行为差异 | 内核产物偏差 | 内核测试先行（§7①-⑩ 锁行为）；差异点做适配垫片；必要时升级 vendor/marked 并回归 `renderMarkdown` 相关测试 |
| marked 解析期栈溢出（页面报「Maximum call stack size exceeded Please report this to…」） | 预览区「渲染失败」、整页卡死 | **已修**：新增 `js/core/markdown-guard.js` 护栏——① dataURL 图片抽成短占位符、渲染后回填，几百 KB 的 base64 不进解析器；② 修畸形图片标签（未闭合补 `)`、alt 转义与截断、占位符补括号）；③ 超长定界符串（`******`/`====` 装饰线、被截断图片漏回正文的 URL）在非代码区转义为字面量；④ 引用/列表嵌套封顶；⑤ 渲染器递归深度封顶（超过 `MAX_INLINE_DEPTH` 输出 `token.raw` 纯文本）；⑥ `engine.renderArticleSafe` 解析异常降级纯文本并给出提示。回归见 `test/markdown-guard.test.js`、内核测试 ⑪-⑭、`test/frontend-utils-render.test.js` |
| 微信对上传图 >1MB 拒绝（无 sharp） | 同步失败 | 明确报错引导压缩；v2 可选服务端 sharp 或前端 Canvas 逐图压缩 |
| 外链图片下载失败（防盗链/超时） | 部分图未转存 | 预览侧已有 `proxyImage`；同步侧失败跳过并逐图提示，最终草稿仍可落箱 |
| 上游 AGPL 附加商用条款 | 商业化受限 | 本期非商用合规 + 署名齐全；商业化前替换实现或取得书面授权（记录在 THIRD_PARTY_NOTICES） |
| `wechat-official.js` 导出重构触及在用模块 | 数据同步回归 | 纯导出层变更 + 既有测试全量回归；不改任何函数体逻辑 |
| 72 模板 UI 渲染开销 | 设置区卡顿 | 缩略卡用 CSS 伪预览（不跑引擎）；引擎单次渲染 <10ms，主预览无压力 |
| 微信 API 变动（draft/uploadimg） | 同步失效 | 与上游同源逻辑，跟进上游 changelog 即可；接口层集中在 `mp-publisher.js` 单文件内 |

---

## 10. 附录

### 10.1 上游文件 → 本项目落点映射

| 上游 | 本项目落点 | 方式 |
|---|---|---|
| `app/template-engine.ts` | `js/core/wechat-format/templates.js` + `render.js` + `engine.js` | TS→JS 逐行移植 |
| `app/_types/formatter.ts`（FormatTweaks） | `engine.js` 内 JSDoc + `DEFAULT_TWEAKS` | 约定 |
| `app/api/wechat/utils.ts` | `lib/mp-publisher.js` | 逻辑移植（axios→fetch、sharp→浏览器 Canvas、40164→复用 mpError） |
| `app/api/wechat/sync/route.ts` | `lib/routes/mp-format.js` | 契约参考 |
| `app/api/ai-format/route.ts`（SYSTEM_PROMPT） | `lib/routes/mp-format.js` | 提示词移植 + 微调 |
| `app/_hooks/use-markdown-tools.ts` | `js/pages/format.js` 工具栏 | 子集移植 |
| `app/_hooks/use-clipboard-copy.ts` | `js/pages/format.js` 复制函数 | 思路一致重写 |
| 其余（React UI / worker / openrouter / 站点页） | — | 不移植 |

### 10.2 二期展望（不在本方案范围）

- 正文图片前端 Canvas 预压缩（彻底去掉 1MB 报错场景）；
- 排版历史版本（复用 SQLite 存 `{workId → html, template, tweaks}` 快照）与按作品回溯；
- 公众号已发表文章列表拉取，排版页一键「基于已发文改」；
- 图文多篇文章合并推送（draft/add `articles` 数组天然支持）；
- 从 tracker/文章诊断页把「表现好的文章」一键送回排版流再创作。
