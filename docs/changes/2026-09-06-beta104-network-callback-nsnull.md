# v2.3.3-beta.104 网络回调 NSNull 修复

## 变更目的

修复错题总结在模型分析阶段进度超过 60% 后失败并显示 `[object NSNull]` 的问题。此前只归一化了响应 JSON 内的 `NSNull`，遗漏了 `NSURLConnection` 成功回调会用 `NSNull` 表示“无错误”的运行时行为，导致成功响应被误判为失败。

## 已实现行为

- 在 AI 原生网络边界统一识别 JavaScript `null`、`undefined` 与 Foundation `NSNull`。
- 只有回调 `error` 不是原生空值时才按真实网络错误拒绝请求。
- 对 `response`、`data`、HTTP 状态码和原生错误描述分别判空，避免任何 `NSNull` 进入业务层或被直接字符串化。
- 保留响应 JSON 的递归 `NSNull` 归一化，确保模型正文、API 测试结果及错误结构都使用普通 JavaScript 值。
- 新增回归约束，禁止恢复为 `if (error)` 这一会误判 `NSNull` 的写法。

## 影响文件或模块

- `src/ai-subsystem.ts`
- `tests/ai-subsystem.test.ts`
- `package.json`
- `RELEASE_NOTES_v2.3.3-beta.104.md`

## 兼容性与数据影响

- AI 配置结构、凭据、错题数据和已有报告格式均不变，无需迁移。
- 插件继续使用正式通道 `mnChannel: "stable"`；`-beta` 仅用于预发布版本匹配与遥测标签。
- 对真实 `NSError` 仍返回其本地化错误信息；仅纠正“无错误”占位 `NSNull` 的判定。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，210/210。
- `pnpm build`：通过；保留一条既有的 Lightning CSS `.sfIconGlyph:svg` 伪类警告，不影响产物生成。
- 已检查产物中的 `AnswerMatcherCore.js`：网络完成回调先以原生空值谓词判断 `error`，并对 `response`、`data` 与状态码执行边界判空。
- 已复制 `dist/mn4-answer-matcher-v2.3.3-beta.104.mnaddon` 到 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.104.mnaddon`。
- 源文件与复制文件 SHA-256 均为 `3413EA8D89A02EE71FA0FE2E9E9288C22B23468BE1BD23A290BFF5FF7A06941A`，校验一致。

## 未验证限制

- 当前环境无法直接运行 MarginNote iOS 原生网络回调；已通过边界实现审计、回归测试与构建产物检查覆盖该路径，仍建议在真机用实际模型账号执行一次错题总结和 API 测试。
