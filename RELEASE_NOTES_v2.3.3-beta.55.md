# v2.3.3-beta.55

## UI 阶段二与阶段四重构（2026-09-02）

- 完成样式所有权模块内部清理：删除 160 个无现役 DOM 的历史选择器、9 条重复声明和约 750 行无效 CSS；旧五档、旧等级弹窗、玻璃实验控件、旧导出/日期/收藏补丁样式不再进入生产包。
- React 现在独占面板 DOM。`ui-redesign.js`、`ui-alignment.js` 和 `preview-bootstrap.js` 及其全局 MutationObserver、DOM 注入、全文档扫描已完全退役。
- 勾选框继续显示既有 Phosphor 方框/勾选外观，但改由现有 MorphIcon 直接渲染；复习天数摘要改为 React 条件渲染；三档结果按钮换行改为 CSS 响应式规则。
- 删除不参与构建的 `scripts/preview-archive/` 历史 UI bundle，并清理本地心形发光 demo、导出静态原型和空目录。
- 新增 `scripts/dedupe-ui-css.mjs`，以后可重复执行已确认退役选择器与完全重复声明清理，避免覆盖层回流。
- 设置页预览版本号清除 beta.11 残留，统一为 beta.55。

验证：`pnpm check`、155/155 自动化测试和生产构建通过；Playwright 对错题页、待复习页、设置页及 500/920px 宽度进行回归，除版本文本外与 beta.54 基线像素一致。

完整记录见 `docs/changes/2026-09-02-ui-stage-2-and-4.md`。
