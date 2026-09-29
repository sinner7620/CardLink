# CardLink v2.4.2-b7

## 复习模式修正

- 修正复习模式工具条点击无反应：原生按钮现在绑定到实际 CardLink addon 实例，不再误绑到插件面板控制器。
- 上一题、下一题及序号选择后的跳转，按当前待复习队列定位，并直接使用 Focus Next 同款最终调用 `notebookController.changeFocusToNote(target)`；不复制其同级节点切换规则，也不附加其他脑图聚焦调用。
- 工具条采用 SF Symbols：上一题 `chevron.left`、下一题 `chevron.right`、错题信息 `info.circle`、退出 `rectangle.portrait.and.arrow.right`。符号名已与项目根目录的 SF Symbols 7 SVG 包核对。
- 增加原生按压高亮、切换中禁用、首题/末题禁用及信息按钮选中态；目标卡片缺失或宿主不支持焦点切换时会显示提示。

## 兼容性

- 保持正式渠道、插件 ID `marginnote.extension.mn4-answer-matcher` 与标题 `CardLink`。
- 宿主无法提供系统 SF Symbols 图像时，按钮回退显示中文文字，避免控件不可见。
- 原生 selector 响应、`changeFocusToNote` 聚焦和 SF Symbols 显示仍需 MarginNote 4 真机验收。

## 验证与交付

- `pnpm check`、`pnpm test`（272/272）及 `pnpm build` 均通过。
- 已核验包内版本 `2.4.2-b7`、正式插件 ID 与标题；项目产物和 iCloud 交付副本均为 585,932 bytes，SHA-256 均为 `8d020be5b88302e5949180e34b9d9b10f4f91ca6de12545c542fbeff1e4792cc`。
- 构建仍报告既有 `.sfIconGlyph:svg` CSS 选择器警告；本轮未改动该选择器，安装包正常生成。
