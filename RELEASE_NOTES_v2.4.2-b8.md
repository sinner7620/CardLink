# CardLink v2.4.2-b8

## 修正

- 恢复“多题目脑图独立绑定”开关：默认开启，但现在可以关闭并保存状态；关闭后使用题目学习集级答案绑定。
- 修复点击复习模式“错题信息”导致 MarginNote 闪退。IPS 显示崩溃位于 `UILabel initWithFrame:`/`_UILabelLayer setBounds:`，本版移除了对应的无 frame 标签构造路径。
- 复习工具条除序号外只保留 SF Symbols 图标，不再回退显示“上一题、下一题、错题信息、退出”等文字。
- 工具条按错题详情悬浮操作条规范收紧为 32pt 圆形控件和统一胶囊，并增加鼠标悬停、触摸按下、信息选中及切换中反馈。
- 第一题的上一题按钮、最后一题的下一题按钮会禁用并明显变灰。
- 同一脑图内切题继续使用 `notebookController.changeFocusToNote(target)`；跨脑图切题改走主脑图定位，不再在浮窗打开目标。

## 图标来源与兼容性

- 四个图标由项目根目录 SF Symbols 7 官方 SVG 生成并随安装包内联。
- 宿主不导出 hover 手势时，仍保留 UIButton 原生 pointer interaction 和触摸按压反馈。
- 修复后的信息面板、鼠标悬停和跨脑图定位仍需 MarginNote 4 真机复测。

## 验证与交付

- `pnpm check`、`pnpm test`（272/272）和 `pnpm build` 均通过。
- 已核验包内版本 `2.4.2-b8`、正式插件 ID 与标题；核心脚本含四个内联 SF Symbols 图像和主脑图定位调用，不含浮窗聚焦调用。
- 项目产物和 iCloud 交付副本均为 589,555 bytes，SHA-256 均为 `8edc6210a95cc5793f4c5ce8e07f162d6346a3666ab6f7543aa674462e7d7545`。
- 构建仍报告既有 `.sfIconGlyph:svg` CSS 选择器警告，本轮产物正常生成。
