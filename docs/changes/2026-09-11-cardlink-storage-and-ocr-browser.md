# 统一 CardLink 存储并加入 OCR 结果对比

## 变更目的

统一插件产生的本地文件目录，持久保存 OCR 实际输入图片，并让用户在插件内逐题核对原题卡片与 OCR 文本。

## 已实现行为

### OCR 图片与单题快照

- 旧实现仅在 Web 内存中预览整卡 JPG，OCR 完成后只保存文字；脑图绑定手写没有单独落盘，也没有保存合成后的卡片图片。
- 新实现于 OCR 成功后保存实际上传的整卡 JPG，因此图片内容与服务商收到的内容一致。
- 脑图绑定手写仍先与题目卡片合成为一张图片；不额外复制 MarginNote 原始笔迹媒体，避免重复占用空间。
- 每题文本快照升级为 schema 2，新增图片文件、MIME、是否包含脑图手写和手写项数元数据。
- 单题 JSON 与 JPG 均以 `sha256(recordId)` 命名；重复识别同一道题会原位更新。

### OCR 结果浏览器

- 新增 `aiListPreparedQuestions`，只返回轻量题目摘要，不在列表加载时跨桥发送全部图片。
- 新增 `aiGetPreparedQuestion`，用户选中题目后才读取一张 JPG 并返回图片 data URI 与完整 OCR 文本。
- “缓存与报告”显示 API 缓存数、已准备题目数和报告数，并提供题目选择器。
- 对比区左侧显示发送给 OCR 的整卡图片，右侧安全渲染 OCR Markdown 文本。
- 历史 schema 1 快照继续可读；缺少图片时显示重新 OCR 提示。

### 统一目录

- 文档持久目录：`CardLink/ai/ocr`、`CardLink/ai/content/records`、`CardLink/ai/content/images`、`CardLink/ai/reports`、`CardLink/backups`、`CardLink/exports`。
- 缓存目录：`CardLink/indexes`。
- 临时目录：`CardLink/temp/ocr`、`CardLink/temp/logs`、`CardLink/temp/updates`、`CardLink/temp/pdf-runtime`、`CardLink/temp/pdf-cache`。
- 旧 `MNAnswerMatcher/` 文档目录在首次访问时复制到 `CardLink/`，确认目标存在后再移除旧目录。
- 文档根目录的三份错题库备份、缓存根目录的学习集索引按文件迁移；失败时保留旧文件，避免迁移丢数据。
- NSUserDefaults 内的设置、凭据引用和错题主状态属于 MarginNote 键值存储，不是文件目录，保持现有兼容键。

## 影响文件与模块

- `src/storage-paths.ts`：CardLink 文档、缓存、临时路径和保守迁移。
- `src/ai-subsystem.ts`：整卡图片保存、schema 2 快照、OCR 浏览查询和清理。
- `src/mistake-store.ts`、`src/index-store.ts`、`src/mistake-export.ts`：备份、索引和导出目录统一。
- `src/note-navigation.ts`、`src/updater.ts`、`rails-native/WebBridgeCommands.js`：日志、更新和 PDF 临时目录统一。
- `src/rails-core.ts`：新增 OCR 浏览桥命令。
- `web/src/main.jsx`、`web/src/ui/settings.css`：逐题原图/文本对比界面。
- `tests/ai-subsystem.test.ts`、`tests/index-store-behavior.test.ts`、`tests/domain.test.ts`、`tests/mistake-export.test.ts`、`tests/updater-behavior.test.ts`、`tests/web-bridge.test.ts`：存储、迁移和浏览器回归覆盖。

## 兼容与数据影响

- 版本升级为 `2.4.1b8`；`mnChannel` 保持 `stable`，正式插件 ID 和标题不变。
- OCR 文本读取兼容 schema 1 和 schema 2，不需要重新识别才能继续用于 AI 总结。
- 旧快照没有可恢复的输入图片，因此只能显示文字；重新 OCR 后会补齐 schema 2 JSON 和 JPG。
- “清空 OCR”会同时删除服务商响应缓存、题目文本快照和已保存整卡图片，不删除 AI 报告。

## 验证

- 定向测试：通过，103/103。
- `pnpm check`：通过。
- `pnpm test`：通过，231/231。
- `pnpm build`：通过；Vite/Lightning CSS 报告一条既有 `.sfIconGlyph:svg` 非法伪类警告，但成功生成安装包。
- 正式构建：`dist/CardLink-v2.4.1b8.mnaddon`，575,760 bytes。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b8.mnaddon`。
- 源文件与交付副本 SHA-256 一致：`81DE52AFB6D6423211958030E6DC1A984F43F299865DC6C9A8F32ED607263857`。
- 包内清单核验：正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b8`。

## 未验证限制

- 当前环境无法访问用户 iPad 的 MarginNote 沙盒，目录迁移和图片回传需要真机复测。
- 单次只读取选中题目的图片以限制桥接负载；极高分辨率长卡片仍可能需要数 MB 的 WebBridge 传输。
- 构建中发现既有 `.sfIconGlyph:svg` 选择器警告，本轮未改动该无关样式。
