# 导出快速预览按面板宽度等比缩放

日期：2026-09-13。基于 v2.4.1-b5 工作树。

## 问题

导出页「快速预览」的 HTML 预览 iframe 固定 760px 宽、以 100%（1:1）显示——A4 正文为 186mm（约 703px @96dpi），而预览侧栏比 760px 窄，卡片在预览中显示比例过大且需横向滚动。PDF 页图预览（`width:100%`）与 Markdown 预览本身自适应，仅 HTML 快速预览不缩放。

## 实现

- 新增 `ExportHtmlPreview` 组件（web/src/main.jsx）：iframe 保持 760px 版面宽度，用 `transform: scale((面板宽度 − 内边距) / 760)` 等比缩放（上限 1，不放大），ResizeObserver 跟随面板宽度变化；加载后读取文档 scrollHeight 设置 iframe 高度，wrapper（`.actualPreviewScaled`）高度同步为缩放后高度，避免 transform 留白。
- `web/src/ui/controls.css` 增加 `.actualPreviewScaled` 容器规则；原 `.actualPreviewViewport iframe` 规则保留作为回退。
- 实际 PDF 导出文件本身不变（仍为 186mm A4 版面）；`pdfUrl` 模式（浏览器 PDF 查看器）不变。

## 验证与限制

- `pnpm check`、256 项自动化测试、`pnpm build` 通过；无浏览器视觉实测，缩放在不同面板宽度下的表现需真机/浏览器确认。
- 属 UI 交互修复，不改变导出文件内容；普通开发提交，未升版、未交付安装包。
