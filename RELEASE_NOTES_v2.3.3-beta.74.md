# v2.3.3-beta.74

基线：beta.73。处理真机 2 项反馈：预览区顶部与顶栏的呼吸空白、悬浮筛选条控件行在胶囊内的垂直居中。

## 逐项根因与实现

1. **预览区来源行与顶栏留一点空白**：beta.72 把详情头部顶部内边距完全归零，真机上来源行紧贴顶栏。恢复为 4px 顶部内边距（`detail.css` `.detailHeader { padding: 4px var(--detail-inset) 4px }`），实测来源行距顶栏 4px。
2. **悬浮条控件不居中（真因）**：折叠态规则 `.filterBar.filtersClosed` 自 beta.67 起带 `padding-bottom: 0`，而胶囊顶部仍有 6px 内边距——整行控件（多选、计数、搜索、折叠）在悬浮胶囊内整体偏离垂直中心。之前桌面测的"对齐"是控件之间互相对齐，未测控件行相对胶囊外框的居中。移除 `padding-bottom: 0`，折叠态与展开态统一使用胶囊 6px 对称内边距；实测胶囊中心与控件行中心完全一致（80 = 80，胶囊高 48px）。

## 影响文件

- `web/src/ui/detail.css`：详情头部顶部内边距 0 → 4px。
- `web/src/ui/mistakes.css`：`.filterBar.filtersClosed` 移除 `padding-bottom: 0`。
- `package.json`：版本 `2.3.3-beta.73` → `2.3.3-beta.74`。

## 兼容性与数据影响

- 数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。
- 折叠态悬浮条高度 40px → 48px（与展开态胶囊内边距一致），顶栏总高不受影响。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.74.mnaddon`。
- 包内 `mnaddon.json`：正式插件 ID、正式标题、版本 `2.3.3-beta.74`。
- Playwright 实测：悬浮条胶囊中心 80 = 多选/计数/搜索/折叠中心 80；详情来源行距顶栏 4px（截图 `output/playwright/b74-header.png`）。
- 真机待复验：悬浮条视觉居中（PingFang 行盒）、来源行 4px 间距观感。
