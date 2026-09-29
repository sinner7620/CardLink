# 2026-09-03 beta.65 — 错题详情 UI 重构：状态方块、标签栏与悬浮操作条

## 目的（用户需求原文归纳）

1. 题目标题与上方小字来源保持不动；
2. 标题两行最右侧（原定位原题 + 折叠按钮的位置）改为一块圆角矩形**状态标识方块**：上部展示错题等级标识与对应色系，下部放置原标题下方的剩余天数信息，比例上等级为主、剩余天数为辅；
3. 原添加日期 + 剩余天数一行改为**标签栏**；
4. 其余控件整合为悬浮于预览窗口上的**圆角操作条**：从左到右依次为 题目、答案、收藏、定位原题、取消错题、折叠；折叠收起为一个圆点，点击圆点展开；
5. 操作条可跟手拖动、自动吸附预览窗口四边，停靠左右边时自动切换为纵向排布；
6. 遵循当前插件 UI 规范（rd-* token、统一色盘）。

## 实现（web/src/main.jsx + web/src/ui/mistakes.css）

### 结构

- `detailHeader`：左列 `detailHeadingBlock`（来源行 + 标题行，类名与样式不变）+ 右侧 `detailStatusCard`。
- `detailStatusCard`：等级名（17px/800，按 0/1/2 档取 `--mn-level-0/1/2` 色系，卡片底/边框用对应 rgba 色调）为主；下方 `detailStatusDue`（10px，muted，"已到期"时用 level-0 色强调）为辅。原 `previewLevelSelect` 以透明覆盖层形式铺满整块（`opacity:0` 绝对定位），点击方块即弹系统等级选择器——改等级逻辑（`updateLevel`）零改动。
- `detailTagPicker detailTagBar`：原标签弹层组件整体迁移，触发器改为标签芯片栏（`detailTagBarTrigger` 渲染 `#标签` 芯片；无标签时显示"＋ 标签"）；弹层（detailCategoryMenu）与外部点击关闭逻辑复用。
- `detailStage`（position:relative）包住 `cardFrame` + 悬浮条；操作条与圆点绝对定位于预览窗口内。
- `detailActionBar`：题目 / 答案（含多答案时 `answerVariantSelect`） / FavoriteButton / LocateButton（`preview-locate-button` 类保留）/ detailRemoveMistake（含再次确认态）/ 折叠钮。`detailTabs`、`detailTabRightGroup detailTabAux`、`detailCollapseToggle`、`preview-collapsed`、`preview-detail-meta`、`preview-due-badge`、`detailTagTrigger` 全部退出 JSX。

### 悬浮条拖动吸附（useDockableBar hook）

- 状态模型 `{ edge: top|bottom|left|right, ratio: 0.06–0.94, collapsed }`，localStorage 键 `mn-detail-bar` 持久化（默认底部居中横排）。
- Pointer Events：pointerdown 记起点并 `setPointerCapture`；位移 ≥6px 才算拖拽（拖拽态内联跟随指针）；pointerup 按指针到四边距离取最近边吸附，ratio 为沿边投影占比。
- 拖拽结束后的 click 在捕获阶段拦截（`onClickCapture`），防止误触条内按钮；`touch-action: none` 防滚动冲突。
- 横竖排布：停靠 top/bottom 为横向圆角长条，left/right 为纵向（`flex-direction: column`），随吸附边自动切换。
- 折叠：折叠钮把操作条收成 40px 圆点（`detailBarDot`），同位置同停靠参数，可继续拖动，点击圆点展开。

### CSS

- 新样式以"beta.65 错题详情重构"注释块插入 `mistakes.css` 的 mn-ui-base 层末尾；全部取色来自现行 token（`--rd-*`、`--preview-ui-*`、`--mn-level-*`），未引入新色值体系（等级 rgba 色调由 `--mn-level-*` 十六进制换算，属同色系）。
- 退役规则清理：`scripts/migrate-detail-ui-css.mjs` 移除 126 个退役选择器（两代 .detailTabs 布局、aux 组、折叠钮、collapsed 态、meta 行、due 徽章、旧标签触发钮、`.preview-detail-title-row > button`），并手工删除两处与纵向布局冲突的遗留规则（`.detailHeader { order: 1 }`、priority 层 `.detailTagPicker { flex: 1 1 180px }`——后者在纵向 flex 容器里会变成 180px 高度基准，曾导致标签栏悬空）。

## v2 修订（同日，按用户反馈重设计状态区）

