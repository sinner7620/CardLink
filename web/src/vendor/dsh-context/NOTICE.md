# dsh-context（上游 UI 源码移植）

- 上游：https://github.com/bowenliang123/dsh-context
- 锁定提交：`459e2369a4ff6caee912cf8b6dfc35cfac8c77c1`
- 许可：Apache License 2.0（见同目录 `LICENSE`）
- 版权：Copyright 2025 bowenliang123

本目录只包含 CardLink AI 对话页「上下文」面板实际使用的渲染与样式代码。上游是
DeepSeek Harness 的浏览器端插件，与本插件共享同一批 `--dsw-*` 主题变量；
CardLink 通过 `styles/cardlink.css` 把这些变量映射到自己的语义 token，因此上游
CSS 的取值不需要改写。

## 逐文件对照

| 上游路径 | 本地路径 | 修改 |
| --- | --- | --- |
| `src/shared/categories.ts` | `categories.ts` | 保留 `PartsPart`/`CATS`/`CAT_COLOR` 原样；`partsOf` 的入参从宿主 `Snapshot['current']` 改为 `Record<string, number>`；未移植 `officialParts`/`anchoredParts`/`billedParts`（依赖宿主组成投影与计费账本）。 |
| `src/client/reserve.ts` | `reserve.ts` | 原样。 |
| `src/client/components/tip.tsx` | `tip.tsx` | 仅 import 路径。 |
| `src/client/components/stackedBar.tsx` | `stackedBar.tsx` | import 指向本地文件；`ViewKit` → 本面板使用的 `LcKit`（t/fmt/catLabel）；渲染、类名、ARIA 与键盘语义未改。 |
| `src/client/components/currentComposition.tsx` | `currentComposition.tsx` | `IconGauge`（上游私有 primitives）→ lucide-react `GaugeIcon`（同尺寸 14）；`Headline` 指向本地文件；结构与类名未改。 |
| `src/client/headline.ts` | `headline.ts` | 只保留 `Headline` 形状与 `occupancyPercent`；`headlineOf()` 依赖宿主 `ContextTimeline`/`ContextPressure`/`ContextBreakdown`，未移植（H1 用遥测行直接构造同一形状）。 |
| `src/client/viewkit.ts` + `src/client/i18nZh.ts` + `src/client/format.ts` | `kit.ts` | 只取 `t`/`fmt`/`catLabel` 三个能力与用到的中英文案（键名与中文原文照抄）；允许调用方覆盖 `catLabel` 以使用 H1 分项名。 |
| `src/client/components/trendChart.tsx` + `trendModel.ts` | `trendChart.tsx` | 拆离移植：保留图表框架（轴/网格/柱/堆叠分段/压缩 ✂ 标记/每 5 根序号/轮次行/悬停读数）与全部类名；去掉 DNA 条带、耗时曲线、增量模式、自适应、虚拟滚动与轮次选择（H1 无对应数据）；`TURN_FILLS` 原样。详见文件头注释。 |
| `src/client/styles/base.css` | `styles/base.css` | 按使用拆离；`.lc-root` 的整页内边距/背景/滚动未移植（面板容器为 `.lc-cardlink`）；Tailwind 生成的 `animate-lc-stacked-in` 用等值普通规则 + 关键帧替代。 |
| `src/client/styles/stats.css` | `styles/stats.css` | 只保留卡片副标题、概览数字/百分比与 `.lc-pi-*` 事实行。 |
| `src/client/styles/stackedBar.css` | `styles/stackedBar.css` | 原样；仅把 `body[data-ds-dark-theme]` 选择器改为 `.lc-cardlink.lc-dark`（同一取值）。 |
| `src/client/styles/trendChart.css` | `styles/trendChart.css` | 只保留精简版趋势图使用的规则；上游柱子的 `hover:bg-(--dsw-alias-interactive-bg-hover)` 用等价普通规则替代。 |
| `src/client/styles/tailwind.css` | （并入 `styles/base.css`） | 只取 `lc-stacked-in` 关键帧与 0.4s/40ms 错峰时长。 |

## 未引入的上游能力

宿主挂载（`window.__ModuleLoader__` / 插槽注册）、本地账本与统计服务、HTTP 路由、
模型价格目录与余额查询、DNA 条带、耗时统计、上下文浏览器与弹窗、i18n 多语言。
CardLink 只使用这些组件作为面板内的展示层，数据来自 H1 自己的遥测命令
`harness.getContextInsights`。

## 发行包

`build.mjs` 会把本目录 `LICENSE` 复制为安装包的 `licenses/dsh-context-LICENSE.txt`，
并在 `THIRD_PARTY_NOTICES.txt` 中记录来源、提交与修改说明。
