# v2.3.3-beta.76

基线：beta.75。本版处理两批反馈：13 项控件悬停补齐、设置页 UI 重构（分隔线列表 + Phosphor light 图标 + 使用说明入口）、总览学习历史条形图、刷新转圈通知、悬浮条间距、分隔线消失根治、卡片侧边按钮颜色对齐、答案窗口多候选默认第一个 + 顶部下拉切换。

## 逐项实现

### 悬停反馈补齐
以下控件获得专属可见悬停（此前依赖零特异性基线，被自带动底/边框的专属规则压制）：
- 详情 dock：题目/答案等非激活按钮（灰底 `.14`）、答案候选切换控件、收藏（既有规则保留）
- 等级胶囊 / 剩余天数胶囊：亮度反馈 `brightness(.94)`（胶囊自带状态底色，基线无法覆盖）
- 多选批量栏的修改等级下拉：底色加深至 `.16`
- 待复习页：今日到期/已逾期/未到期/已结束四个状态页签、全部分类与全部等级下拉、+1/+3/+5 题补入按钮、展开全部题目、不会/不熟/掌握三档结果按钮（各自色系加深）、答案预览加减缩放按钮
- 设置页全部设置项行：悬停灰底
- 桌面审计脚本扩展覆盖以上全部选择器，逐项验证悬停前后计算样式变化。

### 设置页重构
- 大类内设置项不再逐项成块：去除每项边框/圆角/底色，改为**横向分隔线**区隔的列表行，行悬停灰底，右箭头弱化。
- 全部设置图标换用 **Phosphor light**（`@phosphor-icons/core` 官方原始 SVG，`?raw` 内联，currentColor 随文字色）：绑定=link-simple-horizontal、匹配方式=tree-structure、刷新=arrows-counter-clockwise、解绑=link-simple-horizontal-break、标记错题=list-checks、定位=crosshair（保留原形变按钮）、导出=download-simple、卡片侧边按钮=cursor-click、版本=info、重置窗口=frame-corners、退出调试=x、使用说明=book-open；去掉原三色图标底，统一 ink。
- 新增「插件使用说明」入口：经 `openPluginGuide` 桥命令用 `MN.app.openURL` 打开网页；链接常量 `PLUGIN_GUIDE_URL`（src/plugin.ts）目前为空串，点击提示"链接尚未配置"——**链接待提供后填入即可**。

### 总览：来源分布 + 学习历史
- 删除来源分布面板的说明小字（头部聚合说明与"有效分类 x/x 道"覆盖注）。
- 新增**学习历史条形统计图**（来源分布面板内）：近 14 天横坐标日期，上排"复习"（蓝）取自 `records[].history[].at`，下排"新增"（绿）取自 `records[].createdAt`；条高按当天数量比例，点击任意条块在面板内显示"X/X：复习 N 题 · 新增 N 题"，再点取消。

### 其他
- **刷新等待转圈**：刷新错题分类索引、刷新答案索引、检查更新期间，顶部中央显示转圈胶囊通知（`pendingNotice`，reduced-motion 减速）。
- **悬浮条间距**：行距与同行控件间距 5-7px → 4px。
- **分隔线消失根治**：分隔线与预览 iframe 同为 z-auto 时后绘制的 iframe 会盖住它；分隔线 `z-index: 2`（pointer-events none，仍在侧栏层之下）。
- **卡片侧边按钮颜色对齐**：标记错题按钮由 off-palette 的 `#d97706` 改为色板内琥珀 `#ff9f0a`（与"不熟"档位同源）；查找答案 accent、三档等级色本已同源不变。
- **答案窗口多候选**：移除多候选时的原生选择弹窗，**默认打开排序第一**（路径匹配分最高）；候选 ≥2 时答案窗口顶部注入「候选答案」下拉条，切换经 `switchAnswerCandidate` 桥命令原位重渲染（窗口位置保持），标准答案带 ★ 标记。

## 影响文件

- `web/src/phosphor.jsx`（新增）、`package.json`（+`@phosphor-icons/core`、版本号）
- `web/src/main.jsx`：PhosphorIcon 接入 SettingsGroup、使用说明项、`pendingNotice`、`StudyHistoryChart`
- `web/src/ui/{settings,review,detail,mistakes,overview,shell}.css`：悬停、间距、分隔线、设置列表、图表、通知样式
- `src/plugin.ts`：PLUGIN_GUIDE_URL、openPluginGuide、switchAnswerCandidate、候选默认第一个（移除 chooseMatch 弹窗）、清理未用导入
- `src/matcher.ts`：answerCardHtml 候选切换条注入
- `src/rails-core.ts`：两条新命令路由
- `src/ui-tokens.ts`：action 色对齐色板
- `scripts/build-web-smoke.mjs`：SVG ?raw 文本内联支持
- `tests/bridge-schema.test.ts`：switchAnswerCandidate 加入仅原生命令白名单
- `RELEASE_NOTES_v2.3.3-beta.76.md`（新增）

## 兼容性与数据影响

- 错题、复习历史、答案索引结构不变；正式渠道 ID 原地覆盖升级。
- 多候选答案不再弹原生选择框（行为变化：默认展示最优候选，窗口内切换）。
- `@phosphor-icons/core` 为构建期依赖（仅原始 SVG），不增加运行时依赖。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.76.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright 验证：设置页 15 行分隔线列表、图标 20px 渲染、行悬停灰底、使用说明入口存在；学习历史 14 条块渲染、点击读出"8/29：复习 0 题 · 新增 0 题"（mock 数据在窗口外，真机有数据）、小字已删；悬浮条间距 4px；分隔线 z-index 2；dock 非激活按钮/收藏/等级/天数/标签栏悬停全部生效；待复习状态页签/下拉/补题按钮/三档结果/折叠按钮悬停生效。
- 真机待复验：Phosphor light 图标观感、答案窗口候选下拉（需多候选绑定）、刷新转圈出现时机。

## 未验证限制

- `PLUGIN_GUIDE_URL` 为空，点击使用说明提示未配置；链接给出后填入即可。
- 答案窗口候选切换依赖 UIWebView 对 `mnaddon://` 导航的处理（与既有桥同通道，理论无碍，需真机点验）。
