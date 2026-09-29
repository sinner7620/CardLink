# CardLink v2.4.2-b12

## SVG 工具条透明合成修复

- 修复 b11 的透明 SVG 绘制层仍显示 190×44 白色矩形、遮住原生 Just Glass 胶囊的问题。
- 同时清除 `UIWebView` 与其内部 `UIScrollView` 的不透明标志和背景色；此前只清除了外层 WebView，内部滚动承载层仍使用默认白底。
- SVG 层按工具条的 22 pt 圆角裁切，宿主即使在装载期间短暂重置合成背景，也不会再出现方形遮罩。
- 每次跨题重挂载 SVG 层时重新声明透明合成属性，避免 UIWebView 页面装载完成后恢复默认背景。
- SVG 内联、18×18 pt 统一图标框和下层原生按钮交互架构保持不变，没有恢复 PNG。

## 验证限制

- `pnpm check`、`pnpm test`（272/272）和 `pnpm build` 均通过；构建仍有既有的 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内只有四个复习 SVG、没有复习 PNG或位图加载链；产物已确认包含 WebView/ScrollView 双层透明和圆角裁切逻辑。
- 插件包身份为 `marginnote.extension.mn4-answer-matcher` / `CardLink` / `2.4.2-b12`；大小 591,205 bytes，SHA-256：`578134841ACE445025EE176C96E1780EC787AE747F8F3553E1DD4F1FAD15FD0B`。
- MarginNote UIWebView 的最终透明合成仍需目标 iPad 真机确认。
