# 第三方组件与外部接口声明

本文件列出「灵感熔炉」分发物中包含的第三方组件，以及运行时会调用的外部服务与相应注意事项。
项目自身以 [AGPL-3.0](LICENSE) 发布。

## 一、代码移植（AGPL 传染性最强的部分）

| 位置 | 来源 | 许可证 | 说明 |
| --- | --- | --- | --- |
| `js/core/wechat-format/` | [mspringjade/wechat-formatter](https://github.com/mspringjade/wechat-formatter) | **AGPL-3.0** | 公众号排版内核（模板、微调、渲染管线）为**移植**代码，非本项目原创；上游同为 AGPL-3.0，与本项目许可证兼容。修改该目录后如需分发，请同样以 AGPL-3.0 提供源码。 |

## 二、`vendor/` 下的前端第三方库（静态文件，不经 npm）

| 文件 | 组件 | 许可证 |
| --- | --- | --- |
| `vendor/marked.min.js` | [marked](https://github.com/markedjs/marked) | MIT |
| `vendor/purify.min.js` | [DOMPurify](https://github.com/cure53/DOMPurify) | Apache-2.0 或 MPL-2.0 |
| `vendor/chart.umd.min.js` | [Chart.js](https://github.com/chartjs/Chart.js) | MIT |
| `vendor/lucide.min.js` | [Lucide](https://github.com/lucide-icons/lucide) | ISC |
| `vendor/manrope-latin.woff2` | [Manrope](https://github.com/sharanda/manrope) | OFL-1.1 |

## 三、npm 依赖

| 包 | 许可证 | 用途 |
| --- | --- | --- |
| `better-sqlite3` | MIT | 本地 SQLite 存储 |
| `puppeteer-core` | Apache-2.0 | 驱动用户本机 Chrome（公众号控制台自动化，不含浏览器本体） |
| `tailwindcss`（dev） | MIT | 编译前端样式产物 |

## 四、外部服务（运行时调用，均需用户自备凭据）

| 服务 | 用途 | 注意 |
| --- | --- | --- |
| 微信公众平台开放接口 | `datacube` 官方阅读数据、`cgi-bin/media/uploadimg` 图片转存、`cgi-bin/material/add_material` 永久素材、`cgi-bin/draft/add` 草稿创建 | 需**认证号**与 `MP_APP_ID` / `MP_APP_SECRET`，且调用方出口 IP 必须在公众平台 **IP 白名单**内。使用者须遵守《微信公众平台开发者服务协议》与平台运营规范；本工具**只创建草稿、不群发**，是否发布、是否标注 AI 生成内容由使用者自行判断并承担合规责任 |
| RedFox API | 热榜聚合、爆款搜索、封面生成 | 第三方商业数据服务，需自备 `REDFOX_API_KEY`，数据版权与使用范围以对方条款为准 |
| OpenAI 兼容 LLM 服务 | 选题、改写、诊断、AI 排版 | 需自备 `LLM_*` 配置；调用产生的费用与内容合规由使用者承担 |
| Obsidian / Notion / WeRss | 知识库三源接入 | 分别受各自服务条款约束；Notion 凭证在本机以 `KB_ENCRYPTION_KEY` 做 AES-256-GCM 加密后入库 |

## 五、数据与隐私

- 所有业务数据（`data/cache.db`、`data/skills/`、公众号控制台登录态 `data/mp-console-profile/` 等）都存放在**本机**，项目不设任何自带的上报通道。
- `.env`、`cookies.json`、`data/` 均为本地敏感文件，已在 `.gitignore` 中排除，请勿提交或分享。
- 公众号相关凭据只从 `.env` 读取，接口响应中**不会**回传 `MP_APP_SECRET`（见 `GET /api/_/mp-format/config` 的脱敏实现与对应单测）。