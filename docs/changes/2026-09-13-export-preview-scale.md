# 导出快速预览按固定 60% 缩放

日期：2026-09-13。基于 v2.4.1-b6 工作树。

## 问题

导出页「快速预览」的 HTML 预览 iframe 固定 760px 宽、以 100%（1:1）显示——A4 正文为 186mm（约 703px @96dpi），而预览侧栏比 760px 窄，卡片在预览中显示比例过大且需横向滚动。第一版修复用"按面板宽度自适应缩放"，用户反馈仍偏大，按指示改为固定 60%。

## 实现

- 新增 `ExportHtmlPreview` 组件（web/src/main.jsx）：iframe 保持 760px 版面宽度，`transform: scale(0.6)`（`EXPORT_PREVIEW_SCALE = 0.6`，固定值，不随面板宽度变化）；加载后读取文档 scrollHeight 设置 iframe 高度，wrapper（`.actualPreviewScaled`）高度同步为缩放后高度，避免 transform 留白。
- `web/src/ui/controls.css` 增加 `.actualPreviewScaled` 容器规则；原 `.actualPreviewViewport iframe` 规则保留作为回退。
- 实际 PDF 导出文件本身不变（仍为 186mm A4 版面）；`pdfUrl` 模式（浏览器 PDF 查看器）不变。

## 验证与限制

- `pnpm check`、256 项自动化测试、`pnpm build` 通过；60% 固定缩放的视觉效果需在真机/浏览器确认。
- 属 UI 交互修复，不改变导出文件内容。
