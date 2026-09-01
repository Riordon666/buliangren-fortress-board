# QQ Bot 只读事实 API v1

本文档描述专供 QQ Bot 调用的版本化事实接口。它只负责从“不良人要塞战报”读取稳定、可验证的结构化事实，不调用大模型，也不接受任何写入或管理操作。

- Base URL：`https://naruto.riordon.xyz/api/bot/v1`
- OpenAPI 3.1：[`openapi/bot-api-v1.yaml`](../openapi/bot-api-v1.yaml)
- 运行时：Next.js Route Handler，Node.js runtime，动态响应
- 时区：`Asia/Shanghai`
- 调用链：QQ → NapCat → OneBot 11 Reverse WebSocket → NoneBot2 → 自定义插件/Service → 本 API → 只读 SQLite

## 1. 安全边界

### 1.1 真正只读

Bot API 使用独立的 SQLite 连接，并同时启用：

- `readonly: true`
- `fileMustExist: true`
- `PRAGMA query_only = ON`
- 只读事务

它不调用网站常规的 `getDb()`，所以不会触发自动发包确认、扣包顺延、迁移、初始化或其他维护副作用。六个端点只有事实读取；`POST /members/lookup` 使用 POST 只是为了提交严格限制的昵称查询正文，仍然不会修改数据。其他 HTTP 方法统一返回 `405 METHOD_NOT_ALLOWED`。

排行榜、上海时区当前周选择、发包算法和冻结快照合并均复用网站现有纯逻辑，不维护第二套算法。

### 1.2 周可见性

API 只查询 `published` 和 `locked` 周：

- `draft` 不会出现在周列表中。
- `current` 只会从可见周中按 `Asia/Shanghai` 当前日期选择。
- 即使知道 draft 的正整数 ID，summary 和 leaderboard 仍返回 `404 NOT_FOUND`。
- 历史趋势与发包周期同样过滤 draft。

### 1.3 字段白名单

允许返回的业务字段仅包括：

- 周：`weekId`、`title`、`eventDate`、`status`
- 成员稳定引用：`memberId`、`displayName`
- 战绩：`rank`、`score`、40/60 分资格布尔值
- 发包：查询日期、周期、位置、轮次、是否已发
- 汇总：人数、参赛人数、总分、平均分、最高分、资格人数、已发天数
- 趋势：成员在可见周中的历史排名、分数和资格结果

严禁返回：

- `username`
- 密码、密码哈希
- session、Token、Token hash
- 用户角色、账号类型、管理员身份
- `mustChangePassword`
- `lastSeenAt`、在线状态
- 删除状态
- 用户备注
- 头像服务器存储路径
- 审计内容
- 扣包敏感明细
- SQL 错误、异常堆栈、服务器内部路径

OpenAPI 响应对象均以 `additionalProperties: false` 固定白名单。重名错误最多返回 5 个候选，并且候选只有 `memberId` 与 `displayName`。

## 2. 鉴权与 Secret

所有端点都必须携带 Bearer Token：

```http
Authorization: Bearer ${BOT_API_TOKEN}
```

上面的 `${BOT_API_TOKEN}` 只是脱敏占位符，不是可用凭据。

网站不保存原始 Token，只保存其 SHA-256 十六进制摘要：

```dotenv
BOT_API_TOKEN_SHA256=<64位SHA-256十六进制摘要>
```

要求：

- 原始 Token 必须由高强度安全随机源生成。
- 网站 `.env.production` 只能放 64 位摘要，禁止放原始 Token。
- 原始 Token 只保存在 QQ Bot 服务器的受保护 Secret/环境变量中。
- 原始 Token 不得进入 Git、网站环境变量、文档、测试快照、终端历史、访问日志或应用日志。
- 应用对请求 Token 求 SHA-256 后使用恒定时间比较。
- 缺少或错误 Token 返回相同的安全 `401`；服务端摘要缺失或格式错误返回安全 `503`。
- 不复用网站 Cookie、成员账号或密码。

