# beta.54 真机反馈第三轮修复

日期：2026-09-02  
分支：`beta`  
版本：`2.3.3-beta.54`

## 修改目的

处理第三轮真机反馈：恢复准确的收藏形变动画，收紧错题列表布局，统一复习控件、完成状态与颜色语义，修复悬浮入口和复原链路，并消除 HTML 转义及缩放手势的重复实现。

## 已实现行为

1. 收藏按钮继续使用官方 `morphicons@1.7.1` 的 `createMorph`。恢复旧版星星→对号/X→星星路径和时序：收藏停留 520ms 后 `bouncy` 回星星，取消收藏停留 480ms 后 `smooth` 回星星。
2. 批量选择框文案由“批量改等级”改为“修改等级”。
3. 普通计数固定为“共x道”，多选计数固定为“x/x”；工具栏首列改为内容宽度，去掉计数与搜索框之间的无效留白。
4. 总览三段进度条恢复左右端圆角，同时保留外发光；三段实色直接引用三档 token。
5. 待复习三档结果按钮与左侧定位/答案/复测历史控件统一为 31px 高，三个结果按钮继续等宽。
6. 待复习答案视口由 180–420px 提升至 300–520px，缩放仍只作用于 iframe 内部内容。
7. 复测历史取消 inline-size containment，明确启用不换行、`pan-x`、惯性横向滚动和细滚动条，历史内容不再被外层页面裁断。
8. 错题标题首字与标签、来源行对齐；收藏星改为定位在标题左侧，不再为未收藏题预留标题缩进。
9. 自定义标签后紧接 `·` 与剩余天数/完成状态，不再把时间推到行尾。
10. 悬浮球单击改为创建（如有必要）并直接显示插件面板，不再依赖不稳定的 `self.toggleWebPanel` 回调上下文。
11. 悬浮球长按会先显示插件面板，再恢复默认位置与尺寸；答案窗口仍同步复原。
12. 所有完成态短标签统一显示“已结束”，包括列表、详情、总览最近添加、待复习和导出复习信息。
13. `src/ui-tokens.ts` 成为颜色唯一值源：主强调色 `#0e8dfd`、灰底 `#d8d8dd`，三档色沿用插件原有红/橙/绿。Web CSS 变量、原生悬浮球和卡片 HTML 均从该模块取值；旧蓝变量只保留指向主强调色的兼容别名。
14. `escapeHtml` 收口到 `src/html-utils.ts`，卡片 HTML、导出和浏览器预览共用同一实现。
15. 双指缩放触摸/gesture 事件收口到 `src/pinch-zoom.ts`。面板 iframe 直接导入，独立卡片 WebView 序列化同一个函数；各视图仅保留自己的缩放呈现方式。

## 影响模块

- `web/src/main.jsx`
- `web/src/panel-preview.css`
- `web/src/tokens.css`
- `web/src/lib/previewBridge.js`
- `web/src/frame-pinch-zoom.js`
- `src/ui-tokens.ts`
- `src/html-utils.ts`
- `src/pinch-zoom.ts`
- `src/card-html.ts`
- `src/mistake-export.ts`
- `src/mnutils-entrance.ts`
- `rails-native/WebPanelController.js`
- `tests/mistake-performance.test.ts`
- `tests/plugin-events.test.ts`
- `tests/web-bridge.test.ts`

## 兼容性与数据影响

- 不修改错题数据结构、收藏记录、复习计划或共享存储键。
- 旧 CSS 蓝色变量仍保留，历史选择器不会失效，但最终色值统一解析为 `#0e8dfd`。
- 悬浮球单击语义从“切换显示/隐藏”改为“进入并显示插件页面”，符合本轮要求。

## 验证

- `npm run check`：通过。
- `npm test`：150/150 通过。
- `npm run build`：通过。
- Playwright 浏览器回归：列表工具栏、收藏后标题对齐、标签与时间分隔、进度条圆角发光、待复习控件、300px 答案视口和复测历史布局通过。
- 构建产物：`dist/mn4-answer-matcher-v2.3.3-beta.54.mnaddon`。

## 尚需真机验证

- Morphicons 在 MarginNote 4 `UIWebView` 中的 480/520ms 动画手感。
- iPad 触摸横向拖动长复测时间轴。
- MN Utils 悬浮球单击显示面板、长按同时复原插件面板和答案窗口。

