# v2.3.3-beta.60

> 后续调整：用户取消横向滚动方案，本版的横向拖动实现已在 beta.61 删除并替换为无需横向手势的蛇形折行时间轴。

## 复测时间轴触控冲突修复（2026-09-02）

- 删除时间轴节点逐项强制 `touch-action: pan-x` 的手势抢占。
- 时间轴改为 `touch-action: pan-y`：纵向和不明确的斜向手势由待复习页面原生滚动处理。
- 新增 8px 方向判断阈值；仅当横向位移明显大于纵向位移时，时间轴才取得 pointer capture 并更新 `scrollLeft`。
- 横向拖动统一支持触摸、触控笔、鼠标和触控板指针；原有 `cursor: grab/grabbing` 现在对应真实行为。
- 移除横向 `overscroll-behavior: contain` 限制，避免边缘手势被无反馈吞掉。
- 增加左右方向键滚动和时间轴可访问标签。
- 版本迭代为 `2.3.3-beta.60`。

验证：`pnpm check`、158/158 Node 自动化测试、3/3 Playwright 测试和生产构建通过。Playwright 已验证横向拖动产生滚动，纵向主导手势不进入时间轴拖动态。

完整记录见 `docs/changes/2026-09-02-beta60-review-timeline-gesture.md`。
