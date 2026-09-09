# globals.d.ts — 全局类型
## 职责
构建期注入常量类型声明（__APP_VERSION__ 等）；self/window 环境声明。
## 边界
self: any 削弱类型检查（已知取舍）。