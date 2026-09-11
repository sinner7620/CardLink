# 修复 MinerU OCR 持续轮询

## 变更目的

修复题目准备使用 MinerU OCR 时，即使服务端已经完成解析，界面仍长期停留在“轮询中”的问题，并让服务端失败和异常响应能够及时反馈给用户。

## 根因与 API 依据

- MinerU 当前批量结果接口 `GET /api/v4/extract-results/batch/{batch_id}` 将单文件结果放在 `data.extract_result` 数组内。
- 原实现只读取 `data.file_results` 或 `data.results`，因此官方 `done` 响应会被误判为空结果，继续轮询直到超时。
- 官方结果项以 `state` 表示 `waiting-file`、`pending`、`running`、`failed`、`converting`、`done` 等状态，并通过 `full_zip_url` 返回完成任务的下载地址。

## 已实现行为

- 新增独立 MinerU 响应解析模块，优先读取官方 `data.extract_result`，同时保留两个历史字段作为兼容回退。
- 识别 `done` 后立即进入结果下载；若已完成但没有 `full_zip_url`，立即报告异常而不是继续轮询。
- 识别 HTTP 成功响应内的非零业务错误码，以及结果项的 `failed/error` 状态和 `err_msg`。
- 轮询详情显示中文任务状态；存在 `extract_progress` 时显示已解析页数/总页数。
- 连续 5 次没有任何结果项时终止并提示响应缺少 `data.extract_result`，防止响应结构异常造成假死。
- 结果优先按 `data_id` 回对原图，也支持按 `file_name` 回对；仅有单个输入和单个结果时提供无歧义回退。

## 影响文件与模块

- `src/mineru-response.ts`：MinerU 官方/历史响应字段解析、终态、错误与进度摘要。
- `src/ai-subsystem.ts`：创建任务业务错误检查、轮询终止条件、进度显示及结果回对。
- `tests/ai-subsystem.test.ts`：官方完成响应、业务错误、失败原因、缺下载地址和状态进度回归测试。
- `package.json`、`RELEASE_NOTES_v2.4.1b6.md`：版本与发布说明。

## 兼容与数据影响

- 版本升级为 `2.4.1b6`；`mnChannel` 保持 `stable`，正式插件 ID 和标题不变。
- 不修改错题、OCR 缓存或已准备题目文本的数据结构，不需要数据迁移。
- 历史 MinerU 字段仍可读取；异常响应现在会更早结束任务并显示原因。

## 验证

- MinerU 定向测试：通过，39/39。
- `pnpm check`：通过。
- `pnpm test`：通过，227/227。
- `pnpm build`：通过；保留现有 `.sfIconGlyph:svg` 非法伪类警告，不影响产物生成。
- 正式构建产物 `dist/CardLink-v2.4.1b6.mnaddon`：573,454 字节。
- 已复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b6.mnaddon`；源文件和交付副本 SHA-256 均为 `809583BD9AF6B8B08216B37FA29D197AFD77765958324BDAE1660DD0E5E3D959`。
- 包内 `mnaddon.json` 已确认正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b6`。

## 未验证限制

- 当前环境没有用户的 MinerU Token，无法发起真实线上任务；已使用与官方文档一致的响应样例覆盖轮询终态和异常分支。
