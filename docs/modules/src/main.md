# main.ts — JSB 入口声明（非构建入口）
## 职责
保留 JSB 入口形态供参考与类型校验；真实构建入口 rails-core.ts，分发由 rails-native/main.js + WebAddon 承担。
## 边界
不参与 dist 构建（build.mjs 证实）。