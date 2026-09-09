# mistake-export.ts — 错题导出
## 职责
PDF 与 Markdown 双链路：选题（严格白名单契约）、MD 组装（assets/来源脱敏）、PDF HTML 组装（页面密度 × 答案位置两概念）、快速/完整预览、导出目录清理（保留最近 5 份）。
## 边界
- recordIds 数组（含空）= 严格白名单；未提供才允许全量
- 失效记录静默跳过并以 missing 计数提示
- previewLimit：快速预览只渲染前 N 题
- MD 来源不含内部卡片/脑图 ID（隐私）
## 验收
两种密度与三种答案位置页序正确；空 recordIds 零导出；预览截断有标注。