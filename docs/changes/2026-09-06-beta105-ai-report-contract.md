# v2.3.3-beta.105 AI 报告契约与解析修复

## 变更目的

修复模型请求已经成功、错题总结进入保存阶段后提示“AI 未返回有效报告”的问题。DeepSeek Chat Completions 分支此前只要求 JSON object，却没有把报告字段结构发送给模型，因此模型可能返回合法 JSON 但使用中文字段或自选层级，本地无法识别。

## 已实现行为

- 将完整报告 JSON Schema 作为明确提示发送给所有模型，DeepSeek 也会收到固定字段名、嵌套结构和纯 JSON 输出要求。
- 抽离可独立测试的报告协议模块，统一 OpenAI Responses、Chat Completions 和兼容服务的正文提取。
- 正文兼容字符串、内容数组、`parsed`/`json` 结构化结果、Markdown JSON 代码围栏、外围说明文字和 JSON 字符串二次编码。
- 报告解析兼容 `report`、`mistake_report`、`分析报告` 等包装层，以及常见英文蛇形字段和中文字段。
- 数组条目兼容规范对象与简化字符串；证据字段继续进入既有 Q 编号真实性校验。
- 无法识别时返回“非有效 JSON”或实际顶层字段名，不再只显示笼统的“AI 未返回有效报告”。

## 影响文件或模块

- `src/ai-report.ts`
- `src/ai-subsystem.ts`
- `tests/ai-subsystem.test.ts`
- `package.json`
- `RELEASE_NOTES_v2.3.3-beta.105.md`

## 兼容性与数据影响

- 不修改 AI 设置、凭据、错题库、OCR 缓存或已保存报告的数据结构，无需迁移。
- OpenAI 继续使用 Responses JSON Schema；DeepSeek 继续使用 Chat Completions JSON object，并额外获得显式 Schema 提示。
- 插件继续构建正式通道 `mnChannel: "stable"`。

## 验证

- 报告解析定向测试：通过，包含代码围栏、中文字段、嵌套包装、三类正文载荷及诊断错误。
- `pnpm check`：通过。
- `pnpm test`：通过，213/213。
- `pnpm build`：通过；保留一条既有的 Lightning CSS `.sfIconGlyph:svg` 伪类警告，不影响产物生成。
- 已检查 `AnswerMatcherCore.js`，固定 Schema、报告包装/别名兼容与 `response_format` 均已进入正式产物。
- 已复制 `dist/mn4-answer-matcher-v2.3.3-beta.105.mnaddon` 到 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.105.mnaddon`。
- 源文件与复制文件 SHA-256 均为 `BA9E4A6A1E7A869FBD67E89808FAFC5470E0D3056EC883991E4AB434185CD0DD`，校验一致。

## 未验证限制

- 当前环境不能使用用户的实际模型凭据发起真机请求；交付后仍建议在 MarginNote 中执行一次 API 测试和错题总结。
