# 插件窗口关闭/刷新按钮去掉胶囊，直接显示在顶栏

日期：2026-09-13。基于 v2.4.1-b9 工作树。

## 需求

插件页顶栏的关闭/刷新按钮此前是悬浮的白色胶囊容器（2026-09-11 b10 引入，含按后果冻动画），用户要求去掉胶囊，按钮直接显示在顶栏上。要求直改实现而非叠加补丁。

## 实现

- `web/src/main.jsx`：删除 `.windowControlCapsule` 包装，`closeButton` / `refreshButton` 以 Fragment 直接渲染进 `.topTools-left` / `.topTools-right`（左右侧顺序语义不变：左侧先关后刷，右侧先刷后关）。
- `web/src/ui/shell.css`：删除胶囊容器、内部按钮覆盖、`windowControlJelly` 果冻动画及其 reduced-motion 块；改为 `.topBar .iconButton { width:44px; height:36px; border:0; box-shadow:none }`，悬停底色与按压缩放沿用既有 `.topBar .iconButton:hover` / `:active` 规则。
- `web/src/a11y.css`：删除胶囊专属按压规则（不再屏蔽内部按钮变淡与触控热区内缩），恢复标准 `.iconButton` 触控热区外扩 6px 与按压缩放。
- `tests/web-bridge.test.ts`：契约断言改为"源码与 CSS 中不含 windowControlCapsule / windowControlJelly + `.topBar .iconButton` 尺寸 44×36"，按钮位置断言更新为 Fragment 写法。

## 验证

- `pnpm check`、257 项测试、`pnpm build` 通过。
- 浏览器 ui-preview 截图与 DOM 实测：两按钮 44×36、无阴影、直接位于 `.topTools` 容器内，与顶栏导航同行显示，无残留胶囊样式。

## 限制

- 真机顶栏（MarginNote WebKit 窗口）视觉效果待验收；本轮为普通开发提交，安装包另起 b10。

## 交付（2.4.1-b10）

- 版本升至 `2.4.1-b10`（package.json），发布说明 `RELEASE_NOTES_v2.4.1-b10.md`；正式渠道身份 `marginnote.extension.mn4-answer-matcher` / `CardLink`，已解包核对 mnaddon.json。
- 交付前对最终输入重跑 check、test（257 通过）、build；产物 `dist/CardLink-v2.4.1-b10.mnaddon`。
- 已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1-b10.mnaddon`；SHA-256（源与复制件一致）：`8e8b9931f782fb5e79bd3a45008cf6e1857c63f91624efa663919557138f318a`。
- 未推送 GitHub/Gitee 发布；远端发布需另行授权。
