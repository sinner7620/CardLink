# 错题详情 UI 重构 — 后续优化交接（beta.65，2026-09-03）

> 读者：下一次接手错题详情（MistakeDetail）迭代的会话/开发者。
> 本次重构的完整改动见 `docs/changes/2026-09-03-beta65-detail-ui-refactor.md`；本文只写"现状 + 建议的下一步"。

## 当前结构速查

```
MistakeDetail (web/src/main.jsx)
├─ detailHeader
│  ├─ detailHeadingBlock
│  │  ├─ preview-detail-source-row（priority 三列网格：来源 pill | 路径 | detailAddedDate 灰底 11px）
│  │  └─ preview-detail-title-row（priority 两列网格 minmax(0,1fr) auto）：h2 + detailStatusCard 合体大胶囊
│  │     └─ detailStatusCard：detailLevelChip 等级半区（透明 select 改等级；priority 有 border-radius:0 覆盖）| detailStatusDivider 竖线 | detailDueChip 到期半区（按状态上色）
├─ detailTagPicker.detailTagBar（标签芯片栏通栏 → 复用 detailCategoryMenu 弹层）
│  └─ detailAddedDate（灰底添加日期方框，与上方芯片列右对齐）
├─ levelChangeNotice（改等级提示，保留原位）
└─ detailStage
   ├─ cardFrame（预览 iframe，样式在 controls.css）
   ├─ detailActionBar（悬浮操作条：题目/答案/收藏/定位/取消错题/折叠；控件免 chrome 空隔排布，.active 用 --rd-accent-tint 强调；定位/收藏/取消的 priority 层旧 chrome 已在 mistakes.css priority 条内定点解除；取消错题 = Phosphor phosphorTrashSimple→phosphorCheck 形变（armed 二次确认），定位为纯图标 ariaLabel 定位原题；条内字号 12px/图标 18px/高 32px）
   └─ detailBarDot（折叠圆点，与操作条共用停靠参数）
```

- 拖动吸附：`useDockableBar()`（main.jsx 内）。状态 `{edge, ratio, collapsed}` 存 localStorage 键 `mn-detail-bar`；≥6px 位移判定拖拽；pointerup 最近边吸附；拖后 click 捕获拦截。
- 样式：`mistakes.css` mn-ui-base 层末尾"beta.65 错题详情重构"注释块；取色只用 `--rd-* / --preview-ui-* / --mn-level-*`。
- 截图工具：`node scripts/shot-detail-ui.mjs [输出目录]`（三状态）；回归比对用 `scripts/css-baseline.mjs capture|diff`。
- 安装包：`dist/mn4-answer-matcher-v2.3.3-beta.65.mnaddon`；预览图在 iCloud `错题详情UI预览/`。

## 已知取舍（本次有意的决定）

1. **添加日期收敛为一枚灰底小方框**（detailAddedDate，标签行行尾、等级芯片正下方）；初版曾整体移除，v2 按反馈恢复为紧凑形态。
2. **等级修改 = 点击等级芯片**：透明 select 覆盖等级芯片；剩余天数芯片无交互（如需点击跳转复习页，可作为后续增强）。
3. **多答案选择器进条**：`answerVariantSelect` 仅在 答案页签且答案数 >1 时出现在"答案"与"收藏"之间，未列入用户点名的六项但保留了功能。
4. **折叠语义变更**：旧"折叠题目信息"（隐藏来源/meta）已退役；现在折叠只作用于操作条本身。

## 建议的后续优化（按优先级）

1. **吸附动画**：pointerup 直接落位无过渡；可在松手时给 `left/top` 加 120–160ms ease-out 过渡（拖拽态已设 `transition:none`，只需非拖拽态加）。注意别对 `transform` 过渡以免与居中 translate 冲突。
2. **真机 Pointer Events 回退**：UIWebView 旧系统若 pointer 事件异常，在 `useDockableBar` 里补 touch 事件回退（touchstart/move/end 映射同一 dragState）。
3. **竖排标签截断**：纵向停靠时按钮 `white-space: nowrap` 宽度由最长项决定；"定位原题"等长标签可考虑竖排下只显示图标（`settingsIcon` 已是图标形态，可隐藏文字）。
4. **操作条与预览缩放联动**：预览 iframe 内已有双指缩放（wirePreviewFrame）；操作条悬浮其上可能挡住内容边缘，可评估"条下留白 padding"或拖离自动半透明（hover 恢复）。
5. **折叠圆点状态可视化**：圆点目前无等级/收藏态提示；可在圆点内渲染等级色小点或收藏星标。
6. **CSS 收尾**：`preview-detail-title-row > button` 等零星死规则仍存在（controls.css 的 locate 组、旧 `.detailHeader button` 组）；下次用 `scripts/flatten-ui-css.mjs` + 基线比对一并清理。
7. **容器查询适配**：`@container detailPane (max-width: 430px)` 保留但未按新结构逐档验证，窄面板（460px 面板默认宽）下建议真机检查状态方块与标题的换行。

## 回归清单（改动详情区时必测）

- 点击状态方块改等级 → 列表就地更新、levelNotice 出现、方块色系切换；
- 标签栏增删标签 → 列表停留位置不丢（beta.62 就地补丁）；
- 操作条拖到四边 → 横竖排布正确、不超出预览窗口、重启面板后位置记忆；
- 取消错题两次点击语义（垃圾桶→对勾→删除）与误触保护；多答案记录的变体选择（预览 mock 首条已带双答案）；
- 折叠/展开圆点、拖拽后不误触按钮；
- 收藏 morph 动画、取消错题"再次确认"、定位原题按钮形变不回归；
- `pnpm test`（web-bridge.test.ts 中 detail 相关断言）与 `scripts/css-baseline.mjs` 比对。