- 初版的大圆角状态方块（等级+说明文字+到期堆叠）被否决：体积过大、文字冗余。
- 重设计为**两枚小芯片**（`detailStatusCol` 纵向列，右对齐）：
  - 等级芯片 `detailLevelChip level level{N}` —— 直接复用列表同款 `.level` 控件（controls.css 的 27px 圆角芯片 + `--mistake-level-*` 色底），透明 select 覆盖芯片用于改等级；
  - 剩余天数芯片 `detailDueChip` —— 按到期状态取同一三档色系：已到期→`--mistake-level-0`、今天到期→`-1`、未来→`-2`、已结束→中性灰；仅显示状态文字。
- 标签栏紧贴标题行（`detailTagRow` flex 行），行尾新增**灰底添加日期方框** `detailAddedDate`（`--preview-ui-soft` 底、10px muted 文字、min-width 84px 与上方芯片列对齐）；标签栏右缘不越过等级控件左缘。
- 移除 `detailStatusCard` 全族样式与"错题等级 · 点击调整"说明文字。

## v3 修订（同日，按用户澄清：等级与剩余天数同块上下分割）

- `detailStatusCol` 双芯片列改回单容器 **`detailStatusCard`**：圆角方块（rd-line 描边、rd-surface 底、overflow hidden），内部上下分割——上半 `detailLevelChip`（复用全局 `.level` 软芯片观感：tint 底 + 状态色文字）、下半 `detailDueChip`（按到期状态 tint 底 + 状态色文字），仍只显示两行状态文字。
- 发现并适配：controls.css priority 层存在全局 `.level` 胶囊化规则（999px 圆角 + tint 底，全插件等级芯片的实际观感），方块内分段需在 mistakes.css priority 层加 `.detailStatusCard .detailLevelChip { border-radius: 0 }` 覆盖才能成为满宽分段。
- `detailAddedDate` min-width 88px 与方块对齐；标签行结构不变。

## v4 修订（同日，按用户澄清：两枚胶囊横排 · 分隔）

- 撤销 v3 的单容器上下分割，改为 `detailStatusRow` 横向排列：等级胶囊（全局 `.level` 软胶囊观感，透明 select 改等级）+ `·` 分隔符（`detailStatusSep`，`--rd-faint`）+ 剩余天数胶囊（`detailDueChip` 恢复 999px 胶囊），各自保留对应状态色。
- 移除 v3 在 priority 层的 `.detailStatusCard .detailLevelChip { border-radius: 0 }` 分段覆盖（胶囊形态不再需要）。
- 标签行 `margin-top` 6px → 4px；header 高度随横排胶囊回落，标题与标签栏之间的大空隙消除。
- `detailAddedDate` min-width 维持 88px，与胶囊行右对齐。

## v5 修订（同日，按用户反馈：条内控件去按钮 chrome）

- 悬浮操作条内所有控件不再各自带一层按钮样式：题目/答案/折叠/多答案选择器去边框与底色（`border: 0; background: transparent`），仅以空隔排布；操作条容器自身保留唯一的圆角胶囊 chrome。
- 选中态统一走插件强调色：`.active` 用 `--rd-accent-tint` 底 + `--rd-accent` 文字。
- 定位钮（controls.css priority 的白底边框）、收藏钮（favorited/hover/phase 的奶油底金边）、取消错题（priority 层 `.batchRemove` 组的红底 `#efcaca` 边框与 `opacity:.42`）在条内经 mistakes.css priority 层定点解除；收藏的金色星标形态保留。
- controls.css 清退两条仅服务旧详情条的退役规则（`.preview-locate-button` 白底边框组、`.detailCollapseToggle` 组；`.preview-target-icon` 尺寸规则保留）。
- tests/web-bridge.test.ts：次级样式断言改锚 batchExport；新增条内免 chrome 与 accent 强调态断言。

## v6 修订（同日，按用户澄清：等级胶囊对齐标题行，剩余时间/添加日期右侧叠放）

- 状态组 `detailStatusRow` 改为 `align-self: flex-end`（底对齐标题行）居右：[等级胶囊] · [上下叠放的迷你胶囊列]。
- `·` 分隔符放大提亮：18px / 700 / `--rd-muted`。
- 右侧叠放列 `detailStatusStack`（高 27px，space-between）：上 `detailDueChip`、下 `detailAddedDate`，均为 12px 高迷你胶囊（9px 字），总高与等级胶囊上下缘对齐。
- 添加日期从标签行尾移入叠放列；标签栏撤掉 `detailTagRow` 包裹后通栏到最右（`.detailTagPicker.detailTagBar { margin-top: 4px }`）。

## v7 修订（同日，按用户反馈：定位/取消纯图标化 + 多答案截图）

