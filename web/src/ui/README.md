# web/src/ui 样式目录说明

- `b21-baseline.css` 是**唯一的运行时样式基线**：`web/src/main.jsx` 仅导入它（外加本目录其余小型页面样式文件）。它已包含历史源文件的全部规则（含 `@layer mn-ui-base` / `mn-ui-priority` 两层与文件尾部 unlayered 追加段）。
- 修改样式时**直接改 `b21-baseline.css`**；文件头带有 `consolidate-ui-priority.mjs` 标记，重新运行该脚本会跳过它，不会被覆盖。
- `_legacy/` 是 2026-11 样式收敛前的历史源文件快照（tokens/controls/shell/overview/mistakes/review/settings/export/detail/mistake-drawer）。它们**不被任何入口加载**，与基线存在已知的值漂移（如 `_legacy/mistakes.css` 的 `.detailCategoryMenu` 宽度 240px，基线为 `min(280px, 100vw - 28px)`）；仅作历史参考，禁止同步回基线。
- `scripts/flatten-ui-css.mjs`、`scripts/dedupe-ui-css.mjs`、`scripts/consolidate-ui-priority.mjs` 是历史收敛管线，读取 `_legacy/`；除非重启样式重构，否则无需运行。
