# _legacy：已归档的样式源文件（2026-11-12）

这些文件在样式收敛（b21-baseline.css 合并基线落地）后不再被任何入口导入，
运行时样式**只由 `../b21-baseline.css` 提供**。保留它们仅为：

1. 历史追溯（阶段一～三收敛管线的输入）；
2. `scripts/flatten-ui-css.mjs` / `dedupe-ui-css.mjs` / `consolidate-ui-priority.mjs`
   仍可按此路径重跑（如需再次全量收敛）。

已知与基线的漂移（以基线为准，勿反向同步）：
- `mistakes.css` `.detailCategoryMenu { width:240px; min-width:240px }`
  → 基线 `b21-baseline.css` 为 `width:min(280px, 100vw - 28px); min-width:0`。
- 基线尾部（unlayered 段：answerBindingColorHint、clipSettings、抽屉、
  sceneCardPreview、a11y 重复段）不在这批源文件中。
