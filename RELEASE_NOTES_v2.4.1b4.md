# CardLink v2.4.1b4

## 新增

- 题目识别设置新增 OCR 引擎选择，可在 MinerU 与智谱 GLM-OCR 之间切换。
- GLM-OCR 使用官方文档解析接口，直接提交整张题目卡片的 JPG Base64，并读取返回的 Markdown 文本。
- GLM-OCR 支持独立 API 地址、独立 API Key、本次运行保存与本地保存。
- 题目准备任务会固定启动时选择的 OCR 引擎，任务进行中修改设置不会让同一批题目混用引擎。

## 安全与缓存

- GLM-OCR 单张图片在发送前执行 10 MB 上限校验。
- MinerU 与 GLM-OCR 使用不同的 OCR 缓存键，切换引擎不会误读另一引擎的结果。
- 本地题目快照记录实际使用的服务与模型；AI 总结仍只发送已准备的题目文本。

## 兼容性

- 旧设置默认继续使用 MinerU，不需要迁移。
- 保持正式插件 ID、标题、稳定渠道及现有错题/题目文本数据结构兼容。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，224/224。
- `pnpm build`：通过；保留现有 `.sfIconGlyph:svg` 非法伪类警告，不影响产物生成。
- 正式构建产物：`dist/CardLink-v2.4.1b4.mnaddon`，571,663 字节。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b4.mnaddon`。
- 两份文件 SHA-256 均为 `6F7836A566A1C9884A295D7D1F77FC9AAAC088828ADF445CBB2CAB8F9FAEAA9B`。
- 包内清单确认：正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b4`。

## 未验证限制

- 尚需使用真实智谱 API Key 在 MarginNote 4 真机环境验证 GLM-OCR 网络调用与识别质量。
