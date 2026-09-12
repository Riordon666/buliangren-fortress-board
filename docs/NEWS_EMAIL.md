# 木叶快报邮件订阅

## 开通顺序

1. 在 `https://mail.riordon.xyz/` 创建专用发件账号 `naruto@riordon.xyz`，或将该地址添加到一个现有账号下。该账号必须拥有站外发信权限和足够的日额度。网站调用的是专用服务接口，不保存邮箱登录密码，也不使用邮箱管理员的公开 API Token。
2. 更新网页版邮箱的 Worker，按该仓库的 `doc/KONOHA_MAIL_API.md` 配置专用发送接口。邮箱当前使用的 Cloudflare Email / Resend 发信通道保持不变。
3. 在要塞网站运行目录 `/www/wwwroot/buliangren-runtime/.env.production` 配置下列四项。`NEWS_MAIL_API_TOKEN` 与邮箱 Worker 的 `KONOHA_MAIL_API_TOKEN` 必须一致；`NEWS_SUBSCRIPTION_SECRET` 使用另一段独立随机值。

```dotenv
NEWS_MAIL_API_URL=https://mail.riordon.xyz/api/integrations/konoha/send
NEWS_MAIL_API_TOKEN=替换为专用随机密钥
NEWS_SUBSCRIPTION_SECRET=替换为另一段独立随机密钥
NEWS_PUBLIC_URL=https://naruto.riordon.xyz
```

在服务器终端分别执行两次 `openssl rand -hex 32`，将结果保存在对应的环境配置中，不要提交到 Git。保留 `NEWS_SUBSCRIPTION_SECRET`，否则已经发出的确认和退订链接会失效。密钥只在服务端使用，不进入浏览器。

4. 按原有成品包流程部署要塞网站，并在宝塔重启 Node 项目。`.env.production` 由部署脚本保留，SQLite 与新闻缓存继续使用持久化绝对路径。
5. 用自己控制的收件邮箱在快报页订阅，检查确认邮件的 From 为 `naruto@riordon.xyz`，点击邮件链接后再点击网页上的确认按钮。之后检测到新内容时才发送更新提醒；不会为刚订阅的人群发当前旧一期。真实发信验证需由站点管理员指定测试收件邮箱。

## 通知行为

- 不要求组织账号登录。只有邮箱拥有者确认后，才加入后续快报通知。
- 沿用既有的腾讯检查时段：北京时间周二 15:00–20:00 每 5 分钟，周三 15:00–20:00 每 1 分钟，取得本周新一期后停止当周自动检查。手动刷新发现新内容也会触发通知。
- 邮件程序只核对本站已经保存的快报和本地待发任务，不另外轮询腾讯。首次开启功能或首次取得缓存仅建立基准。
- 以图片内容指纹识别新一期。版本编号变更、重复手动检查、源站暂时失败，不会为同一内容反复发送通知。
- 每位订阅者单独一封，包含更新说明、内嵌快报图片、网页完整阅读入口及退订入口。长图会适配邮件显示和体积限制；邮件客户端也可能要求用户允许显示图片。
- 订阅记录和待发任务保存在同一 SQLite 数据库，随现有数据库备份保留。进程重启后继续处理待发任务，不依赖有人打开页面。
- 发送任务使用稳定的幂等键。邮箱接口已接收但本站超时时，重试同一任务会查询或复用原发送结果。若邮箱端已开始发信但无法确定结果，任务停止自动重发，保留待核对状态，避免收件人收到重复邮件。
- 每封提醒都可退订。邮件链接的 GET 请求只展示确认页，实际订阅/退订需点击按钮后 POST，避免邮箱自动预览链接误操作。

## 部署与排查

两个项目都需要更新：只部署要塞网站、未配置邮箱专用 API，不能完成发信。要塞网站的配置缺失时显示提醒未开放，不会接收邮箱后假报发送成功。

先确认发件账号存在、未被禁用，并有站外发信权限和额度；再检查两端专用密钥一致。可在邮箱网站的已发送记录以及要塞网站的队列状态中核对。接口接受发送不等于收件箱已送达，退信、垃圾箱和接收方拦截仍需通过现有邮箱服务查看。

