# Focus Switch 评论折叠与评论答案接入评估

2026-11-08。检查同步文件夹 `Focus Switch-v1.1.3 2.mnaddon` 中的 FocusSwitchComments.js、FocusSwitchSource.js、FocusSwitchCommentDiagnostics.js 和入口，未连接设备。解包参考仅保存在本机 temp/focus-reference，不纳入插件。

## 已确认的实现

Focus Switch 按当前窗口、学习集和选中卡片取得 ID，经 Database.getNoteById 定位卡片。它要求卡片对象实际提供 `commentState()` 和 `setCommentsCollapsed(targets, collapsed, expectedRevision)`，没有用 CSS 遮盖冒充原生折叠。

读取回执要求 ok、noteid、revision 和按 1 起始排列的 comments；写入携带完整评论投影的 revision，检查 persisted、requestedCount、changedCount、affectedOwnerNoteIds，再回读验证。失败不重试写入。任务分阶段排队，窗口/学习集或开关变化后停止。

折叠范围不是简单的“所有评论”：识别到来源边界时保留原题链接上方内容；否则，有主摘录时从评论 1 开始，无主摘录时保留第一项作为正文。展开操作把目标评论恢复为展开状态，**不等于恢复用户之前的折叠状态**。

## 文档证据与版本界限

- [classic MBBookNote 文档](https://mn-docs.museday.top/reference/marginnote/mb-book-note/)列有 comments 及评论增删/排序，但本次读取的正文未列出以上两个方法；不能据此断言宿主一定没有它们。
- 按[开发者文档索引](https://dev.marginnote.com.cn/llms.txt)找到[评论折叠接口](https://dev.marginnote.com.cn/api-reference/卡片与摘录/折叠或展开卡片批注.md)。该页明确是场景面板的 `/bridge/v1` API，具有 revision、1 起始 index 和实际 ownerNoteId 语义，不能作为 MN4 classic JSB 两方法已可用的证据。[面板之外](https://dev.marginnote.com.cn/zh/jsaddon.md)说明 JavaScriptCore/JSB 层，但没有给出这两个方法的版本保证。
- [MN Utils 作者帖](https://bbs.marginnote.com.cn/t/topic/49699)指向 [API 文档](https://mnaddon.craft.me/mnapi)与[更新文档](https://mnaddon.craft.me/utils)。两页本次 HTTP 访问均为 403，未取得相应封装方法的证据。

## 接入判断

可以借鉴上述边界识别、revision 校验、保存回执和失败停止机制，但现有证据不足以把原生评论答案直接作为目标 MN4 已支持功能交付。本轮完成研究，不新增或启用评论答案绑定，不把 MN5 REST 路由接到 MN4。

评论答案还需要独立的答案边界规则：普通备注、来源链接、练习批注与答案不能只凭“第几条评论”永久区分；复习中应记录当前题目的折叠快照，揭晓只展开该题答案，退出时恢复未被外部修改的状态。稳定 commentId 缺失时，必须绑定 revision 并在评论变化后停止，不能继续使用过期序号。引用评论的修改会影响实际归属卡片，也需纳入作用范围。

后续若有用户提供的目标宿主版本与插件原生回执，可验证 JSB 方法、普通/图片/手写/引用评论的保存与撤销行为，再决定接入。当前仅证明安装包包含相关调用及校验逻辑，不证明用户设备上已成功执行。未读取 MN Bridge 地址、令牌、配置或设备能力缓存，未调用 MN Bridge。