### 2.1 人工 Secret 检查点

生产发布必须在以下时点暂停：

1. 代码、本地测试、Git commit、GitHub Actions Linux Release 均已完成。
2. 尚未运行生产部署脚本，尚未做带有效 Token 的外部验证。
3. 由运维人员在可信终端生成原始 Token，自行完成安全传递。
4. 网站现有 `/www/wwwroot/buliangren-runtime/.env.production` 写入的只能是 `BOT_API_TOKEN_SHA256`。
5. QQ Bot 服务器的受保护配置写入原始 Token，文件权限应仅允许服务账号读取。
6. 运维人员确认完成后，才能继续部署、启动与外部验证。

不要把原始 Token 发给开发代理，也不要粘贴到聊天中。

### 2.2 协调轮换

v1 只接受一个摘要，因此轮换是协调切换，不存在新旧 Token 的长期并行窗口：

1. 在可信终端生成新 Token；暂时保留旧 Token 以便短时回滚。
2. 将新原始 Token 安全写入 Bot 服务器的 Secret 存储，但先不要在日志中输出。
3. 停止网站 Node 项目，将网站摘要替换为新摘要并启动。
4. 立即重启/重载 Bot 服务，使其读取新原始 Token。
5. 从 Bot 服务器验证 `200`、`401`、`404`，确认 `requestId` 可追踪。
6. 成功后销毁旧 Token；失败则同时恢复网站旧摘要和 Bot 旧 Token，不能只回滚一端。

轮换期间可能有数秒 `401`，Bot 应按短退避重试，不应降级为无鉴权调用。

## 3. 限流、响应和日志

### 3.1 限流

- 每 Token 持续速率：60 次/分钟，即每秒补充 1 个额度。
- 突发容量：10 次。
- 当前为单实例 Node 进程内 Token Bucket；本项目生产部署为单实例。
- 超限返回 `429 RATE_LIMITED`，并携带整数秒 `Retry-After`。
- Bot 应等待 `Retry-After` 后再重试，并避免多个群消息同时重复查询同一事实。

### 3.2 响应上限与安全头

- 单个 JSON 响应最大 128 KiB（131072 字节）。
- 超限或 JSON 序列化失败统一转换为小型 `503 SERVICE_UNAVAILABLE`。
- 所有响应带 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff` 和 `X-Request-Id`。
- API 不发送 `Access-Control-Allow-Origin: *`；它不是浏览器公共接口。

成功信封：

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "apiVersion": "v1",
    "timezone": "Asia/Shanghai",
    "generatedAt": "2026-09-01T12:00:00.000Z",
    "requestId": "5b61a180-c953-4e0c-aefa-2b7e365309f8"
  }
}
```

