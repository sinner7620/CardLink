# 2.4.3-b1 答案窗口与位置体验

## 目的

完善 CardLink 更新提示、全局悬浮球、插件窗口复位与答案窗口交互，使答案查看过程在卡片编辑器等原生浮层出现后仍保持可用。

## 已实现行为

- 更新弹窗标题和自动检查提示显示 `CardLink`。
- 悬浮球按“停靠边 + 边上相对位置”写入用户设置，重新创建或下次启动时恢复；屏幕尺寸变化时仍按比例计算。
- 插件窗口默认及重置帧保持左侧边距，垂直方向改为宿主窗口居中，并遵守顶部安全区。
- 答案窗口使用固定高 `zPosition`，显示时每 0.25 秒重新置于父视图最前方；关闭时使定时器失效。
- 答案工具条在关闭与刷新之间加入同规格定位按钮，调用现有的原生浮窗答案聚焦能力定位当前展示的答案卡片。
- 查找答案生成的 HTML 读取答案卡片绑定的脑图手写，并复用统一卡片预览控制器，以双击或双轻点切换隐藏状态。
- 版本更新为 `2.4.3-b1`；继续使用 `stable` 渠道、正式插件 ID 和 `CardLink` 标题。

## 影响范围

- 原生答案窗口与控件布局：`src/answer-card-view.ts`、`src/window-controls.ts`、`src/main.ts`、`src/rails-core.ts`、`src/plugin.ts`。
- 答案内容与手写：`src/matcher.ts`、既有 `src/bound-handwriting.ts`、`src/card-preview.ts`。
- 入口与面板位置：`src/mnutils-entrance.ts`、`rails-native/WebPanelController.js`。
- 更新与版本：`src/updater.ts`、`package.json`、发布说明。

## 兼容性与数据影响

- 新增一个用户默认设置键保存悬浮球停靠位置；不修改答案绑定、错题或索引数据。
- 普通答案 HTML 调用方仍默认不附加绑定手写，只有原生查找答案窗口显式启用，避免改变导出与工作台内容契约。
- 浮窗定位沿用能力探测后的 MarginNote 原生接口；不可用或调用失败会显示明确结果，不改变当前答案窗口。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，276/276；包含答案控件布局、位置记忆契约、置顶生命周期、浮窗定位、绑定手写和更新提示覆盖。
- `pnpm build`：通过并生成 `dist/CardLink-v2.4.3-b1.mnaddon`；Vite 报告既有 `.sfIconGlyph:svg` 选择器警告，但未中断构建。
- 包内 `mnaddon.json`：版本 `2.4.3-b1`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；`package.json` 的 `mnChannel` 保持 `stable`。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3-b1.mnaddon` 均为 589,910 bytes，SHA-256 均为 `DCD848189FF1D5C7B753E4E9C49E4CD8E42882E181A7DD9015CB64BD7E8C9619`。

## 未验证限制

- 当前桌面自动化无法等价验证 MarginNote 4 真机的原生窗口层级、卡片编辑器覆盖、原生浮窗聚焦、跨重启悬浮球恢复与手写双击交互；这些项目需真机复验。

## 2.4.3-b2 原生系统图标修正

- 用户明确要求不再使用字符或自绘图标。答案窗口的关闭、定位和刷新按钮全部改用 UIKit 原生 SF Symbols：`xmark`、`scope`、`arrow.clockwise`。
- 三个系统图标复用相同按钮工厂、颜色和 image inset，不保留字符图标或图片兜底。
- 因 `2.4.3-b1` 已交付，本次按版本规则升级为 `2.4.3-b2`，不覆盖旧包。
- `pnpm check`、`pnpm test`（276/276）和 `pnpm build` 均通过；构建仍仅出现既有 `.sfIconGlyph:svg` CSS 选择器警告。
- 包内 `mnaddon.json` 为版本 `2.4.3-b2`、正式 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`，渠道保持 `stable`。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3-b2.mnaddon` 均为 589,980 bytes，SHA-256 均为 `3835A33493B5DAA9A6B0A726C01D11F95D7F04D9B1AF91DF54795FFEBE5F673F`。

## 2.4.3-b3 字符图标恢复

- 真机日志确认 MarginNote JSB 未暴露 `UIImage.systemImageNamed`，导致 b2 在答案索引正常匹配后创建窗口失败。
- 按用户指定恢复系统字体字符按钮：关闭 `✕`、定位 `↗`、刷新 `↻`；删除 SF Symbols 图片调用，不保留该异常路径。
- 因 b2 已交付，本次升级为 `2.4.3-b3`。
- `pnpm check`、`pnpm test`（276/276）和 `pnpm build` 均通过；构建仍仅出现既有 `.sfIconGlyph:svg` CSS 选择器警告。
- 包内 `mnaddon.json` 为版本 `2.4.3-b3`、正式 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`，渠道保持 `stable`。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3-b3.mnaddon` 均为 589,910 bytes，SHA-256 均为 `174A947EE94DA4C60A1B33E87AEFA7A605113B7637BCA03FFF1BD2B4A62E4C87`。
