# tokens.css — 设计令牌（P1-4）
## 职责
第一个导入的样式层：主强调 --mn-accent #0e8dfd、选中灰 --mn-gray-fill #d8d8dd、旧代蓝 legacy 别名、三档等级色 --mn-level-0/1/2、跨上下文 z-index 锚点（--z-dropdown/--z-native-sheet/--z-native-popover/--z-glass-max）。
## 边界
- 1–200 的 z-index 为组件内局部层级，治理 deferred
## 验收
改主题只改此文件；无硬编码色散落（存量 legacy 别名除外）。