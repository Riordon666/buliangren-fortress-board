# 不良人要塞战报

3767区 2组“不良人”的要塞分数统计与成员管理网站。项目使用 Next.js、TypeScript 和 SQLite，默认包含 30 名组员及第一期分数。

## 本地启动

```powershell
npm.cmd install
npm.cmd run dev
```

浏览器访问 `http://localhost:3000`。

- 管理员账号：`九天惊落`
- 所有账号初始密码：`7891666`
- 首次登录必须修改密码

组员默认直接使用游戏昵称作为登录账号。管理员可以在后台添加新账号、停用账号、重置密码、录入每周分数和发包轮次。

## 页面与功能

- 要塞分数：完整排名、横向柱状、排名折线、贡献占比、分数分布、组织雷达
- 个人信息：头像上传、个人战绩概览、修改密码
- 管理后台：新增/停用成员、重置密码、网站在线状态、新建统计周、分数批量编辑、操作审计
- 并列名次使用竞赛排名规则，例如 `11、11、13`
- 在线表示 90 秒内正在使用本网站，不代表游戏内在线

## 数据与备份

SQLite 数据库位于 `data/naruto-fortress.db`，上传头像位于 `public/uploads/`。这两个目录在部署时都需要持久化磁盘。

运行在线备份：

```powershell
npm.cmd run backup
```

备份会写入 `data/backups/`，不会直接复制正在写入的 WAL 文件。

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

推荐以单实例 Node.js 或 Docker 方式部署，并在前面配置 Caddy/Nginx 与 HTTPS。不要部署到本地磁盘会随请求重置的纯 Serverless 环境；如果将来需要多实例横向扩容，应把 SQLite 迁移到 PostgreSQL。
