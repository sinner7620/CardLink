# CardLink v2.4.1

## 当前说明

- 已确认插件在软件内显示为“未认证”属于 MarginNote 软件端问题，并非 CardLink 安装包认证异常；需等待后续软件更新修复。

## 更新说明

- 支持将脑图绑定手写合并至 OCR 图片。
- 优化 CardLink 缓存与文件目录，兼容旧数据迁移。
- 修复 MinerU 持续轮询、结果回对及 Markdown 读取闪退。
- 修复待复习批量展开题目时卡在“正在读取题目”的问题。

## 数据与兼容性

- 既有错题、复习记录、答案索引和报告格式保持兼容。
- 旧 OCR 文本可继续读取；旧记录若没有原题 JPG，需要重新 OCR 后才能显示图片对照。
- “脑图绑定手写”默认关闭，不会因升级自动扩大外发内容范围。
- 使用正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink` 和 `stable` 构建渠道。

## 验证

- `pnpm check`：通过。
- `pnpm test`：233/233 通过。
- `pnpm build`：通过；存在一条与本轮无关的既有 `.sfIconGlyph:svg` CSS 选择器警告。
- 正式安装包 `dist/CardLink-v2.4.1.mnaddon`：576,311 bytes。
- 已复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1.mnaddon`；源文件与交付副本 SHA-256 均为 `1EB1F2B0F6135EFE71FD56EF87CD06F9CE97EA9E8448A6B9384A719CCD1F7173`。
- 包内 `mnaddon.json` 已确认版本 `2.4.1`、正式插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`。

## 未验证限制

- MinerU、GLM-OCR 的真实线上请求、目录迁移与脑图绑定手写仍需在配置有效密钥的 MarginNote 4 真机环境端到端复验。
