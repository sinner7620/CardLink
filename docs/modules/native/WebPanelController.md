# WebPanelController.js — 面板原生容器
## 职责
面板窗口创建/布局/拖拽/缩放/关闭（记忆与恢复）、WebView 宿主、resize 手柄、滚动锁（拖拽缩放期间不强制回顶）、常量来自 ui-constants。
## 边界
- 拖拽缩放期间跳过 contentOffset 强制复位（缩放卡顿修复）
## 验收
拖拽/缩放 1:1 跟随、抓取点保持；面板已滚动时缩放不抖动。