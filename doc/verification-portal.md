# 验证码邮件查看页

入口：https://mail.rxkflo.tech/verify

访客只输入 `@` 前的邮箱名称。所有已创建且未删除的 rxkflo.tech
邮箱（包括管理员邮箱）均可查询；知道名称的人即可阅读，无访客身份验证。
未创建的地址与未独立创建的 `+` 别名不会自动开放。

只公开最近 30 分钟、接收完成、未删除、经过本地规则确认的验证码邮件。
本地规则优先保守处理；日期、订单号、多个冲突的码、纯验证链接、纯字母码及
不明确的语境可能不展示。它不是能够准确识别所有服务商模板的分类器。
正文以完整文字呈现；不提供 HTML 执行、附件或远程图片。

## 接口

- `POST /api/verify/list`：`{ "name": "alice", "cursor": "可选的上页游标" }`
  返回 `{ email, messages, nextCursor, serverTime }`，每页最多 20 封。
- `POST /api/verify/detail`：`{ "name": "alice", "emailId": 123 }`
  返回 `{ email, message, serverTime }`。每次重新检查完整邮箱归属、分类与时间。
- 摘要包含 `emailId, subject, sender, senderName, createTime, code`；详情另含 `body`。
- 时间窗按服务端 UTC 收信时间判断；前端按浏览器时区显示时间。
- 无匹配地址或邮件时列表为空，详情为 404；输入错误 400、限流 429、关闭或服务异常 503。
- 接口无缓存、不返回管理字段或其他收件人，不接收账户 ID 或全库查询选项。

## 发布与回退

1. 执行 `pnpm --dir mail-worker exec vitest run --config vitest.webhook.config.mjs`。
2. 执行 rxkflo 配置的 Wrangler dry run，验证前端和 Worker 构建。
3. **先升级 D1 再发布代码**：调用 `ensureVerificationSchema(db)` 或先检查
   `PRAGMA table_info(email)`，缺少时执行
   `ALTER TABLE email ADD COLUMN is_verification INTEGER NOT NULL DEFAULT 0`；
   索引语句见 `mail-worker/src/init/verify-schema.js`。原邮件与账户不变。
4. 用现有 GitHub Actions 发布；已有初始化步骤会幂等升级索引，并分批回填当时
   最近 30 分钟的邮件。后续新邮件在外部与站内收信路径同步分类。
5. 检查 `/verify`、一个无匹配地址的查询、原登录页及收信路由。

`wrangler-rxkflo.jsonc` 中的 `VERIFY_PORTAL_ENABLED` 为总开关。设为字符串
`"false"` 并按现有流程发布即可关闭公开查询；也可在 Cloudflare 修改同名变量并发布。
恢复旧 Worker 版本时无需删除新增数据库字段或索引。

`VERIFY_RATE_LIMITER` 每 IP 每分钟约 60 次，采用 Cloudflare 原生限流绑定；计数
属于 Cloudflare 数据中心维度，不是全球严格配额。缺少绑定时接口拒绝查询。
异常日志仅记录事件名称，不记录邮箱、验证码、邮件正文或请求体。

注意当前 `mail-worker` 的 `npm test` 是历史部署命令，不是测试命令。
