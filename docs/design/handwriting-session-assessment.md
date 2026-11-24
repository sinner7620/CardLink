# 手写会话与 CardLink 做题／复习的接入评估

核对日期：2026-10-31。范围为当前官方在线文档和 CardLink 2.4.6-b66 源码；未连接 MarginNote 设备，不构成目标设备能力验收。初次评估只修改模板副本；后续 b67 已接入下述焦点卡路径，尚未完成设备验收。

## 模板配置

用户导出的“我”模板已放行 CardLink，已有卡片菜单与顶部入口，但没有 `pluginConfigs`。插件已安装、已放行不代表已经配置原生作答判定。

为 `marginnote.extension.mn4-answer-matcher` 增加：

```json
{
  "v": 1,
  "tagPrefix": "cardlink-practice",
  "reasons": [
    { "key": "concept", "label": "概念不清" },
    { "key": "formula", "label": "公式遗忘" },
    { "key": "approach", "label": "思路受阻" },
    { "key": "calculation", "label": "计算失误" },
    { "key": "reading", "label": "审题遗漏" },
    { "key": "time", "label": "时间不足" }
  ]
}
```

档案中的 `pluginConfigs[addonid]` 由宿主转换为 `GET /immersive/template` 的 `plugins[].config`。下一轮批注做题／复习首次检测时读取配置；进行中的会话不热切换。仍须宿主提供作答判定路由，且插件处于 allowed 状态。

此配置提供允许使用的错因词汇，不会自动产生 UI。当前 b66 原生批注反馈仅提交 `self`，没有让用户选择并提交 `reason`；普通智能复习的多选错因与原生接口的可选单个 `reason` 也不是同一份协议。不得声称导入此模板就已经记录了用户本次错因。

## 手写会话是什么

官方将 `/writing/*` 分为观察、保存、作答转场、专用层租约、练习计划与练习会话记录。载体为焦点卡 `focus` 和留白 `blank`。会话可以表达一趟练习、每次尝试、暂停、恢复、退出、评估及已保存专用层的历史预览。

它不是手写识别接口，也不是 `/notes/{noteid}/annotation-editor` 的另一种名称。练习 `runId`／`attemptId`、手写 `layerId` 与卡片批注 `commentId` 必须分别处理。文档没有保证开始会话会追加一条卡片批注。

## 可接入范围与边界

| 能力 | 接入判断 |
| --- | --- |
| 焦点卡／留白作答 | 适合成为 CardLink 独立原生书写载体，保留当前题目队列和复习调度；实际可用须检查设备能力与上下文。 |
| 当前层练习 | 文档能力项 `practiceOnCurrentLayer` 的示例为 `changesLayer: false`、`createsAttempt: false`、`takesLease: false`；不能把它当作每次隔离的新作答。 |
| 分层练习与恢复 | 文档有专用路由，但能力示例 `managedLayerTrial.ready: false`、`canSwitch: false`、`createsAttempt: false`。有路由不代表可以启用。 |
| 历史预览 | 仅已退出尝试的专用层内已保存笔迹；不含未保存画布及未分层文字、图片。不能直接替代当前批注历史的全部内容。 |
| 练习评估 | 有 `session-assess`，具体扩展字段要求查运行时 `/guide`。它与 `practice-verdict` 是不同接口，不能假定会自动写同一套标签或复习等级。 |
| 多设备恢复 | 文档中的准备清单、会话记录与租约为设备本地存储；不能据此承诺跨设备会话同步。 |

能力页示例标注为 2026-10-07、Bridge API 0.91，其中 `practiceSessionRecord.canCreate: true`，但 `ready: false`、`canSwitch: false`，顶层 `managedLayers`、`snapshot`、`switch` 等也为 false。这只能说明该示例环境，不证明用户的 MN4 4.5.0 当前支持或不支持。官网有该族接口也不能推出它仅适用于 MN5。

## 后续实现所需的设备证据

先读取目标设备 `/capabilities`、`/guide`、`/writing/capabilities`，再读取当前窗口的写作上下文。分别核对面板调用白名单、载体、分层与会话 readiness、保存结果与切题许可。观察接口返回的上下文不是写入授权。

只有对应能力可用时才进入焦点卡／留白会话。使用稳定 `requestId` 查询转场结果，按 `settled`、`outcome`、`ready`、`canSwitch` 判定，而非 HTTP 200。退出后重新读取会话记录和保存结果；`persisted: true` 可能只确认记录，不能直接推论画布已保存。租约结果未定时读取租约与会话记录，避免盲目重开覆盖。

若用户仍要求每次新增卡片批注，则需另行设计“已保存尝试 → 新增批注”的输出及身份关联；不能仅凭 `attemptId` 存在就宣称完成该要求。

## 官方来源

- [当前文档索引](https://dev.marginnote.com.cn/llms.txt)
- [模板接入插件](https://dev.marginnote.com.cn/zh/template-plugins.md)、[模板包结构与导入](https://dev.marginnote.com.cn/zh/basic-package.md)
- [提交作答判定](https://dev.marginnote.com.cn/api-reference/卡片与摘录/提交作答判定.md)
- [手写能力清单](https://dev.marginnote.com.cn/api-reference/手写会话/获取手写能力清单.md)
- [开始焦点卡分层练习](https://dev.marginnote.com.cn/api-reference/手写会话/开始焦点卡分层练习.md)
- [查询练习会话记录](https://dev.marginnote.com.cn/api-reference/手写会话/查询练习会话记录.md)
- [退出当前练习尝试](https://dev.marginnote.com.cn/api-reference/手写会话/退出当前练习尝试.md)
- [查询作答预览](https://dev.marginnote.com.cn/api-reference/手写会话/查询作答预览.md)
- [记录练习评估](https://dev.marginnote.com.cn/api-reference/手写会话/记录练习评估.md)


## b67 已实现范围

“手写会话”成为做题／复习的独立选择，替代原插件内画布入口。先查实时能力与指南，当前仅接入焦点卡专用层；每题单独保存准备清单、创建运行、预留尝试、开始分层作答。切题、评分与退出都先校验 pencil-result 的快照确认和 canSwitch，再退出尝试；最终释放运行身份才结束。未知请求使用同一个 UUID 查询，不重复创建。没有接入留白、跨重启恢复界面或专用层历史浏览。CardLink 等级保存与宿主手写记录分离，不发送未核实的 session-assess 扩展字段。


## b68 错因选择

b68 已补上原生批注的错因选择入口，使用本轮模板词汇并提交单个 reason；普通标记、脑图和手写反馈使用内置词汇。取消不提交等级，原生响应须确认所选错因。此项不改变手写会话载体及尚未真机验收的限制。
