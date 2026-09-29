# v2.3.3-beta.56

## 三档色板与待复习控件一致性（2026-09-02）

- 将“不会 / 不熟 / 掌握”的唯一语义色统一为 `#ff453a / #ff9f0a / #30d158`，进度条、下方图例、Web 控件和原生侧边卡片按钮同步读取同一组 token。
- 待复习三档结果按钮恢复为与左侧操作按钮一致的 `31px` 高度，保留三等分铺满布局。

验证：`pnpm check`、161/161 自动化测试、Playwright 920px/500px 视口检查和生产构建通过；原生侧边卡片最终着色仍需在 MarginNote 真机复核。

完整记录见 `docs/changes/2026-09-02-beta56-level-colors-and-review-controls.md`。
