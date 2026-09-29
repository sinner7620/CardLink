# CardLink v2.4.2-b10

## 复习模式界面

- 复习工具条和错题信息面板采用同级 `just glass` 项目的 `static-shell` 回退材质：浅蓝白半透明底、白色玻璃边框、顶部高光、底部冷色内沿和蓝灰投影。
- 未直接移植 Just Glass 的 WebGL 折射器：它只能采样 WebView 自己绘制的场景，无法读取工具条下方的 MarginNote 原生脑图。当前实现继续使用 MarginNote 官方 `UIView`、`UIColor` 和图层属性。
- 错题信息拆分为四个固定单行标签。来源过长时尾部省略，不再把等级状态、复测次数和上次复测结果挤出面板。

## 图标

- SF Symbols SVG 继续作为源素材，构建时使用预渲染 PNG。MarginNote 官方 `UIImage`/MNUtils 没有直接加载 SVG 的接口，运行时位图路径兼容性更稳定。

## 验证与限制

- `pnpm check`、`pnpm test`（272/272）和 `pnpm build` 均通过；构建仍有既有的 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 插件包身份为 `marginnote.extension.mn4-answer-matcher` / `CardLink` / `2.4.2-b10`，包含四个 `review-symbols/*.png`。
- 交付包大小 589,767 bytes，SHA-256：`2495E98F99E66075EDA6B9E2B1F09CD7BD8ECAF6F07E245AD56986C632D7A663`。
- MarginNote 原生工具条的最终透明度、投影和文字截断效果仍需在目标设备验收。
