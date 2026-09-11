# 边界与设计决策（现状定基）
## 明确不做
- UIWebView 迁移（等官方）；recordId=notebookId:noteId 结构保留；beta 双通道保留
- PKDrawing 解码算法重写（只合并副本）；标题归一化小数点（决策不做）
- prefers-* 可访问性降级（用户取消）；10 秒倒计时（仅首次保留）
- DST 修正（决策不做）；工作台候选懒渲染（暂缓）
## Deferred（需真机回归）
- 断点标量规则 clamp 化深扫；组件内 z-index 全量治理；候选懒渲染；Pointer Events 统一；rubber-band
## 数据边界
- 错题主存储：插件本地存储 v2 键；备份：文档目录真文件；旧键只读兼容健康时置空
- 索引快照：cachePath 按学习集一文件（回读校验）
- 导出产物：exports/ 保留最近 5 份
## 口径（全插件统一）
- 到期 = 本地今天 24 点前（日历日，含已逾期）；已结束复习永不计入
- 纯答案学习集不参与错题恢复扫描
- recordIds 契约：数组（含空）= 严格白名单；未提供 = 全量
## 隐私边界
- 运行日志不含错题正文（标题脱敏为长度#指纹）；导出日志前 HUD 提示
- MD 导出不含内部卡片/脑图 ID；遥测 payload 仅 install_id/版本/渠道
- 联通测试零 UUID、不含笔记内容
## 命名边界
- React 独占面板 DOM；禁止重新引入 MutationObserver/insertAdjacentHTML 型 UI 补丁层
## 平台边界
- 答案卡基于 UIWebView（等官方迁移）
- 原生 UIColor 无动态色 API（暗色适配受限，已知取舍）
- notebook.notes 层级语义有自适应兜底（文档与实测可能不符）
