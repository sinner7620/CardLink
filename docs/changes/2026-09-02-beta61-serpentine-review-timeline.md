# beta.61 复测历史蛇形时间轴

日期：2026-09-02  
版本：2.3.3-beta.61

## 目的

按最新交互要求取消复测时间轴的横向滚动：节点超过一行容量时在当前侧弯到下一行，下一行反向排列，持续蛇形换行，并在最终路径末端显示箭头。

## 实现

### 响应式排布

- `ReviewTimeline` 通过 `ResizeObserver` 读取时间轴的实际内容宽度，面板缩放后即时重排。
- `buildSerpentineTimeline()` 结合节点固定宽度与原有按复习时间差生成的间距，逐个判断当前行是否仍可容纳下一节点。
- 时间间距仍保持相对差异，但对单段最大距离按当前行宽的三分之一做响应式上限，避免一次长间隔造成大量只有单节点的空行。
- 行号为偶数时从左向右，行号为奇数时从右向左；DOM 顺序始终保持复习历史顺序。

### 连续路径

- SVG 路径穿过每个节点圆点。
- 每行最后一个节点先延伸到当前侧边，再使用 cubic Bézier 曲线弯到下一行同侧起点。
- 左右弯道随行方向交替，不在换行处跳断。
- 最后一行沿当前方向延伸并使用 SVG marker 绘制开放式箭头。

### 滚动与触摸

- 删除 beta.60 的拖动阈值、pointer capture、`scrollLeft` 修改和 grabbing 状态。
- 时间轴 `overflow` 改为可见，高度由行数计算；不再拥有横向滚动范围。
- 保留 `touch-action: pan-y`，时间轴区域的手指移动只参与待复习页纵向滚动。

## 影响文件

- `web/src/main.jsx`
- `web/src/ui/review.css`
- `web/src/lib/previewBridge.js`
- `tests/web-bridge.test.ts`
- `tests/ui-stage2-visual.spec.js`
- `package.json`
- `README.md`、`docs/README.md`、`交接文档.md`

## 兼容性与数据影响

- 不修改复习历史数据、时间戳、等级、错题记录、桥协议或共享存储。
- 仅将原有时间差像素间距输入新的响应式排版函数；历史节点顺序不变。
- CSS 继续保持 0 处 `!important`。

## 验证

- `pnpm check` 通过。
- `pnpm test` 通过，158/158。
- `pnpm exec playwright test "tests/ui-stage2-visual.spec.js"` 通过，3/3。
- 500px 视口加载 12 个历史节点后产生 4 行；第一行 x 坐标递增、第二行 x 坐标递减。
- SVG 主路径存在 `marker-end`，最终显示方向箭头。
- 时间轴 `scrollWidth <= clientWidth + 1px`，页面根横向溢出不超过 1px。
- 可视截图：`output/playwright/beta61-serpentine-500.png`。
- `pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.61.mnaddon`。

## 真机复核

- 真机重点检查 2～20 个节点、窗口连续缩放、极长复习间隔、系统字体放大，以及时间轴区域纵向滑动页面。
