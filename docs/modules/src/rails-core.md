# rails-core.ts — 桥接与生命周期核心
## 职责
JSB 插件核心：bridge() 命令分发（观测层：traceId/耗时/字节/异常，仅调试写日志）、生命周期 handlers、instanceMethods（工具栏/菜单/答题卡动作）、页面设置数据装配、uiConstants/runtimeLog 命令。
## 边界
- 唯一真源方法表（main.ts 不参与构建）
- renderPdf 拦截在 WebBridgeCommands 层
## 验收
桥协议 schema 测试：web 发送 ⊆ 原生处理 + 白名单。