- 定位原题：条内去掉"定位原题"文字，仅保留 map-pin 图标（`LocateButton` 新增 `ariaLabel` prop 供纯图标形态的无障碍命名，:445 的复习列表文字入口不受影响）。
- 取消错题：改为 Phosphor 官方路径的垃圾桶→对勾形变（`morphPaths` 新增 `phosphorTrashSimple`/`phosphorCheck`，256 viewBox 填充风格，取自 unpkg @phosphor-icons/core light 资产；与既有 `phosphorSquare` 同体系）；点击垃圾桶 → MorphIcon 动画过渡到对勾（armed 态）→ 点击对勾才真正删除；aria-label 随状态切换（取消错题/再次确认取消错题）。
- 条内文字 11→12px、图标 16→18px、控件高度 30→32px（base 与 priority 两处同步）；经截图核对全部控件位于同一直线。
- 预览 mock（previewBridge.js）首条记录预置第二个答案（解法二），用于展示多答案变体选择控件；新增截图 `detail-bar-multi-answer.png`。
- tests：LocateButton 签名断言随 ariaLabel 更新；新增 trash/check 路径、形变按钮、图标尺寸与 解法二 断言。

## v8 修订（同日，按用户澄清：等级+剩余天数合并大胶囊，日期移入来源行）

- 标题行右侧改为**合体大胶囊** `detailStatusCard`（999px 圆角、overflow hidden）：左半 `detailLevelChip`（等级 tint+色字，透明 select 改等级）+ 1px 竖线 `detailStatusDivider` + 右半 `detailDueChip`（按到期状态 tint+色字）；两侧各按各的状态上色，字号统一 12px。
- 添加日期移到**来源行最右**（`.preview-detail-source-row` 的第三列）：11px（与来源文字同大小）、灰底 `--preview-ui-soft`、`#667182` 文字，与来源文字对齐。
- priority 层修正：`.preview-detail-title-row` 的三列死布局（评审 P2）改为 `minmax(0, 1fr) auto` 两列（标题 | 胶囊）；新增 `.detailStatusCard .detailLevelChip { border-radius: 0 }` 覆盖全局胶囊圆角。
- 撤销 v4 的 `detailStatusRow`/`detailStatusSep`/`detailStatusStack` 全套规则；来源行 grid 由两列改三列（pill | 路径 | 日期）。
- tests：状态区断言改为 detailStatusCard/detailStatusDivider；新增合体胶囊圆角与标题行两列网格断言。

## 受影响文件

- `web/src/main.jsx`（useDockableBar hook、MistakeDetail 重构、Phosphor 垃圾桶/对勾路径与纯图标控件）
- `web/src/lib/previewBridge.js`（首条记录预置双答案）
- `web/src/ui/mistakes.css`（新增样式块 + 退役清理 + 遗留 order/flex 修正 + v2 芯片化/v3 方块/v4 横排/v5 去 chrome 重设计）
- `web/src/ui/controls.css`（清退两条仅服务旧详情条的退役规则）
- `tests/web-bridge.test.ts`（详情结构断言随新类名更新：`detailStatusCard`/`detailTagBar`/`detailActionBar`/`detailBarDot`；次级按钮 token 断言改指 `.detailActionBar > button:not(.previewFavoriteButton)`；蛇形时间轴 pointer-capture 守卫收窄到 ReviewTimeline 组件范围）
- `scripts/migrate-detail-ui-css.mjs`、`scripts/shot-detail-ui.mjs`（新增工具）
- `package.json`（`2.3.3-beta.65`）、`RELEASE_NOTES_v2.3.3-beta.65.md`、`docs/handover-detail-ui.md`（后续优化交接）

## 验证

- `pnpm check` 通过；`pnpm test` 159/159；`pnpm build` 产物 `dist/mn4-answer-matcher-v2.3.3-beta.65.mnaddon`。
- 预览截图（Playwright，本地预览站）三张已存 iCloud：`错题详情UI预览/detail-bar-bottom.png`（默认底部横排）、`detail-bar-right-tags.png`（右侧竖排 + 标签弹层展开）、`detail-bar-dot.png`（折叠圆点）。
- 修复前备份：`E:\project\MN-rails-beta-backup-2026-09-03-before-detail-ui.tar.gz`（668K）。

## 未验证限制（需真机复核）

- 拖动跟手度、吸附动画手感与边缘反弹（当前实现无动画，pointerup 直接吸附）；
- UIWebView 对 Pointer Events 的支持（iOS 13+ 已支持；如真机异常可退化为 touch 事件）；
- 标签弹层在窄面板下的边界裁剪（`@container detailPane` 规则保留，未逐档验证）；
- 等级透明 select 覆盖层在真机的点击热区与系统选择器弹出方向。
