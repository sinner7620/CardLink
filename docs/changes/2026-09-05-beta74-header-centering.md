# v2.3.3-beta.74：悬浮条垂直居中真因修复与预览区顶部呼吸空白

日期：2026-09-05。基线：beta.73（正式渠道，版本号 2.3.3-beta.74）。范围：真机 2 项反馈。

## 根因与实现

1. **悬浮条控件不居中（真因）**：beta.73 修的是 iOS 字体行盒；用户反馈截图显示仍不居中。本次定位到布局层真因——折叠态规则 `.filterBar.filtersClosed` 自 beta.67 起带 `padding-bottom: 0`，胶囊顶部内边距仍为 6px，整行控件在悬浮胶囊内整体偏移。beta.73 的桌面测量只验证了控件之间互相对齐，没有验证控件行相对胶囊外框的居中，属测量盲区。修复：移除 `padding-bottom: 0`，折叠/展开态统一 6px 对称内边距。
2. **预览区来源行与顶栏空白**：beta.72 依当时反馈将详情头部顶部内边距归零，真机显得过挤；按本轮反馈恢复 4px 顶部内边距。

## 教训记录

悬浮胶囊类"垂直居中"验证必须同时测：控件之间中心线一致 + 控件行中心相对容器外框中心一致。已按后者补测量（胶囊中心 80 = 控件行中心 80）。

## 影响文件

`web/src/ui/detail.css`、`web/src/ui/mistakes.css`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.74.md`（新增）。

## 兼容性与数据影响

数据结构、存储键不变；正式渠道 ID 原地覆盖升级；折叠态悬浮条高度 40px → 48px。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.74.mnaddon`（489812 字节，SHA-256 `728D98601B1D6ADD4AAD5CEE8EBF80CFE537CD0C3692397E43BB058B57B8F334`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.74.mnaddon`，副本与原包哈希一致。
- 包内 `mnaddon.json`：正式插件 ID、正式标题、版本 `2.3.3-beta.74`。
- Playwright 实测：胶囊中心 80 = 多选/计数/搜索/折叠中心 80（胶囊高 48px）；详情来源行距顶栏 4px；截图 `output/playwright/b74-header.png`。

## 未验证限制

- 真机观感（PingFang 行盒下悬浮条居中、4px 间距）待复验。
