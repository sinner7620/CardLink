# 待复习悬浮条复用设置页

## 目的与实现

修复待复习悬浮条中两层胶囊底色/阴影与 SVG 融合层叠加形成的分层和色块。按要求直接复用设置页样式，不另建效果。

- `web/src/main.jsx`：待复习使用 `settingsCapsule reviewToolbar` 与 `settingsCapsuleSlider`；通过 portal 挂在与设置页相同的 main 定位容器，避免滚动层改变绝对定位基准。移除液态几何测量、ResizeObserver 和 SVG 融合层。
- `web/src/ui/review.css`：删除重复的背景、阴影、模糊、边框、滑块与定位参数，只保留状态区/操作区布局。两区共用同一个胶囊表面，接合处无二次投影；保留窄窗菜单与筛选功能。
- `web/src/ui/settings.css`：现有按钮规则同时覆盖待复习按钮，压过旧通用按钮的选中/悬停底色。浮条位置、尺寸、颜色、阴影和滑块动效仍由设置页原规则统一提供。
- `tests/web-render-smoke.test.ts`：为用户明确要求的样式复用契约补充结构断言。更新 `docs/pages/review.md`。

## 兼容与数据

无存储、桥接协议、复习队列或数据迁移变化。本轮不修改版本、不交付安装包。设置页继续使用原胶囊效果，待复习的双胶囊融合改为始终共用单一表面。

## 验证

- `pnpm check` 通过。
- Web 渲染冒烟与桥接测试 39 项通过；新增复用契约断言后复跑渲染冒烟 11 项通过。
- `pnpm exec vite build --config web/vite.config.js` 通过；已有 `.sfIconGlyph:svg` 警告保持原状。
- Playwright 在静态构建页面检查 1280、800、600、375px：设置与待复习浮条的 x/y、宽高、定位方式、底色、边框、圆角、阴影、backdrop-filter 逐项一致。状态区、操作区及状态按钮均无独立底色或阴影，标签未溢出。
- 检查状态切换、筛选、窄窗菜单展开、菜单边界、滚动后位置及减少动态效果；目视检查宽窗与窄窗截图。证据位于 `output/playwright/check-review-capsule.js`、`settings-capsule-*.png`、`review-capsule-*.png` 与 `review-menu-375-settled.png`。
- `git diff --check` 通过。未进行 MarginNote 真机 WebView 视觉验收，桌面结论不代替真机确认。
