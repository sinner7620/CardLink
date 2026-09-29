# web/src/ui — 页面样式所有权

## 职责

- `tokens.css`：设计令牌兼容别名和跨上下文层级锚点，必须最先导入。
- `controls.css`：跨页面控件及确需共享的组合选择器。
- `shell.css`：根页面、顶栏、导航、加载和错误状态。
- `overview.css`：总览、统计、进度和来源分布。
- `mistakes.css`：错题筛选、列表和批量操作。
- `detail.css`：详情标题/标签/等级布局与悬浮操作条。
- `review.css`：复习队列、题目/答案预览、结果和历史。
- `export.css`：导出配置、预览和提交状态。
- `settings.css`：设置、迁移确认和联通测试。
- 最后加载`detail.css`；不恢复历史`a11y.css`覆盖层。

## 边界

新增页面规则进入对应所有权文件并优先带页面根作用域；禁止重新建立 `panel.css`、`panel-preview.css` 一类跨代覆盖层。共享规则只有被多个页面真实复用时才进入 `controls.css`。

## 阶段一至四结果

旧两层样式已退出源码入口并删除。阶段二上下半程已在所有权模块内部清除无现役 DOM、完全重复声明和同选择器/同上下文中被后值覆盖的声明，并用 `mn-ui-base / mn-ui-priority` 两个显式 cascade layer 替代历史声明级 `!important`；源码和生产 CSS 均保持 0 处 `!important`。后续新增退役选择器时同步维护并执行 `scripts/dedupe-ui-css.mjs`，不得重新引入声明级强制覆盖。阶段四已删除 DOM 补丁层和预览归档，面板 DOM 只允许 React 管理，不再通过全局 MutationObserver、`insertAdjacentHTML` 或跨文件追加覆盖实现控件。
