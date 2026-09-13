# 交互与动效规范
## 手势
- 面板：拖拽 1:1 跟随、抓取点保持；缩放期间跳过强制回顶与全页扫描
- iframe 双指缩放：统一 frame-pinch-zoom 管线（锚定 + 第三指恢复）；列表 60–160%，详情/答题卡 1–3x
- 修过的坑：第三指落下再抬起后 startDistance 陈旧 → 自动重新锚定
## 动效
- SVG 图标形变按 [AGENTS.md](../../AGENTS.md) 使用官方 Morphicons `createMorph`；禁止用 transform/opacity 组合伪造形变。
- 普通 CSS 动效优先 transform/opacity，并尊重 `prefers-reduced-motion`；折叠/展开 0.15s ease-out 为既有设计参考。
- 按压反馈：opacity .62 / brightness .96（a11y.css，最后导入）
- 页签/按钮的图标形状切换由 Morphicons 处理，创建时使用 `reducedMotion: "user"`；普通按压反馈和加载旋转无需 morph 引擎。
## 禁止
- 布局属性（left/width/top）过渡；逐帧强制回顶；resize 期间全页 MutationObserver 扫描
