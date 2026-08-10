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
