# MN4 Answer Matcher v2.3.3-beta.104

## 修复

- 修复错题总结进度超过 60% 后返回 `[object NSNull]`：MarginNote 成功网络回调中的 `NSNull error` 现在按“无错误”处理。
- 统一清理 AI 网络回调中的 `response`、`data`、状态码、错误描述与响应 JSON 原生空值，防止 `NSNull` 再泄漏到界面。
- API 测试与错题总结共用同一修复后的请求边界。

## 验证

- TypeScript 检查通过。
- 全量自动化测试通过（210/210）。
- 正式插件构建通过；构建产物已复制至 iCloud 同步目录。
- 源文件与复制文件 SHA-256 一致：`3413EA8D89A02EE71FA0FE2E9E9288C22B23468BE1BD23A290BFF5FF7A06941A`。

## 未验证限制

- 自动化环境不能模拟 MarginNote iOS 的 Objective-C 桥接对象；建议安装后用实际模型账号各执行一次 API 测试与错题总结。
