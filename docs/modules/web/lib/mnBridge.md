# lib/mnBridge.js — 原生桥接（前端侧）
## 职责
send(command, payload)：mnaddon:// scheme + iframe + 30s 超时；大响应 65536 分块拉取；runtimeLog 前端诊断通道（超时/解析失败/全局异常写入原生环形缓冲）；window.onerror/unhandledrejection 捕获。原生错误可为历史 string 或 `{ code?, message }`，调用页面继续只显示 `reason.message`，无需理解错误码。
## 边界
- 长任务（PDF 导出）已任务化，30s 超时只影响普通命令
- 日志失败静默不影响主流程
## 验收
超时/解析失败进运行日志；分块拉取对上层透明。

## 场景命令与练习事件

场景工作台通过 `createSceneTransport` 发送命令并处理练习事件；创建时必须提供批注客户端，缺失时在注册监听前报出“练习批注客户端尚未初始化”。卡片菜单使用 `createSceneCommandTransport`，只保留场景校验、命令发送、超时和 `mn:bridgeResponse` 回执，不注册 `mn:reviewAnnotationOpen`、`practice`、`comments` 或工作台刷新通知。

同一 window 的练习事件由一个工作台控制器处理；新建控制器先销毁旧控制器。`dispose()` 注销 DOM 监听、拒绝未完成的命令并清除计时器；旧 SDK 回调保留注册但通过销毁状态忽略后续事件，旧控制器的迟到练习结果不再回传。销毁不会关闭或撤销已经开始的宿主编辑/写入。命令请求编号在同一 window、同一前缀下持续递增，避免通道重建后把旧回执用于新请求。

回归覆盖菜单反复标错后配置、历史、评分及状态请求各回复一次，工作台通知不重复、监听销毁与替换、旧配置结果和旧命令回执的隔离。MarginNote 设备行为须另行验收。

缓存页以scanLocalCache / clearLocalCache启动原生分批任务，每200ms调用localCacheTaskStatus读取阶段和计数。每次桥接请求独立结束，不以单次30秒请求覆盖整个扫描或清理；最终done.result接收统计与失败原因。关闭组件停止轮询，原生已受理任务继续完成；用户再次主动操作时可接续仍在运行的任务，不自动扫描。

缓存移入回收站后仍占空间，done.result.removed仅表示移入数。groups中的recycle分类含recyclePath实际路径，用于只读展示手动删除说明；不进入可选清理列表。用户手动删除后由主动重新扫描更新占用。
