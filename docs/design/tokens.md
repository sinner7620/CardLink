# 设计令牌速查
## CSS（web/src/tokens.css，第一个导入）
- --mn-accent: #0e8dfd（当前主强调）
- --mn-gray-fill: #d8d8dd（选中灰底）
- --mn-blue-legacy: #5369df / -deep: #3157a4 / -bright: #5c70e6（历史层，勿新增）
- --mn-level-0/1/2: #d70015 / #b25000 / #248a3d
- --z-dropdown: 1000 / --z-native-sheet: 10020 / --z-native-popover: 10050 / --z-glass-max: 2147483000
## TS（src/ui-tokens.ts，原生侧）
- UI_COLORS.accent #3157a4（工具栏查找答案）/ action #d97706（标记错题）
- UI_COLORS.level0/1/2 与 CSS 等级色一致；surface #f7f8fa
## 注意
- CSS 与 TS 两处等级色目前一致，P1-7 深化时合并为构建期单源
- 旧代蓝仅存在于历史层规则（panel.css 内 win 规则），新代码禁用
