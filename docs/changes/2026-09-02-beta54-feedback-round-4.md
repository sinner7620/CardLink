# beta.54 真机反馈第四轮修复

日期：2026-09-02  
分支：`beta`  
版本：`2.3.3-beta.54`

## 修改目的

处理第四轮真机反馈：恢复待复习原题的单指滚动，纠正悬浮球开关与长按复位语义，补齐答案窗口刷新复位，修正窄窗列表和三档结果按钮换行，并让收藏 Morphicons 完全使用官方 Lucide IconNode 数据。

## 已实现行为

1. 待复习原题 iframe 改为可滚动视口，启用 `scrolling="auto"`、文档级纵向 overflow、`touch-action: pan-y` 和 iOS 惯性滚动；单指上下滑动不再被禁用。
2. 悬浮球单击恢复为开关：面板已打开则关闭，已关闭则打开。每次点击会把控制器重新绑定到当前 MN Utils 窗口，避免退出脑图后仍指向旧宿主。
3. 悬浮球长按只在插件面板已打开时执行；关闭状态不创建、不显示、不复位任何窗口。答案窗口也只在自身可见时随之复位。
4. 总览进度条不再渲染计数为 0 的空分段，CSS 的首尾圆角始终落在真正可见的颜色段上。
5. 错题列表收藏星移到自定义分类之前；题目标题不再承担收藏图标占位，未收藏与已收藏题目的标题保持同一基线。
6. 答案查询窗口在关闭按钮旁新增刷新按钮。刷新会恢复答案窗口默认位置和尺寸，并重新载入当前答案。
7. 插件页顶栏刷新按钮改为“刷新并复位”：先恢复插件面板默认位置和尺寸，再刷新工作台数据。
8. 收藏按钮新增 `lucide@1.39.0`，直接向 `createMorph`/`morphTo` 传入 vanilla `lucide` 的 `Star`、`Check`、`X` IconNode；删除收藏专用手写路径字符串，保留既有 520/480ms 动画节奏。
9. 三档结果换行检测从“只观察第一题”改为观察队列内每一道题。任何一题发生换行时，三个按钮都会以等宽网格铺满整行。
10. 窄窗列表首行固定为“多选 + 数量 + 搜索 + 折叠”，强制内部 flex/grid 保持单行，第二行只保留分类、等级和日期筛选。

## 影响模块

- `package.json`
- `pnpm-lock.yaml`
- `web/src/main.jsx`
- `web/src/panel-preview.css`
- `web/src/ui-redesign.js`
- `src/answer-card-view.ts`
- `src/mnutils-entrance.ts`
- `src/plugin.ts`
- `src/main.ts`
- `src/rails-core.ts`
- `tests/plugin-events.test.ts`
- `tests/web-bridge.test.ts`

## 兼容性与数据影响

- 不修改错题、收藏、复习历史、共享存储或答案索引的数据结构。
- 新增前端运行依赖 `lucide@1.39.0`；生产构建会 tree-shake 实际引用的三个 IconNode。
- 悬浮球单击语义由上一轮的“只打开”改回“开/关切换”；长按不会再隐式打开任何已关闭窗口。
- 两个刷新按钮现在都包含各自窗口的位置与尺寸复位，这是有意的交互变化。

## 验证

- `pnpm check`：通过。
- `pnpm test`：152/152 通过。
- `pnpm build`：通过。
- Playwright 真浏览器回归：620px 宽待复习队列的两道题均在结果按钮换行后铺满整行；500px 宽错题页首行保持单行且顺序正确；原题 iframe 实测为 `scrolling=auto`、文档 `touch-action=pan-y`、文档纵向 overflow 为 `auto`。
- 构建产物：`dist/mn4-answer-matcher-v2.3.3-beta.54.mnaddon`。

## 尚需真机验证

- MarginNote 4 `UIWebView` 内单指滑动长原题的触摸手感。
- MN Utils 悬浮球在文档/脑图切换后的开关、关闭态长按无副作用。
- 原生答案窗口刷新按钮的点击热区、左右关闭按钮设置联动与复位尺寸。

