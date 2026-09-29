# CardLink v2.4.1b6

## 修复

- 修复 MinerU OCR 已完成后仍持续轮询的问题：批量查询现在读取官方返回字段 `data.extract_result`，不再只依赖旧版兼容字段。
- 轮询状态会显示等待入队、排队、解析中、格式转换、完成等状态；MinerU 返回页数进度时同步显示已解析页数。
- MinerU 返回业务错误、解析失败原因、完成但缺少结果下载地址时立即停止，并在单题进度中显示具体错误。
- 连续 5 次收到缺少结果数组的异常响应时停止轮询，避免接口结构异常导致长时间假死。

## 兼容性

- 保留对历史 `data.file_results` 和 `data.results` 响应字段的兼容。
- 解析结果优先按 `data_id` 回对；官方响应未返回 `data_id` 时可按 `file_name` 回对，单文件任务还有无歧义回退。
- OCR 本地缓存和已准备题目文本的数据结构不变。

## 验证

- `pnpm check`：通过。
- MinerU 定向测试：通过，39/39。
- `pnpm test`：通过，227/227。
- `pnpm build`：通过；保留现有 `.sfIconGlyph:svg` 非法伪类警告，不影响产物生成。
- 正式构建产物：`dist/CardLink-v2.4.1b6.mnaddon`，573,454 字节。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b6.mnaddon`。
- 两份文件 SHA-256 均为 `809583BD9AF6B8B08216B37FA29D197AFD77765958324BDAE1660DD0E5E3D959`。
- 包内清单确认：正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b6`。

## 未验证限制

- 当前环境没有用户的 MinerU Token，尚未对真实线上批量任务执行端到端验证。
