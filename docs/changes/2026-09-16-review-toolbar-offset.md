# 复习模式工具条顶部避让

## 目的

复习模式工具条原先固定在脑图区顶部 10 pt 处，会被 MarginNote 自带顶栏遮挡。本次将其向下移动一个完整工具条高度，并交付新的正式安装包。

## 实现行为

- 保留原有 10 pt 顶部留白，在此基础上增加 44 pt（一个复习工具条高度）的避让距离，工具条顶部从 `y=10` 调整为 `y=54`。
- 错题信息面板继续位于工具条底部下方 5 pt，因此随工具条从 `y=59` 调整为 `y=103`。
- 复习工具条尺寸、玻璃外观、按钮交互、队列导航和题目定位逻辑均不变。
- 用户明确授权本轮覆盖已交付的 2.4.2；正式渠道、插件 ID 和标题保持不变。此同版本替换授权仅适用于本轮。

## 影响文件

- `src/review-mode.ts`：集中定义工具条顶部偏移，并让信息面板基于工具条位置布局。
- `tests/plugin-events.test.ts`：增加工具条避让及信息面板相对位置的结构契约。
- `package.json`、`RELEASE_NOTES_v2.4.2.md`：同版本替换标识和发布说明。

## 数据与兼容性

本次仅调整原生视图坐标，不修改任何存储格式、错题记录、复习状态或配置项，无数据迁移。

## 验证

- `pnpm check`：通过。
- `pnpm test`：272/272 通过；复习模式结构契约覆盖 44 pt 顶部避让和信息面板继续位于工具条下方。
- `pnpm build`：通过；存在既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响安装包生成。
- 包内 `mnaddon.json`：版本 `2.4.2`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；`package.json` 的 `mnChannel` 为 `stable`。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2.mnaddon` 均为 588,900 bytes，SHA-256 均为 `BBD8528B4CDA88C359BDD7F27DE0D2A4C5519ED755E541253C22C6DBB8F1B4F1`。

## 未验证限制

桌面自动化不能呈现 MarginNote 原生顶栏。工具条不再被遮挡及最终间距仍需在 MarginNote 4/iPad 真机确认。
