# 长按答案编辑、原生复习模式与多脑图独立绑定

## 目的

恢复“查找答案”单击即时响应，将高级操作改成长按打开原生答案编辑器；完善无答案卡片的定向创建；新增脱离插件面板的脑图复习模式，并修正 iPad 外接鼠标不能拖动插件窗口的问题。

## 已实现行为

- “查找答案”按钮使用 `UILongPressGestureRecognizer`：单击不再等待双击判定，长按匹配答案后优先调用 `MNUtil.openNoteEditor(noteId)`，并保留 `setUIStatusByConfig({ topicid, cardedit: 1, cardid })` 能力降级。
- 单击与长按共用无匹配弹窗。选择生成时不清空或刷新答案索引；卡片由 `cloneNotesToTopic` 明确写入绑定答案脑图，并直接打开新卡编辑器。
- 创建前在绑定范围内查找唯一的对应父节点：命中则直接挂入；未命中且题目不是根直属卡时，复制直接父节点到答案脑图后挂入。不会在已有唯一父节点时重复创建分支。
- 待复习队列标题区按“展开全部题目 / 复习模式 / 共 X 道题”排布。复习模式冻结当前筛选结果，关闭插件面板并定位第一题。
- 脑图区上方原生悬浮工具条按“序号 / 上一题 / 下一题 / 错题信息 / 退出”排列；序号调用原生 `select`，信息面板显示标题、来源、等级状态、复测次数和上次复测结果，退出弹出本次队列、已查看数、耗时和等级分布。
- 修正复习工具条按钮曾绑定到 Web 面板控制器而无响应的问题：Web 桥接现在把真实 addon 主体传给复习模式，按钮 selector、复习状态和原生视图都归属于同一实例。按钮具备按压高亮、切换中的禁用反馈以及首尾题禁用状态。
- 上一题、下一题和序号跳转保持待复习队列顺序；仅参考 Focus Next 的最终聚焦调用，对队列目标卡直接执行 `notebookController.changeFocusToNote(target)`，不引入其同级节点计算或额外脑图定位调用。目标已删除或接口不可用时显示 HUD 提示。
- 上一题、下一题、错题信息和退出依次使用 `chevron.left`、`chevron.right`、`info.circle`、`rectangle.portrait.and.arrow.right`。名称已逐项核对项目根目录的 `SF-Symbols-7.0.4-SVG.zip`，原生控件通过系统 SF Symbols 图像渲染；旧宿主无法取图时回退为按钮文字，避免出现不可见控件。
- 复习工具条跨学习集定位后重新挂载到当前 StudyController 视图，插件断开时清理。
- 多题目脑图独立绑定固定开启；旧的学习集级绑定继续作为精确脑图尚未绑定时的兼容回退。
- iPad 外接鼠标问题确认在原生 `UIPanGestureRecognizer` 覆盖旧 `UIWebView` 的输入边界：标题拖动和缩放手势显式允许直接触摸与间接指针，并保留现有原生窗口几何管理架构。

## 影响文件

- `src/floating-toolbar.ts`、`src/plugin.ts`、`src/globals.d.ts`：单击/长按、编辑器及答案创建。
- `src/review-mode.ts`、`src/rails-core.ts`、`src/main.ts`、`web/src/main.jsx`：复习模式及桥接。
- `rails-native/WebBridgeCommands.js`：把真实 addon 主体传入原生复习模式，修复按钮 target。
- `src/settings.ts`：多脑图独立绑定迁移。
- `rails-native/WebPanelController.js`：iPad 间接指针拖动/缩放。
- `tests/plugin-events.test.ts`：新交互的结构契约测试。

## 兼容性与数据影响

- “生成答案卡片”会立即写入绑定答案脑图，但不会更新索引；这是显式行为变更。
- 父节点只在没有唯一对应父节点时创建；同名同层级但不唯一时仍不猜测，会新建一个直接父节点，避免误挂到错误分支。
- 复习模式报告基于本次冻结队列和实际访问记录，不会自动改变错题等级或复习计划。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，272/272；其中复习模式结构契约验证 addon 事件归属、队列目标 ID、SF Symbols 名称及唯一聚焦调用。
- `pnpm build`：通过，生成 `dist/CardLink-v2.4.2-b7.mnaddon`；存在既有 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json`：版本 `2.4.2-b7`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；产物脚本含 `changeFocusToNote`、SF Symbols 取图、复习 selector 和 addon bridge ownership。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b7.mnaddon` 均为 585,932 bytes，SHA-256 均为 `8d020be5b88302e5949180e34b9d9b10f4f91ca6de12545c542fbeff1e4792cc`。
- MarginNote 设备：尚未验证，见下列限制。

## 未验证限制

- `UILongPressGestureRecognizer`、`MNUtil.openNoteEditor`、跨学习集原生工具条重挂载、`cloneNotesToTopic` 与 `addChild` 的真实设备表现需在 MarginNote 4 验收。
- `notebookController.changeFocusToNote(target)`、原生按钮 selector 归属和 SF Symbols 显示需在 MarginNote 4 真机验收；自动化验证只能覆盖桥接与结构契约。
- iPad 蓝牙鼠标修复基于 UIKit 间接指针输入类型，尚未在目标 iPad/鼠标组合上实测。
