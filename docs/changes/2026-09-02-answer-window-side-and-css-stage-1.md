# 答案窗口按钮位置同步与 CSS 阶段一收口

## 目的

修复“插件窗口关闭按钮位置”只影响插件页面、不即时影响答案窗口的问题；消除答案窗口关闭、刷新、拖拽区各自计算位置的重复实现。同时完成交接计划中的第一阶段样式所有权拆分，停止继续维护 `panel.css + panel-preview.css` 覆盖链。

## 已实现行为

### 原生答案窗口

- 新增 `src/window-controls.ts`，集中维护左右位置规范化、三块窗口工具区域坐标和 44×44 圆形按钮工厂。
- `answer-card-view.ts` 的关闭与刷新按钮共用按钮工厂；关闭、刷新、拖拽区一次性读取同一个布局结果。
- `WebPanelController.setCloseButtonSide` 写入现有设置后，通过既有 addon 方法链通知答案窗口即时重排。
- 同步函数在答案窗口不存在时直接返回；不会创建窗口、不会把隐藏窗口显示出来，也不会修改窗口位置和尺寸。

### CSS 阶段一

- 前端入口改为依次加载 `ui/tokens.css`、`controls.css`、`shell.css`、`overview.css`、`mistakes.css`、`review.css`、`export.css`、`settings.css`，最后加载 `a11y.css`。
- 删除不再加载的 `panel.css`、`panel-preview.css` 和旧位置 `tokens.css`，页面规则进入明确所有权模块。
- 删除无 DOM 对应的玻璃实验 UI、旧导出选择器族等死规则。
- 对同一选择器、同一级联上下文中已被后续同优先级声明覆盖的属性做机械去重，共移除 122 条冗余声明，其中 53 条为冗余 `!important`。
- 生产 `app.css` 从约 153.21 KB 进一步降至 150.02 KB（gzip 26.86 KB）；现存 `!important` 为 1417 条，作为阶段二在模块内部继续治理的显式技术债，不再依赖跨文件覆盖。

## 影响文件/模块

- 原生链路：`src/window-controls.ts`、`src/answer-card-view.ts`、`src/plugin.ts`、`src/main.ts`、`src/rails-core.ts`、`rails-native/WebPanelController.js`
- Web 样式：`web/src/main.jsx`、`web/src/ui/*.css`
- 测试：`tests/plugin-events.test.ts`、`tests/web-bridge.test.ts`
- 文档：`docs/README.md`、`docs/modules/src/*`、`docs/modules/web/*`、本记录和发布说明

## 兼容性与数据影响

- 沿用原设置键 `marginnote.extension.mn4-answer-matcher.beta.rails.close-side.v1`，无需迁移用户设置。
- 不修改错题、答案、收藏、复习或绑定数据。
- Web 最终仍由 Vite 合并为单一 `app.css`，只改变源码所有权，不改变 MarginNote 加载协议。

## 验证

- `pnpm check` 通过。
- 答案窗口位置通知与“不得打开/复位隐藏窗口”回归测试通过。
- 全套测试最终 154/154 通过。
- `pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.54.mnaddon`。
- Playwright 在 500、620、720、920px 检查总览、错题、复习和设置页面；页面结构、窄窗顶栏、列表与三档按钮保持正常。截图位于 `output/playwright/stage1-*.png`。

## 尚未验证/后续限制

- JSB 到 UIKit 的即时重排必须在 MarginNote 4 真机打开答案窗口后切换左右设置复验。
- 阶段一完成的是样式所有权和死层退役；模块内部仍保留历史高特异性与 `!important`，将在阶段二逐页合并，不能再以新增全局覆盖层处理。
