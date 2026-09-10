# 不良人要塞战报

3767区 2组“不良人”的要塞分数统计与成员管理网站。项目使用 Next.js、TypeScript 和 SQLite，默认开发数据包含 30 名组员及第一期分数。

## 本地启动

```powershell
npm.cmd install
$env:INITIAL_PASSWORD = Read-Host "输入用于初始化空数据库的临时密码"
npm.cmd run dev
```

浏览器访问 `http://localhost:3000`。

组员默认直接使用游戏昵称作为登录账号，具体初始口令只应在内部通知，不要写入公开仓库。首次登录必须修改密码。管理员可以在后台添加/停用账号、自定义临时密码、录入或导入每周分数并管理发包状态。

## 页面与功能

- 要塞分数：完整排名、横向柱状、分数梯度、贡献占比、分数分布、组织雷达
- 发包安排：8天日期浏览、自动轮次、每日名单冻结、已发状态、扣包累计与跨周顺延
- 发包确认权限：首领和备注为“高层”的成员账号可确认当天发包；高层仅能确认已发布或已锁定统计周，无管理后台权限。确认后保留操作人、审计记录和冻结名单，同一天不会重复确认。
- 个人信息：头像上传、个人战绩概览、修改密码
- 管理后台：新增/停用成员、重置密码、网站在线状态、统计周草稿/发布/锁定、分数批量编辑、表格导入、操作审计
- 并列名次使用竞赛排名规则，例如 `11、11、13`
- 在线表示 90 秒内正在使用本网站，不代表游戏内在线

## 数据与备份

默认情况下，SQLite 数据库位于 `data/naruto-fortress.db`，上传头像位于 `public/uploads/`。生产环境可以参考 `.env.example`，通过 `DATABASE_PATH`、`UPLOAD_DIR`、`BACKUP_DIR` 和 `REPORT_CACHE_DIR` 使用独立持久化目录。

运行在线备份：

```powershell
npm.cmd run backup
```

备份会同时保存 SQLite 在线备份和头像，并默认保留最近 14 份；不会直接复制正在写入的 WAL 文件。

## 验证

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

视觉回归脚本使用本机 Microsoft Edge：

```powershell
node scripts/visual-check.mjs
```

截图输出位于 `artifacts/visual-check/`。

## 部署提示

推荐以单实例 Node.js 方式部署，并在前面配置 Nginx 与 HTTPS。生产环境若找不到数据库会直接停止启动，以防误建空库；请先上传现有数据库，或仅在确实要初始化全新站点时设置 `ALLOW_DATABASE_INIT=1` 和至少 8 位的 `INITIAL_PASSWORD`。不要部署到本地磁盘会随请求重置的纯 Serverless 环境；如果将来需要多实例横向扩容，应把 SQLite 迁移到 PostgreSQL。

### 低内存服务器更新

`main` 分支推送后，GitHub Actions 会使用 Linux x86_64 与 Node 24.13.0 构建 standalone 成品，并更新固定的 `deploy-latest` Release。服务器不再安装依赖或执行 Next.js 构建。

先在宝塔停止 Node 项目，然后执行：

```bash
cd /www/wwwroot/buliangren-fortress-board
git pull --ff-only
bash scripts/deploy-latest.sh
```

脚本会校验 SHA-256、源码与成品提交、Node 版本和 CPU 架构，然后安全替换 `/www/wwwroot/buliangren-runtime`，保留 `.env.production` 和一个固定的上一版本目录。完成后回到宝塔启动 Node 项目。SQLite、上传头像、备份与战报缓存必须继续通过绝对路径保存在源码目录或其他持久化目录中。

## 木叶快报

公开导航中的 `/news` 无需登录。服务端从腾讯短链读取活动发布版本，安全解析配置中的活动长图，在本站以原图展示；不执行源站脚本，不需要登录腾讯，也不依赖人工上传。本期源站使用长图，而非 PDF。

- 生产 Node 服务启动后每 30 秒检查源站版本；阅读中的页面也每 30 秒获取同步结果，重新切回页面时立即核对。正常情况下约一分钟内跟进新发布，另受源站/CDN及网络延迟影响，无法保证零延迟。
- “快报更新了，但这里还是旧的？立即刷新”通过 `POST /api/news` 立即重读入口、配置和长图，绕过本站检查间隔。同一实例只允许一个手动刷新进行，重复请求有 5 秒冷却。
- 已成功同步的内容保存在磁盘。源站被拦截、返回验证页或图片下载失败时，继续展示上一期并提示暂时无法核对，不会用错误内容覆盖缓存。首次同步失败则显示重试和原文入口。
- `NEWS_CACHE_DIR` 可选，默认使用 `DATABASE_PATH` 所在目录下的 `news-cache/`。现有部署使用持久化数据库绝对路径时无需新增配置；保留此目录即可跨发布、重启保留快报。
- 源站目前是静态长图配置；若后续改成 PDF 或其他交互布局，需要适配解析器。页面会保留上一期并提示读取失败。

快报单独视觉验证（需先启动网站，默认端口 3102）：

```powershell
node scripts/visual-check-news.mjs
```
