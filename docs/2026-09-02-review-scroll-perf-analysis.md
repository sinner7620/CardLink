# 待复习队列滚动不跟手 / 预览答案窗缩放卡顿 — 成因分析（2026-09-02）

> 处理状态（beta.55）：本文定位的全局 MutationObserver、`ui-redesign.js`、`ui-alignment.js` 与 `preview-bootstrap.js` 已全部退役；复习摘要和换行布局已迁入 React/CSS。本文保留为问题归因记录。

> 仅代码调查，未修改代码。结论全部基于当前 beta 工作区代码，附文件:行号证据。

## 问题一：待复习队列数量多后滑动不跟手

### 1.1 每次状态变化全表重渲染，且详情懒加载在滚动期间持续触发（React 层，主因之一）

- `DueReviewList`（web/src/main.jsx:900-1121）没有拆条目组件、没有任何 `React.memo`：`answerZoom`、`answerDetail`、`historyOpen`、`feedbackById`、`queueNotice`、`detailsById`、`questionOpenById` 任何一个 state 变化，都重渲染**全部可见条目**。每条含多个内联 SVG（MorphIcon 每次渲染两条 path，main.jsx:54-59）。
- 详情懒加载 4 并发 worker（main.jsx:977-1002）：每条详情响应一次 `setDetailsById` → 一次全表 reconcile。"展开全部题目"时，滚动帧之间持续插进 N 次全表 diff。
- `visibleRecords`、`openSignature`、`visibleSignature` 每次渲染重算（无 useMemo），条目多时本身也是常数开销。

### 1.2 "预览专用"同步层在真机运行：全文档 MutationObserver + 强制布局（主因之二）

- main.jsx:14-15 无条件 import `ui-redesign.js`/`ui-alignment.js`（注释自称 Preview-only，真机同样执行）。
- `preview-bootstrap.js:33-38`：MutationObserver 观察 `documentElement`、`subtree:true`、`childList+characterData`。sync 虽经 rAF+setTimeout(80) 去抖（:18-32），但每轮 syncFn 都是**全文档 querySelectorAll 扫描**：
  - `ui-redesign.js` 的 `syncDueLevelButtons`/`syncDueGlowLabels`/`syncSettingsDayEditor`/`syncReviewResultsWrap` 各扫一遍；
  - `syncReviewResultsWrap` 读两次 `getBoundingClientRect()`（强制布局）并 toggle class——class 变更又触发 observer 下一轮；
  - `ui-alignment.js` 的 `syncPhosphorSelectionIcons` 对 5 类宿主 classList.add + insertAdjacentHTML，同样自我触发。
- 数量多时，每次 React 更新（1.1 的每次）都跟两轮"全页扫描 + 布局读取 + 再触发"的补丁层同步，直接挤占滚动帧。

### 1.3 滚动路径上的绘制成本与样式重算规模

- 每条 `.dueReviewItem` 都有 `box-shadow: 0 3px 14px rgba(15,43,100,.045) !important` + 1px border + 圆角（panel.css:4839 起，来自 preview 层覆盖）。滚动时 WKWebView 按瓦片栅格化，几百个阴影圆角条目每屏都要重绘。
- 三代 CSS 叠加：`.dueReviewItem`/`.mistakeItem` 在 panel.css 定义 6+ 处（135、2137、2596、2805、3071、4578、4839…），再加 panel-preview.css 的 577 个 `!important`——任何 DOM 变化后的样式重算命中规则数量被放大数倍。
- `html, body` 为 `position: fixed !important; touch-action: none`，滚动区域是 `.reviewPage` 内部滚动 + `touch-action: pan-y !important`（panel.css:3218-3250）——浏览器无法把滚动直接交给合成器快路径，触摸裁定在主线程。

### 1.4 iframe 数量放大器

每条展开的完整原题是一个独立 iframe（srcDoc 全量 HTML，main.jsx:1101），iframe 是独立文档+合成层。"展开全部题目"（main.jsx:959-966）一键全开 → N 个 iframe 同建 + 4 并发详情请求，滚动合成成本陡增。

## 问题二：预览/答案窗缩放、滑动卡顿

### 2.1 答案窗缩放走 React 状态 → 手势每一帧全表重渲染（主因）

`wireReviewAnswerFrame`（main.jsx:884-898）把手势 `applyScale` 直接接到 `onZoom` → `setAnswerZoom`（React state）→ 重渲染**整个 DueReviewList** → `useEffect [answerZoom]` 再调 `applyReviewFrameScale`。touchmove/gesturechange 是 60Hz 事件流，等于每个手势帧做一次几百条目的 reconcile + 一次 iframe 内文档 reflow（见 2.2）。注释（main.jsx:892"缩放应用仍经 React 状态"）自认了这条链路。

### 2.2 applyReviewFrameScale：读写交错 + 改 iframe 高度引发整页回流

`applyReviewFrameScale`（main.jsx:857-878）：
1. 先写 `body.style.transform/width`，**紧接着读** `body.scrollHeight` 与 `documentElement.scrollHeight`——写后读，强制同步布局（layout thrash 经典模式）；
2. 依测量结果写 `frame.style.height`——iframe 高度一变，**列表中其后所有条目全部回流**，滚动位置漂移（缩放时页面跟着跳）；
3. 再排 rAF + setTimeout(80) + setTimeout(300) 三轮 resize——每次缩放共 4 轮强制布局；
4. 还遍历 `frameDocument.images` 补 load 监听。

这是"body transform scale + width 100/scale%"方案：每次缩放都是**布局级**缩放（宽度变化触发 iframe 内全文档 reflow），不是合成器 transform。

### 2.3 预览窗（MistakeDetail）逐帧"写样式→读滚动→写滚动"

`wirePreviewFrame` 的 applyScale（main.jsx:1231-1244）：每个手势事件里 `card.style.transform` + `body.style.width/height`（布局级缩放）→ 读 `frameWindow.scrollX/scrollY`（rememberFocus 在手势起点）→ `frameWindow.scrollTo(...)` 重新锚点。读写在同一事件内交错，多次强制布局/滚动同步；缩放上限 1–3 倍全在主线程完成。

### 2.4 手势管线本身

`src/pinch-zoom.ts` 管线本身是标准写法（touchmove `passive:false` + preventDefault，gesturechange 同），问题不在它，而在它每事件调用的 `applyScale` 上游（2.1-2.3）。`options.gestureEvents:false` 时 iframe 内走 touch 路径，两指触摸期间列表自身滚动与缩放争抢同一手势（`touch-action: pan-x pan-y`，panel.css:3876-3880）。

## 修复方向建议（供后续重构参考，未实施）

1. **缩放改纯合成路径**：手势期间只写 `transform: scale()`（固定布局尺寸，合成器执行），不写 width/height、不 setState；手势结束才把最终值提交一次 state。
2. **切断"手势→全表渲染"链**：answerZoom 等局部 state 下沉到答案窗子组件；条目组件化 + `React.memo`；detailsById 拆 per-item 更新。
3. **退役/条件化 ui-redesign.js、ui-alignment.js**（UI 审计报告 P1-5），消灭全文档 MutationObserver。
4. **长列表渲染减负**：条目 `content-visibility: auto`（屏外条目跳过布局/绘制）；滚动路径阴影减负；"展开全部"限流建 iframe。
5. 验证方式：真机 Safari/WebKit inspector 的 Performance 面板对比"Layout & Render"占比，确认 1.2/2.2 消除后掉帧是否收敛。
