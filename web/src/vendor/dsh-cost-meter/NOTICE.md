# dsh-cost-meter（上游 UI 源码移植）

- 上游：https://github.com/Han-1413141/dsh-cost-meter
- 锁定提交：`cff8dcdf115c4e29342d458d539c48329a17c1a9`
- 许可：MIT（见同目录 `LICENSE`）
- 版权：Copyright (c) 2026 dsh-cost-meter contributors

本目录只包含 CardLink AI 对话页「上下文」面板的费用卡片与按日表格所用渲染与样式。
上游是 DeepSeek Harness 的费用统计插件（会话费用、账本、额度、峰谷定价、价格目录），
CardLink 只移植其中的**展示层**，数据来自 H1 自己的本地费用估算（§22）。

## 逐文件对照

| 上游路径 | 本地路径 | 修改 |
| --- | --- | --- |
| `src/client/03-settings-panels-main.js`（`Card`） | `card.jsx` | 上游 `el()` vnode 等价改写为 JSX；DOM 结构 `div.cm-card > p.cm-card-title + div.cm-card-value.cm-num + p.cm-card-sub` 与类名逐项一致。 |
| `src/client/03-settings-panels-main.js`（`HistoryTable` 日期行） | `card.jsx`（`CostTable`） | 只拆出按天表格骨架（`cm-scroll`/`cm-table`/`thead`/`num` 列）；去掉日期行点击展开当日会话、会话子表与 `cm-row-click`（H1 没有会话账本）。 |
| `src/client/01-open-styles-i18n.js`（内联 `css` 数组） | `styles/cost.css` | 按使用拆离：`.cm-cards`/`.cm-card*`/`.cm-num`/`.cm-scroll`/`.cm-table*`/`.cm-sess-title`/`.cm-sess-id`/`.cm-empty`/`.cm-hint`/`.cm-note`/`.cm-h`/`.cm-msg*`/`.cm-btn*` + 两条 `.cm-cards` 响应式媒体查询；取值逐字保留。 |

## 未引入的上游能力

账本与历史同步（`remote.costMeter.*`）、宿主角色的 `costUsage` 投影、模型价格目录
（models.dev）、峰谷时段与币种换算、余额/额度查询、Codex 与其他订阅适配、费用明细
弹窗与内容读取、自动匹配与自定义价格配置。CardLink 的费用口径是 §22 的本地估算
（用户手动费率快照），不联网取价。

## 发行包

`build.mjs` 会把本目录 `LICENSE` 复制为安装包的 `licenses/dsh-cost-meter-LICENSE.txt`，
并在 `THIRD_PARTY_NOTICES.txt` 中记录来源、提交与修改说明。
