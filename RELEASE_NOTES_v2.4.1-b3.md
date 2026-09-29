# CardLink v2.4.1-b3

## 更新说明

- 支持在答案卡片中显示 `marginnote4app://markdownimg/<格式>/<资源哈希>` 形式的 Markdown 图片。
- 插件通过 MarginNote 媒体库读取图片并以内嵌资源显示，不依赖卡片 WebView 直接加载应用内协议。
- Markdown 导出会将此类图片写入压缩包的 `assets` 目录，避免导出后留下无法在外部打开的应用内地址。

## 兼容性与限制

- 支持 PNG、JPEG/JPG、GIF 和 WebP 路径；资源必须仍存在于当前 MarginNote 数据库中。
- 普通 MarginNote 卡片跳转链接继续使用既有解析逻辑，不会被当成图片。
- 保持 `stable` 渠道、ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`。

## 验证与交付

- `pnpm check`、`pnpm test`（245/245）和 `pnpm build` 通过。构建保留既有 `.sfIconGlyph:svg` CSS 警告。
- 包内已确认版本 `2.4.1-b3`、正式插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`；安装包为 578,362 bytes。
- 已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1-b3.mnaddon`。
- 复制件与 dist 原包 SHA-256 一致：`643DFBF54B8C2A2A8E5BD8F2C68523A724DC22F86F44EE555E1863239717D8DD`。
