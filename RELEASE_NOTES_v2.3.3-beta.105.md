# MN4 Answer Matcher v2.3.3-beta.105

## 修复

- 修复模型请求成功后提示“AI 未返回有效报告”：DeepSeek 现在也会收到完整报告 JSON Schema。
- 兼容 Responses、Chat Completions 和兼容服务的字符串、数组及结构化正文。
- 兼容 JSON 代码围栏、嵌套报告、英文蛇形字段与常见中文字段。
- 报告格式仍异常时显示具体解析阶段或实际字段，便于继续诊断。

## 验证

- TypeScript 检查通过。
- 全量自动化测试通过（213/213）。
- 正式插件构建通过，并确认 Schema 与兼容解析逻辑进入产物。
- 构建产物已复制至 iCloud 同步目录；源文件与副本 SHA-256 均为 `BA9E4A6A1E7A869FBD67E89808FAFC5470E0D3056EC883991E4AB434185CD0DD`。

## 未验证限制

- 自动化环境不能使用用户实际 API Key 执行真机模型请求。
