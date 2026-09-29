# b10 关闭与刷新控件胶囊化

## 变更目的

在 `2.4.1b9` 基础上，将查找答案窗口和插件页的关闭、刷新控件改为参考图中的单体圆角胶囊，并增加按压时的果冻式弹动反馈。

## 已实现行为

- 两处双键胶囊统一为 `96×40pt`，关闭与刷新各占连续的 `48×40pt` 槽位。
- 取消两个按键各自的边框、圆角、间距和中间分割；胶囊使用近白底色、全圆角与柔和下投影。
- 插件页按下任一按键时，整枚胶囊依次经历横向收紧、反向过冲、轻微回摆与复位。
- 查找答案窗口使用同样的整体几何回弹；多答案候选出现时，按同一连续槽位扩展为三键胶囊。
- 系统开启“减弱动态”时停用果冻动画并直接复位。
- 保持关闭/刷新原有功能、左右换边设置以及查找答案候选逻辑不变。

## 影响文件与模块

- `src/window-controls.ts`、`src/answer-card-view.ts`：原生答案窗口胶囊几何、样式和整体按压回弹。
- `src/plugin.ts`、`src/rails-core.ts`、`src/main.ts`：注册原生胶囊按压与松手回调。
- `web/src/main.jsx`、`web/src/ui/shell.css`、`web/src/a11y.css`：插件页胶囊结构、样式、动画和触控反馈。
- `rails-native/ui-constants.js`：顶栏胶囊拖动避让宽度。
- `tests/domain.test.ts`、`tests/plugin-events.test.ts`、`tests/web-bridge.test.ts`：几何、结构、动画和减弱动态回归。
- `package.json`、`RELEASE_NOTES_v2.4.1b10.md`：版本与发布说明。

## 兼容与数据影响

- 版本升级为 `2.4.1b10`；`mnChannel` 保持 `stable`，正式插件 ID 和标题不变。
- 不修改答案索引、错题、设置或 OCR 数据结构，无需迁移数据。
- 关闭、刷新、候选选择与左右换边行为保持兼容。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，233/233。
- Playwright 在 `900×640` 视口实际渲染：胶囊计算尺寸为 `96×40px`，两列均为 `48px`，圆角为全圆角；按下时确认 `windowControlJelly` 动画生效。
- `pnpm build`：通过；保留一条与本轮无关的既有 `.sfIconGlyph:svg` CSS 选择器警告。
- 正式构建产物 `dist/CardLink-v2.4.1b10.mnaddon`：576,324 bytes。
- 已复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b10.mnaddon`；源文件和交付副本 SHA-256 均为 `BC283B38CA27C9BFECC70E468AAB336163CD7B770769EEC02C0EF2F3E52F4B2B`。
- 包内 `mnaddon.json` 已确认正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b10`。

## 未验证限制

- 当前环境无法直接在用户 iPad 的 MarginNote 原生运行时目测查找答案窗口的回弹节奏；已由类型检查和原生结构回归覆盖选择器注册、减弱动态与三段回弹参数。
