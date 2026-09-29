# v2.3.3-beta.81

基线：beta.80。按用户参考图重做总览「学习历史」条形统计图。

## 实现

- **样式**：横轴日期，每个日期一根纵列——圆头胶囊条"新增（绿，下）/复习（蓝，上）"自基线堆叠，列后浅灰竖网格线；非选中列半透明、选中列全饱和；今日列标签"今日"用 accent 色。
- **页签**：`最近一周` / `按月查看`（30 天）两个页签切换，激活页签带 accent 下划线短横；图例（新增/复习）置于页签行右侧。
- **交互**：点击任意列选中该日——条顶显示当日总数，底部给出"当日新增 N 题 / 当日复习 N 题"大数字读数；默认选中今日。切换页签重置为今日。
- 数据源不变：复习取 `records[].history[].at`，新增取 `records[].createdAt`。

## 影响文件

`web/src/main.jsx`（StudyHistoryChart 重写）、`web/src/ui/overview.css`（图表样式重写）、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.81.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright：周视图 7 列 / 月视图 30 列；点击今日列条顶计数与底部读数同步（mock 数据当日为 0，真实数据非零）；截图 `output/playwright/b81-chart-week.png`、`b81-chart-month.png`。

## 未验证限制

- 真机观感（胶囊粗细、非选中透明度）待复验；月视图 30 列在窄面板下的标签密度（每 5 列显示一个日期）待真机确认。
