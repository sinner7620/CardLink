# rails-core.ts — 桥接与生命周期核心
## 职责
JSB 插件核心：bridge() 命令分发（观测层：traceId/耗时/字节/异常，仅调试写日志）、生命周期 handlers、instanceMethods（工具栏/菜单/答题卡/原生复习模式动作）、页面设置数据装配、uiConstants/runtimeLog 命令。`startReviewMode` 接收 Web 端已经筛选好的错题队列，交给原生复习工具条并关闭插件面板。
## 边界
- 唯一真源方法表（main.ts 不参与构建）
- renderPdf 拦截在 WebBridgeCommands 层
- 命令异常在 `bridge()` catch 中统一经 `presentError` 转为 `{ code?, message }`；Web 只依赖 `message`
## 验收
桥协议 schema 测试：web 发送 ⊆ 原生处理 + 白名单；错误信封包含可选 `code` 与必需 `message`；复习模式队列只传定位及展示所需字段。
