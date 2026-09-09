# 交互与动效规范
## 手势
- 面板：拖拽 1:1 跟随、抓取点保持；缩放期间跳过强制回顶与全页扫描
- iframe 双指缩放：统一 frame-pinch-zoom 管线（锚定 + 第三指恢复）；列表 60–160%，详情/答题卡 1–3x
- 修过的坑：第三指落下再抬起后 startDistance 陈旧 → 自动重新锚定
## 动效
- 只动 transform/opacity；折叠/展开 0.15s ease-out
- 按压反馈：opacity .62 / brightness .96（a11y.css，最后导入）
- morphIcon 合成属性动画用于页签/按钮状态切换
## 禁止
- 布局属性（left/width/top）过渡；逐帧强制回顶；resize 期间全页 MutationObserver 扫描
