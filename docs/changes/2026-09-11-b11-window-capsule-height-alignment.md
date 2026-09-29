# b11 窗口胶囊高度对齐

## 变更目的

修正 `2.4.1b10` 的关闭/刷新胶囊偏大问题，使其高度与插件顶栏“错题本”选中态胶囊严格对齐。

## 已实现行为

- Playwright 实测“错题本”选中态高度为 `36px`，据此将插件页关闭/刷新胶囊由 `96×40px` 收紧为 `88×36px`。
- 两个按钮各占连续的 `44×36px` 槽位，保持无中缝、全圆角与整体果冻回弹。
- 查找答案窗口同步使用 `88×36pt` 双键胶囊；多答案时按 44pt 槽位扩展。
- 顶栏拖动避让宽度同步从 102pt 收紧至 94pt，避免缩小后残留过宽不可拖动区域。

## 影响文件与模块

- `src/window-controls.ts`：查找答案窗口胶囊尺寸与垂直偏移。
- `web/src/ui/shell.css`：插件页胶囊尺寸及顶栏布局保留宽度。
- `rails-native/ui-constants.js`：原生顶栏拖动避让宽度。
- `tests/domain.test.ts`、`tests/plugin-events.test.ts`、`tests/web-bridge.test.ts`：新尺寸回归断言。
- `package.json`、`RELEASE_NOTES_v2.4.1b11.md`：版本与发布说明。

## 兼容与数据影响

- 版本升级为 `2.4.1b11`；`mnChannel` 保持 `stable`，正式插件 ID 和标题不变。
- 不改变按钮功能、左右换边、候选答案或任何用户数据结构。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，233/233。
- Playwright `900×640` 实际渲染：选中的“错题本”页签与关闭/刷新胶囊高度均为 `36px`，两者圆角计算值均为 `999px`。
- `pnpm build`：通过；保留一条与本轮无关的既有 `.sfIconGlyph:svg` CSS 选择器警告。
- 正式构建产物 `dist/CardLink-v2.4.1b11.mnaddon`：576,322 bytes。
- 已复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b11.mnaddon`；源文件和交付副本 SHA-256 均为 `61D30F6F8C92EA9113CDE3F5611DB0B4CABC6489D9B42E9CDAC485656BD6EEDD`。
- 包内 `mnaddon.json` 已确认正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b11`。

## 未验证限制

- 查找答案窗口为 MarginNote 原生控件，最终视觉仍需在用户 iPad 真机确认；其尺寸由与 Web 实测一致的 `36pt` 常量控制。
