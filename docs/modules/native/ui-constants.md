# ui-constants.js — 共享 UI 常量（P1-7）
## 职责
TITLE_HEIGHT/CONTROL_CLUSTER_WIDTH/MIN_WIDTH/MIN_HEIGHT 单一来源；JSB 全局作用域供原生各模块读取；经 uiConstants 桥命令下发 web 写入 CSS 变量。
## 验收
≤800px 时 CSS 顶栏高度与原生拖拽热区同源。