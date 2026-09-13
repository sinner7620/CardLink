# MarginNote Markdown 图片兼容与 2.4.1-b3 交付

## 目的

让答案卡片中的 `marginnote4app://markdownimg/<格式>/<资源哈希>` Markdown 图片能在 CardLink 预览中显示，并能随 Markdown 错题本导出。

## 实现行为

- Markdown 渲染识别 MarginNote 4 的 `markdownimg` 地址，通过现有媒体解析器按哈希读取图片，转换为带 `data-media-id` 的内嵌图片。
- TextNote 的应用内链接过滤允许受支持的 `markdownimg` 图片通过；普通卡片链接及其他应用内 URL 仍沿用原有保护和跳转处理。
- Markdown 导出识别原始 `markdownimg` 地址，按图片格式生成 `assets/asset-XXXX.<扩展名>` 并从 MarginNote 媒体库写出资源。
- 版本更新为 `2.4.1-b3`；插件渠道、ID 和标题不变。

## 影响范围与兼容性

- 修改 `src/markdown.ts`、`src/card-html.ts` 和 `src/mistake-export.ts`。
- 新增卡片显示及导出资源转换测试；不改变错题记录、答案绑定或设置数据结构，无需迁移。
- 图片哈希对应资源若已从 MarginNote 数据库丢失，插件无法补回原图；MarginNote 真机上的实际显示仍需设备复验。

## 验证与交付

- `pnpm check` 通过。
- `pnpm test` 通过，共 245 项；其中新增用例覆盖示例 Markdown 图片的卡片显示、媒体哈希保留和导出路径改写。
- `pnpm build` 通过，保留既有 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已确认版本 `2.4.1-b3`、正式插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`；配置渠道保持 `stable`。
- 原包 `E:\project\MN\dist\CardLink-v2.4.1-b3.mnaddon` 与交付副本 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1-b3.mnaddon` 均为 578,362 bytes，SHA-256 均为 `643DFBF54B8C2A2A8E5BD8F2C68523A724DC22F86F44EE555E1863239717D8DD`。
- 未进行 MarginNote 设备真机验证；自动化已验证资源解析与 HTML/导出转换，最终宿主显示仍待安装后复验。
