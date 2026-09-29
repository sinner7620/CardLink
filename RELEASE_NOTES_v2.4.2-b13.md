# CardLink v2.4.2-b13

## 复习工具条视觉对齐

- 修复序号不可见：序号不再由 SVG 层下方的原生按钮标题绘制，改为与四枚图标一起在透明 SVG/HTML 层绘制。
- 五个控件现在共享同一 190×44 pt 坐标系和垂直居中规则；原生按钮只负责触摸、悬停、禁用和无障碍。
- 四枚 SF Symbols 不再强制进入相同的 18×18 方框。根据各自原始 `viewBox` 宽高比计算宽度，并统一为 18 pt 光学高度：左右箭头 13.15/12.4 pt，信息 18.32 pt，退出 21.82 pt。
- 序号使用 15 pt 半粗系统字体、等宽数字，并在切题状态同步时更新。
- 保留 b12 的 WebView/ScrollView 双层透明和胶囊裁切，不恢复 PNG。

## 验证限制

- `pnpm check`、`pnpm test`（272/272）和 `pnpm build` 均通过；构建仍有既有的 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内确认序号绘制/更新、四个 18 pt 光学高度比例、空原生按钮标题和 SVG-only 图标链；复习 PNG 数量为 0。
- 插件包身份为 `marginnote.extension.mn4-answer-matcher` / `CardLink` / `2.4.2-b13`；大小 591,425 bytes，SHA-256：`56A96C40D68AC068A1D59C79528A2AEE91488BCDE80B40E9B423A94A46B5F037`。
- 最终光学大小、字体基线和透明玻璃效果仍需目标 iPad 真机确认。
