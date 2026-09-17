# CardLink v2.4.2-b11

## 复习工具条 SVG 重构

- 删除复习工具条的 PNG 图标及 `MNUtil.getImage`、`NSData`、`UIImage` 位图加载链。
- 四枚图标改用 `SF-Symbols-7.0.4-SVG.zip` 中的原始 SVG，构建时作为文本直接内联，并统一放入 18×18 pt 图标框，避免低分辨率毛边和位图尺寸不一致。
- 工具条使用一个透明、不可交互的 `UIWebView` 负责 SVG 矢量绘制；原生 `UIButton` 继续负责点击、悬停、按压、首尾禁用和无障碍标签。
- SVG 绘制层不设置 delegate，也不增加 URL scheme 或 WebView bridge；所有复习动作继续走既有原生事件。
- 错题信息的单行来源布局和 Just Glass 静态玻璃材质保持不变。

## 验证与限制

- `pnpm check`、`pnpm test`（272/272）和 `pnpm build` 均通过；构建仍有既有的 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 插件包仅包含四个 `review-symbols/*.svg`，运行代码内联同一份 SVG，不含复习 PNG，也不含 `MNUtil.getImage`/`UIImage.imageWithDataScale` 位图加载链。
- 插件包身份为 `marginnote.extension.mn4-answer-matcher` / `CardLink` / `2.4.2-b11`；大小 591,164 bytes，SHA-256：`32628E2FBCF973D3DCC30E070314C778AB0750FDED0FA243E0EB076593288EC2`。
- 透明 SVG 绘制层在 MarginNote UIWebView 上的最终抗锯齿、首次显示和鼠标反馈仍需目标设备验收。