错误信封：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "参数不正确"
  },
  "meta": {
    "requestId": "5b61a180-c953-4e0c-aefa-2b7e365309f8"
  }
}
```

### 3.3 安全日志

Nginx 和应用日志不得记录 `Authorization` 或 `/members/lookup` 请求正文。Nginx 日志格式不得包含 `$http_authorization`、`$request_body` 或其他请求头/正文展开；建议只记录 `$request_method`、`$uri`、状态码、耗时和服务端生成的请求 ID。不要使用 `curl -v`、`set -x` 或会回显请求头的调试模式验证生产 Token。

所有流量必须经过 HTTPS；80 端口只做 HTTPS 跳转。Token 不能代替 TLS。

可以在 Nginx 的 `/api/bot/v1/` location 额外限制 QQ Bot 固定公网 IP `139.155.147.108`：

```nginx
location ^~ /api/bot/v1/ {
    allow 139.155.147.108;
    deny all;

    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Token 鉴权仍必须保留。如果域名前还有 Cloudflare/CDN，必须先正确配置可信代理与 Real IP，并确认 Nginx 实际看到的来源地址确为 `139.155.147.108`，否则不要直接启用上述 allowlist。

## 4. 业务语义

- 排名使用竞赛排名：同分示例为 `11、11、13`。
- 第一轮资格：`score >= 40`。
- 第二轮及以后资格：`score >= 60`。
- 发包周期为周六至下一周六，共 8 天，每天最多 5 个位置。
- 第一轮不应用扣包；第二轮及以后由现有算法应用已排入该周的扣包，但 API 不返回扣包明细。
- 已确认发包的日期只读取冻结快照；不会用后来变化的分数重新计算名单。历史状态缺少快照时不回退到当前算法。
- 未确认日期使用当前网站发包算法计算。
- 周六可能同时属于上一周期第 8 天和新周期第 1 天，因此 `packages.cycles` 可能同时返回两个周期，并按周期起始日期升序排列。
- 成员昵称查询先 trim，再做 NFKC 规范化，随后精确匹配；不做模糊猜测。
- 无结果返回 `404 NOT_FOUND`；重名返回 `409 AMBIGUOUS_MEMBER`。Bot 只能用安全候选说明存在重名并停止本次查询；v1 不支持按 `memberId` 重查，绝不能自行猜测身份。

## 5. 端点与脱敏示例

以下示例名称和 ID 均为虚构数据。所有请求都必须带 `Authorization`，示例中不出现原始 Token。

### 5.1 `GET /health`

请求：

```http
GET /api/bot/v1/health HTTP/1.1
Host: naruto.riordon.xyz
Authorization: Bearer ${BOT_API_TOKEN}
```

响应：

```json
{
  "ok": true,
  "data": { "healthy": true },
  "meta": {
    "apiVersion": "v1",
    "timezone": "Asia/Shanghai",
    "generatedAt": "2026-09-01T12:00:00.000Z",
    "requestId": "11111111-1111-4111-8111-111111111111"
  }
}
```

### 5.2 `GET /weeks?limit=12`

`limit` 可省略，默认和最大值均为 12；只接受一个 `limit`，范围 `1..12`。未知、重复或非整数参数返回 400。

```http
GET /api/bot/v1/weeks?limit=12 HTTP/1.1
Authorization: Bearer ${BOT_API_TOKEN}
```

```json
{
  "ok": true,
  "data": {
    "weeks": [
      { "weekId": 42, "title": "示例统计周", "eventDate": "2026-09-05", "status": "published" },
      { "weekId": 41, "title": "示例历史周", "eventDate": "2026-08-29", "status": "locked" }
    ]
  },
  "meta": {
    "apiVersion": "v1",
    "timezone": "Asia/Shanghai",
    "generatedAt": "2026-09-01T12:00:00.000Z",
    "requestId": "22222222-2222-4222-8222-222222222222"
  }
}
```

### 5.3 `GET /weeks/{weekRef}/summary`

`weekRef` 只能是小写 `current` 或正整数周 ID。该端点不接受查询参数。

```http
GET /api/bot/v1/weeks/current/summary HTTP/1.1
Authorization: Bearer ${BOT_API_TOKEN}
```

```json
{
  "ok": true,
  "data": {
    "week": { "weekId": 42, "title": "示例统计周", "eventDate": "2026-09-05", "status": "published" },
    "summary": {
      "memberCount": 30,
      "participantCount": 28,
      "totalScore": 2480,
      "averageParticipantScore": 89,
      "topScore": 192,
      "firstRoundEligibleCount": 26,
      "laterRoundEligibleCount": 17,
      "sentPackageDays": 3,
      "totalPackageDays": 8,
      "packagesPerDay": 5
    },
    "eligibilityThresholds": {
      "firstRoundMinScore": 40,
      "laterRoundsMinScore": 60
    }
  },
  "meta": {
    "apiVersion": "v1",
    "timezone": "Asia/Shanghai",
    "generatedAt": "2026-09-01T12:00:00.000Z",
    "requestId": "33333333-3333-4333-8333-333333333333"
  }
}
```

### 5.4 `GET /weeks/{weekRef}/leaderboard?limit=30`

`limit` 可省略，默认和最大值均为 30，范围 `1..30`。

```http
GET /api/bot/v1/weeks/42/leaderboard?limit=30 HTTP/1.1
Authorization: Bearer ${BOT_API_TOKEN}
```

```json
{
  "ok": true,
  "data": {
    "week": { "weekId": 42, "title": "示例统计周", "eventDate": "2026-09-05", "status": "published" },
    "entries": [
      {
        "memberId": 101,
        "displayName": "示例成员甲",
        "rank": 1,
        "score": 192,
        "firstRoundEligible": true,
        "laterRoundsEligible": true
      },
      {
        "memberId": 102,
        "displayName": "示例成员乙",
        "rank": 2,
        "score": 53,
        "firstRoundEligible": true,
        "laterRoundsEligible": false
      }
    ]
  },
  "meta": {
    "apiVersion": "v1",
    "timezone": "Asia/Shanghai",
    "generatedAt": "2026-09-01T12:00:00.000Z",
    "requestId": "44444444-4444-4444-8444-444444444444"
  }
}
```

### 5.5 `POST /members/lookup`

请求必须为 `application/json` 且正文不超过 4 KiB。对象必须严格只有 `query` 和可选 `historyLimit`：

- `query`：trim 后 NFKC 长度 `1..40`
- `historyLimit`：整数 `1..12`，默认 8

```http
POST /api/bot/v1/members/lookup HTTP/1.1
Content-Type: application/json
Authorization: Bearer ${BOT_API_TOKEN}

{
  "query": "示例成员甲",
  "historyLimit": 8
}
```

```json
{
  "ok": true,
  "data": {
    "member": { "memberId": 101, "displayName": "示例成员甲" },
    "history": [
      {
        "weekId": 42,
        "title": "示例统计周",
        "eventDate": "2026-09-05",
        "status": "published",
        "rank": 1,
        "score": 192,
        "firstRoundEligible": true,
        "laterRoundsEligible": true
      }
    ]
  },
  "meta": {
    "apiVersion": "v1",
    "timezone": "Asia/Shanghai",
    "generatedAt": "2026-09-01T12:00:00.000Z",
    "requestId": "55555555-5555-4555-8555-555555555555"
  }
}
```

重名时：

```json
{
  "ok": false,
  "error": {
    "code": "AMBIGUOUS_MEMBER",
    "message": "存在多个同名成员",
    "details": {
      "candidates": [
        { "memberId": 101, "displayName": "同名示例" },
        { "memberId": 205, "displayName": "同名示例" }
      ]
    }
  },
  "meta": {
    "requestId": "66666666-6666-4666-8666-666666666666"
  }
}
```

### 5.6 `GET /packages?date=YYYY-MM-DD`

`date` 必填，必须是真实存在的公历日期且严格使用 `YYYY-MM-DD`。未知或重复查询参数返回 400。

```http
GET /api/bot/v1/packages?date=2026-09-05 HTTP/1.1
Authorization: Bearer ${BOT_API_TOKEN}
```

周六双周期响应示例：

```json
{
  "ok": true,
  "data": {
    "date": "2026-09-05",
    "cycles": [
      {
        "week": { "weekId": 41, "title": "上一周期", "eventDate": "2026-08-29", "status": "locked" },
        "isSent": true,
        "assignments": [
          {
            "memberId": 101,
            "displayName": "示例成员甲",
            "position": 1,
            "round": 2,
            "rank": 1,
            "score": 192,
            "firstRoundEligible": true,
            "laterRoundsEligible": true
          }
        ]
      },
      {
        "week": { "weekId": 42, "title": "新周期", "eventDate": "2026-09-05", "status": "published" },
        "isSent": false,
        "assignments": [
          {
            "memberId": 108,
            "displayName": "示例成员乙",
            "position": 1,
            "round": 1,
            "rank": 2,
            "score": 153,
            "firstRoundEligible": true,
            "laterRoundsEligible": true
          }
        ]
      }
    ]
  },
  "meta": {
    "apiVersion": "v1",
    "timezone": "Asia/Shanghai",
    "generatedAt": "2026-09-05T12:00:00.000Z",
    "requestId": "77777777-7777-4777-8777-777777777777"
  }
}
```

没有匹配周期时仍返回 200，`cycles` 为 `[]`。

## 6. 错误码

| HTTP | code | 固定安全消息 | 说明 |
| ---: | --- | --- | --- |
| 400 | `INVALID_ARGUMENT` | 参数不正确 | 路径、查询、JSON、Content-Type、大小或严格字段校验失败 |
| 401 | `UNAUTHORIZED` | 未授权访问 | Authorization 缺失、格式错误或 Token 不匹配 |
| 404 | `NOT_FOUND` | 未找到请求的资源 | 周/成员不存在，或目标周是 draft |
| 405 | `METHOD_NOT_ALLOWED` | 请求方法不允许 | 响应包含 `Allow` |
| 409 | `AMBIGUOUS_MEMBER` | 存在多个同名成员 | 最多返回 5 个安全候选，不猜测身份 |
| 429 | `RATE_LIMITED` | 请求过于频繁，请稍后重试 | 响应包含 `Retry-After` |
| 500 | `INTERNAL_ERROR` | 服务内部错误 | 不返回异常 message、SQL、堆栈或路径 |
| 503 | `SERVICE_UNAVAILABLE` | 服务暂时不可用 | Secret 配置错误、只读 DB 不可用、快照不完整或响应超限 |

## 7. NoneBot2 调用约定

- 为 Bot API 使用独立 Service，不把网站 Cookie 或 QQ 消息原文当作鉴权凭据。
- 只在群成员明确 @机器人并提出要塞查询时调用。
- 设置短连接超时和总超时；六个端点语义只读，可在网络失败时有限重试。
- 收到 429 必须遵守 `Retry-After`。
- 收到 409 应说明存在重名并停止本次查询；v1 没有按 `memberId` 重查入口，不能由 AI 猜测或自动续查。
- 收到 404 不应伪造答案；draft 与不存在对 Bot 都是不可见。
- 记录 `requestId`、端点名、HTTP 状态和耗时即可；不得记录 Authorization 或完整昵称查询正文。
- AI 只能整理 API 已返回的事实，不得补造分数、排名、资格或发包结果。

## 8. 部署与回滚

### 8.1 部署

`main` 推送后，GitHub Actions 使用 Node 24.13.0 构建 Linux x86_64 standalone Release。生产服务器不安装依赖、不执行 `npm run build`。

人工 Secret 检查点完成后：

1. 在宝塔停止 Node 项目，确认 3001 不再监听。
2. 确认现有 `/www/wwwroot/buliangren-runtime/.env.production` 已包含摘要变量，且没有原始 Token。
3. 执行：

```bash
cd /www/wwwroot/buliangren-fortress-board
git pull --ff-only
bash scripts/deploy-latest.sh
```

4. 脚本校验 SHA-256、Git commit、Node 版本与 CPU 架构，保留 `.env.production`，把上一版放在 `/www/wwwroot/buliangren-runtime.previous`。
5. 宝塔启动命令保持：

```bash
env PORT=3001 HOSTNAME=127.0.0.1 node server.js
```

6. 先验证源站健康，再从 QQ Bot 服务器做外部 200/401/404 验证。

当前部署版本以 `/www/wwwroot/buliangren-runtime/BUILD_COMMIT` 为准。发布包固定标签是 `deploy-latest`，但审计与回滚必须记录实际 commit SHA，不能只记录标签。

### 8.2 回滚

部署脚本只在目录替换本身失败时自动恢复；它不会因为 Node 启动或 HTTP 健康失败自动回滚，而且只保留一个 `.previous`。

1. 宝塔停止 Node 项目。
2. 明确检查以下两个绝对目录：

```bash
test -d /www/wwwroot/buliangren-runtime
test -d /www/wwwroot/buliangren-runtime.previous
test ! -e /www/wwwroot/buliangren-runtime.failed-api-v1
```

3. 保留失败版本并恢复上一版：

```bash
mv /www/wwwroot/buliangren-runtime /www/wwwroot/buliangren-runtime.failed-api-v1
mv /www/wwwroot/buliangren-runtime.previous /www/wwwroot/buliangren-runtime
```

4. 宝塔重新启动并验证。不要删除数据库、上传目录或失败版本。若本次轮换了 Token，网站摘要和 Bot 原始 Token 必须一起回滚。

## 9. 外部 200 / 401 / 404 验证模板

验证必须从 QQ Bot 服务器 `139.155.147.108` 发起。已知该服务器具备 `curl` 和到网站的 HTTPS 出站能力。

### 9.1 无 Token 的 401

该命令不包含 Secret：

```bash
curl -sS -o /tmp/bot-api-401.json \
  -w 'status=%{http_code}\n' \
  https://naruto.riordon.xyz/api/bot/v1/health
```

期望：`status=401`，正文 `error.code=UNAUTHORIZED`。

### 9.2 有效 Token 的 200 与 404

先由运维人员让当前安全 shell 通过受保护 Secret 存储获得 `BOT_API_TOKEN`；不要把值直接写入命令、聊天或历史。确保没有启用 `set -x`。下面 Node 模板只输出状态码、错误码和 `requestId`，不会输出请求头：

```bash
node <<'NODE'
const token = process.env.BOT_API_TOKEN;
if (!token) throw new Error("BOT_API_TOKEN is not available in this secure shell");

const base = "https://naruto.riordon.xyz/api/bot/v1";
for (const path of ["/health", "/weeks/2147483647/summary"]) {
  const response = await fetch(base + path, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  console.log(JSON.stringify({
    path,
    status: response.status,
    code: body.error?.code ?? null,
    requestId: body.meta?.requestId ?? null
  }));
}
NODE
```

期望：

- `/health` → 200
- 不存在的正整数周 ID → 404
- 如需证明 draft 隐藏，再用已知 draft ID 替换该不存在 ID，仍应是 404；证据中不要记录 draft 标题或内部数据。

验证结束后清除交互 shell 中的 Secret，并删除临时响应文件。证据只保留时间、来源服务器、路径、状态、错误码和 `requestId`。

## 10. 测试与最终交付记录

本地验证命令：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

以下记录区分已经在本地完成的验证与仍需生产 Secret、部署后才能执行的验证。Git commit 和 Release 版本以最终交付信息及服务器上的 `BUILD_COMMIT` 为准，文档本身不写入其所在 commit，避免自引用：

| 检查项 | 实际结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd test` | 通过：5 个测试文件、68 个测试；本次运行时间 2026-09-01 21:28:16，耗时 1.71 秒 |
| `npm.cmd run build` | 通过：Next.js 16.3 webpack 低内存构建；6 个 Bot API 路由均为 dynamic |
| Git commit SHA | 以最终交付信息与 `BUILD_COMMIT` 为准（文档不自引用） |
| GitHub Linux Release / BUILD_COMMIT | 推送后由 GitHub Actions 生成，并在最终交付信息中核验 |
| 已部署 Base URL | `https://naruto.riordon.xyz/api/bot/v1`（目标地址，待 Secret 检查点后部署） |
| 外部 200 | 尚未执行：等待 Secret 配置与部署 |
| 外部 401 | 尚未执行：等待 Secret 配置与部署 |
| 外部 404 | 尚未执行：等待 Secret 配置与部署 |

生产 Secret 未由用户完成配置前，开发代理必须停在人工检查点，不得生成、读取或输出原始 Token，也不得伪造外部验证结果。