开发测试必须使用假的发信适配器或本地接收器，不能把真实订阅列表用于测试群发。

只读检查订阅及发送队列（汇总计数，不显示邮箱地址或链接）：

```bash
cd /www/wwwroot/buliangren-runtime
node --env-file=.env.production scripts/news-mail-status.mjs
```

`sent` 表示邮箱 API 已接受，不代表已进入收件箱；`unknown` 表示发送结果需要核对，程序不会自动重复发信。`queued` 会按重试时间继续处理，`cancelled` 已停止。日志只记录失败类别，不打印订阅邮箱、邮件内容或密钥。

状态汇总中的 `retries` 会显示尝试次数及错误类别。先按类别定位，不需要公开密钥、订阅地址或邮件链接：

| 错误类别 | 检查方向 |
| --- | --- |
| `provider-authorization` | 两端专用密钥、邮箱 API 的访问限制 |
| `provider-network-dns` | 服务器 DNS 解析 |
| `provider-network-timeout` | 服务器到邮箱 API 的连接或响应超时 |
| `provider-network-tls` | HTTPS 证书、证书链和系统时间；保留证书校验 |
| `provider-network-connection` | 连接被拒绝、断开或网络不可达 |
| `provider-redirect` | API 地址是否正确、反向代理是否把请求重定向；发送程序不跟随跳转 |
| `provider-request-header` | 密钥是否误填了中文说明文字、换行等非法请求头字符 |
| `provider-network` | 旧版记录或未能进一步分类的请求错误，需从服务器复查连接 |
| `provider-unavailable` | 邮箱 API 暂不可用 |
| `local-preparation-failed` | 应用日志、数据库权限与邮件内容准备 |

错误分类不改变任务的幂等键、退避重试和发送状态。程序只保存固定分类，不保存原始网络报错中的地址或请求头。

订阅接口使用 `X-Real-IP` 做来源限流。Nginx 反向代理应由服务器覆写它：

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

缺少可信来源地址时，所有未知来源共用每小时限额。即使来源地址被伪造，独立的单邮箱与全站限流仍会生效。无需把此接口开放跨域。

## 服务器直连邮箱 API 超时时

如果服务器直连返回 `UND_ERR_CONNECT_TIMEOUT`，而同机已有 Mihomo 代理可以访问邮箱 API，可配置 `NEWS_MAIL_PROXY_URL=socks5h://用户名:密码@127.0.0.1:端口`。用户名和密码必须分别做 URL 编码；只在服务器受保护的环境文件中保存，不要粘贴到聊天、命令参数或 Git。

该配置仅作用于木叶快报的邮件 API，使用代理端 DNS，保持 HTTPS 证书校验与原站点名称。网站其他请求、腾讯快报检查周期、Mihomo 监听与账号均不修改。不配置该项仍使用原来的直连方式。

本项目提供本机配置助手，适用于已有 `/etc/mihomo/local-settings.json`（根级 `port`、`username`、`password`）的服务器。先停止宝塔 Node 项目并按原成品包流程部署新版本，再在宝塔终端以 root 执行：

```bash
cd /www/wwwroot/buliangren-runtime
node scripts/configure-news-mail-proxy.mjs --apply
```

助手在服务器本地读取现有代理凭据，通过 curl 标准输入传递代理与 API 认证，不输出密码，也不把凭据放入进程参数。它使用空 JSON、没有收件人和任务编号的探针验证连接与认证，不发送邮件。只有拿到专用 API 预期的校验响应后，才备份 `.env.production` 并写入邮件专用代理；原有环境变量、文件属主和权限保留。不要放宽 Mihomo 设置文件的权限给网站用户。

写入后，助手只提前已有 `queued` 且因网络失败推迟的任务的下次尝试时间；不改变任务编号、内容、尝试次数，不重发 `sent`、`unknown` 或 `cancelled` 的记录。启动或重启宝塔 Node 项目后，后台继续处理这些任务。运行 `node --env-file=.env.production scripts/news-mail-status.mjs` 检查 `sent` 是否增加，并让收件人确认收到邮件。

不带 `--apply` 时只验证连接。若助手报告代理已通但 API 认证失败，核对两端邮件专用密钥；不要重置订阅签名密钥。