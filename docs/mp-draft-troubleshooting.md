# 公众号草稿箱同步 · 排错手册

对应功能：排版页「同步到草稿箱」（P1-3）。链路是
`正文 HTML → 图片转存（media/uploadimg）→ 校验图片全在微信图床 → 封面转永久素材（material/add_material）→ 建草稿（draft/add）`。

## 一、先跑「IP 体检」

排版页右上角「**IP 体检**」会真打一次 `access_token` 接口：

- 显示「公众号接口连通正常」→ 凭据与白名单都没问题，后续报错就不是这方面原因。
- 显示「出口 IP x.x.x.x 不在白名单」→ 照提示去 **公众平台 → 设置与开发 → 基本配置 → IP 白名单** 追加这个 IP。
  注意：家宽/公司出口 IP 会变，换网络后要重新加；容器部署时是**宿主机出口 IP**，不是容器内网 IP。

## 二、常见错误码

| 现象 / errcode | 原因 | 处理 |
| --- | --- | --- |
| 未配置（`MP_NOT_CONFIGURED`） | `.env` 没填 `MP_APP_ID` / `MP_APP_SECRET` | 补齐后无需重启（`.env` 热加载），重进排版页即显示公众号状态 |
| `40164` invalid ip | 出口 IP 不在白名单 | 见上一节；报错信息里会带上被拒 IP |
| `40125` | AppSecret 不对（复制时多了空格/复制成了别的应用） | 重新复制公众平台「基本配置」里的 AppSecret |
| `41001` | 缺少 access_token：`MP_APP_ID`/`MP_APP_SECRET` 只填了一个 | 补齐两个变量 |
| `40001` / `40014` / `42001` | access_token 失效/过期（多为别处刷新导致） | 直接重试，本机会自动换新 token 并缓存（提前 5 分钟过期） |
| `53500` | 草稿接口权限不足 | 草稿箱接口要**认证号**（已认证的订阅号/服务号）；未认证号只能走「复制排版」手动粘贴 |
| `45009` | 当日接口调用超额 | 次日再试；避免反复点（已托管的图会自动跳过，不会重复占用配额） |
| `40007` | 封面 `media_id` 非法/素材已失效 | 重新同步（会重新上传封面素材） |
| 提示「正文里还有未替换的本地图片占位符」 | 排版页的本地截图（`#img-N`）还没解析成真实图片 | 等预览渲染完成再点同步；或先把图片换成 URL / 重新选择本地图片 |
| 提示「草稿必须带封面」 | 正文里没有图片，也没指定封面地址 | 在正文插入一张图，或用「按 URL 插入」加一张封面图 |
| 请求失败且正文很大 | 单次请求体上限 2MB（`lib/http.js` 的 `MAX_BODY_SIZE`） | 截图别太多/太大：改用外链图，或先用「复制排版」手动粘贴 |
| 提示「正文仍有 N 张图片不在微信图床」 | 转存后自查发现仍有非 `mmbiz.qpic.cn` 的图 | 属刻意保护（不发明知是破图的草稿）：把该图换成可访问的 http(s) 地址后重试 |
| 提示「正文 N 字符，超过微信上限 20000 字符」 | 微信按 `content` 字段的**字符数**算，内联样式也算 | 长文用「复制排版」手动粘贴（后台编辑器不受该接口限制），或减少模板装饰 |

## 二·五、官方字段上限（照 [draft/add 文档](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add) 核对过）

| 字段 | 上限 | 本工具的处理 |
| --- | --- | --- |
| `title` | **32 字** | 前端与后端都提前拦下（超了给明确字数） |
| `author` | **16 字** | 超长按码点截断 |
| `digest` | **120 字** | 超长按码点截断；不填则由正文纯文本自动生成（微信默认抓前 54 字，这里给到 120 字） |
| `content` | 少于 **2 万字符**、小于 1M | 超限直接 400 并说明「内联样式也计入」 |
| `content` 内图片 | 必须来自「上传图文消息内的图片获取 URL」接口，**外部图片 url 将被过滤** | 全部转存到微信图床后再复查一遍（H2）；已是 mmbiz 的图跳过上传 |
| `thumb_media_id` | 图文消息**必填**，且必须是**永久 MediaID** | 走 `material/add_material` 上传封面素材；未指定时取正文第一张图 |

## 三、行为边界（避免误解）

- **只创建草稿，不群发**：本功能不调用 `message/masssend` 之类的接口，草稿是否发布由你在后台决定。
- **取消按钮只停止浏览器侧等待**：图片可能仍在转存，稍后到草稿箱看结果；不会重复建草稿（转存完成前不会调 `draft/add`）。
- **图片只转存一份**：正文里已经是微信图床（`mmbiz.qpic.cn` / `szmmbiz.qpic.cn`）的图会跳过上传，不计入配额。
- **凭据不外泄**：`GET /api/_/mp-format/config` 只回报「配没配」，响应体里不含 `MP_APP_SECRET` 及其片段（有单测钉住）。
- **同期仍可手动复制**：`复制排版` 不受影响，草稿箱同步失败时它永远是可用的兜底路径。

## 四、一键排查命令

```bash
# 1) 配置是否存在（不打印 secret 本身）
docker compose exec insprira sh -c 'grep -c "^MP_APP_ID=" /app/.env; grep -c "^MP_APP_SECRET=" /app/.env'

# 2) 最近一次草稿同步的审计记录（P0-5 口径：action='mp-draft-sync'）
docker compose exec insprira node -e "const {db}=require('/app/lib/db');console.table(db.prepare(\"SELECT action,detail,created_at FROM action_logs WHERE action='mp-draft-sync' ORDER BY created_at DESC LIMIT 5\").all())"

# 3) 草稿是否建成功：到公众平台「草稿箱」列表页确认（本工具不回写草稿状态）
```

## 五、相关实现位置

| 关注点 | 文件 |
| --- | --- |
| 纯逻辑（图片收集/改写/校验、multipart、载荷、脱敏） | `lib/mp-publisher.js` |
| 错误归类与 40164 IP 提取 | `lib/mp-errors.js` |
| 三个路由（`config` / `ip-diagnostic` / `sync-draft`） | `lib/routes/mp-format.js` |
| 凭据与 token 缓存（复用官方 datacube 那一套） | `lib/wechat-official.js` |
| 前端按钮与状态 | `js/pages/format.js`、`index.html` |
| 单测（含 fake fetch 全链路） | `test/mp-publisher.test.js`、`test/mp-format.routes.test.js` |