# CardLink v2.4.2-b2

## 修正说明

- 修正 v2.4.2-b1 的双击触发位置：不再监听脑图卡片双击。
- 单击侧边工具条的“查找答案”按钮，继续使用原有 CardLink 答案窗口。
- 双击“查找答案”按钮时，才调用 MarginNote 原生卡片源浮窗定位答案卡片。
- 单击操作会等待双击判定完成；识别到双击后取消待执行的单击，避免原生浮窗与 CardLink 答案窗口同时弹出。
- 保留 v2.4.2-b1 的缺失答案确认生成、唯一同层级分支复用和重复生成保护。

## 数据与兼容性

- 保持 `mnChannel: "stable"`、正式插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`。
- 已交付的 v2.4.2-b1 不做同版本覆盖，本修正版使用新版本 v2.4.2-b2。

## 验证与限制

- `pnpm check`：通过。
- `pnpm test`：269/269 通过。
- `pnpm build`：通过；构建过程中出现既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响产物生成。
- 安装包 `dist/CardLink-v2.4.2-b2.mnaddon`：583,657 bytes。
- 已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b2.mnaddon`；源文件与交付副本 SHA-256 均为 `4b9019ab0fe4e479d88cd995e94424b3b0397701a571b2aed5cdf2cc93151a69`。
- 包内 `mnaddon.json` 已确认版本 `2.4.2-b2`、插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`。
- 原生浮窗定位及双击手势仍需 MarginNote 4 真机验收。
