# UI 遗留产物与累赘审计报告（beta.54，2026-09-01）

> 处理状态（beta.55）：本文所列 UI 阶段二与阶段四项目已完成；DOM 补丁层、预览归档、确认死选择器和本地 demo 已清理。本文保留为审计依据，现状以 `docs/changes/2026-09-02-ui-stage-2-and-4.md` 为准。

> 调查任务：检查当前 beta 版本 UI 代码上的遗留产物与累赘部分，给出便于迭代优化的重构建议。**仅调查，未修改任何代码。**
> 范围：`web/src/`（React 面板）、`src/` 中 UI 相关 TS、`rails-native/`、以及周边目录。

## 总体结论

UI 目前是**三代 UI 叠加**的状态：React 面板（main.jsx）之下压着 16 层旧 CSS 合并出来的 `panel.css`（5369 行，脚本生成）+ "第二代 UI 覆盖层" `panel-preview.css`（2155 行，577 个 `!important`，**且被打入真机包**）；原生侧则存在三套互不同步的色板体系和一个孤儿入口文件。功能逻辑大体干净（无 TODO 堆积、rails-native 无死代码），但样式层和"预览改造时代"的补丁层欠账最重。

关键数字：

| 指标 | 数值 |
| --- | --- |
| panel.css + panel-preview.css | 7524 行，合并 `!important` 1301 个 |
| panel.css 硬编码颜色 | #hex 539 处（230 个不同值）、rgba 80 处（67 个不同值） |
| tokens.css 定义变量 | 13 个，其中 4 个 z-index 锚点全仓库零引用 |
| panel.css 中无 JSX 引用的死 class | 约 87 个（去除动态拼接误报后确认一批整族死代码） |
| 并行色板体系 | 3 套（tokens.css / ui-tokens.ts / card-html.ts 内联 CSS） |

---

## 一、CSS 层（最大欠账）

### 1.1 panel-preview.css 不是"预览专用"，而是永久覆盖层

- `main.jsx:7-10` 无条件 import 四份 CSS；`vite.config.js` 合并为单一 `app.css`；`build.mjs:97` 整目录拷入真机包。**panel-preview.css 全部 2155 行（含 577 个 `!important`）已确认进入真机**（web-dist/app.css 156,961 字节中含 `--preview-ui-control-height` 等 preview 层变量）。
- 两文件 63 个完全同名选择器；按"选择器+同 @media"精确对齐 **130 对重叠**（约占 preview 层 492 条规则的 26%），典型如 `.topNav`（panel.css:28 原始定义被 panel-preview.css:718 用 8 个 `!important` 全量重写）。
- 这是 commit 27f30b5（CSS 世代合并 17→5 层）的产物：旧 16 层样式源文件已删除，但"底座 + 覆盖层"的两代结构被固化进了生成文件（两文件头部注明"由 merge-generations.mjs 生成，勿手改"）。

### 1.2 确认的死 CSS 组件族（整族删除候选）

对照 main.jsx/ui-redesign.js/icons.jsx/preview-favorites.js 提取的 262 个 class 交叉核查，以下选择器零 JSX 引用：

| 死代码 | 位置 | 背景 |
| --- | --- | --- |
| 玻璃 UI 全族 `.mn-debug-glass`/`.glass-shell`/`.mn-glass-control-dock`/`.mn-debug-lens` 等 | panel.css | 对应 commit 27f30b5 "实验性玻璃 UI 整体移除"，JS 删了 CSS 残留 |
| 旧导出工具条家族 `.exportToolbar`/`.exportBlock`/`.exportOptions`/`.exportHint`/`.exportPickActions`/`.exportPickList`/`.exportPickPreview` | panel.css:1722/1755/1803/4348 等，约 20 条规则 | 导出页重做后（main.jsx:1704 `exportRedesign`）旧结构不存在 |
| `.level3`/`.level4`/`.level5` | panel.css:4630 附近 | 等级制从五档收敛为三档的遗留（main.jsx:17 只有 3 档） |
| `@keyframes spin` | panel.css:98 | 无任何 `animation` 引用（对照 `pulseStudy`、`beta3NoticeIn` 均有引用） |
| 散件 `.sourceCard`/`.sourceGrid`/`.previewWritingSpace`/`.batchSpacer`/`.appBrand`/`.reviewIntro`/`.includeChoices` | panel.css | 0 引用 |

注意：output/css-batch 的 delete-dead.mjs 当时只删了 113 条"可证明死规则"（选择器层），**没做 CSS↔JSX 交叉核查这一层**，所以组件级死代码成批留存。

### 1.3 token 化名存实亡

- tokens.css 仅 13 个变量；`--mn-accent`/`--mn-gray-fill` 在 panel.css 中 0 次使用；4 个 `--z-*` 层级锚点（tokens.css:26-29）**全仓库零 `var(--z-…)` 引用**——治理意图存在但从未执行。
- 实际 z-index 有 15 个不同值散布 17+7 处（-1 到 1000，preview 层用 `200 !important` 跨文件压制 `.migrationConsentBackdrop` 的 1000）。
- panel.css 仍保留 46+ 处 `--mn-blue-legacy*` 引用，而 tokens.css:14 自注"旧代蓝勿新增引用"；panel.css:3208-3209 定义的 `--preview-accent` 系是死值（panel-preview.css:5-6 直接覆盖）。
- 断点：panel.css 已收敛 600/800/920 三档，但 panel-preview.css 残留 560/1040 两档漏网；写法混用 `@media(max-width:800px)` 与 `@media (max-width: 800px)`。

---

## 二、JS 层（预览改造时代的补丁层仍在生产路径上）

### 2.1 ui-redesign.js / ui-alignment.js：DOM 注入补丁层（架构级累赘）

两个文件在 main.jsx:14-15 作为副作用 import，**真机每次渲染都运行**：

- 它们的注释自述"Preview-only interactive redesign layer. Pairs with preview-ui-redesign.css"——但那份 CSS 已不存在（已合并）。这是 UI 重设计当年"先 DOM+CSS 打补丁、后迁 React"的中间态：B4 迁移（main.jsx 内多处"已迁移 React 状态"注释）只迁走了一半。
- ui-redesign.js 残留 4 个 DOM 同步函数：给复习按钮打 `data-level`、把"已到期"文本节点 unwrap（syncDueGlowLabels）、给复习天数编辑器注入 DOM 摘要（syncSettingsDayEditor）、ResizeObserver 检测按钮换行（syncReviewResultsWrap）。
- ui-alignment.js 用 `insertAdjacentHTML` 把 Phosphor 方框勾选 SVG 注入 5 类按钮宿主，**在视觉上顶替 main.jsx 已渲染的 MorphIcon**——同一图标两套实现并存，React 不知道 DOM 被改过，每次 React 重渲染都可能需要补丁层重新同步（installPreviewSync 样板）。

### 2.2 其他 JS 遗留

- `escapeHtml` 三份：card-html.ts:22（单源）、main.jsx:1406、previewBridge.js:140——web 侧两份未收敛。
- `cardPinchZoomScript`（card-html.ts:154-183）是 `web/src/frame-pinch-zoom.js` 的**手工复制版**（注释自认），同一手势算法两处维护。
- `preview-favorites.js` 是一次性 localStorage 迁移逻辑（旧版"按标题收藏"→ recordId），挂在每次 load() 上。
- `renderMarkdownPreview`（main.jsx:1403-1439）与 src/markdown.ts 职责重叠（简化版 vs 完整版）。

---

## 三、TS/原生侧

### 3.1 死代码与孤儿

| 项 | 位置 | 证据 |
| --- | --- | --- |
| **孤儿入口 main.ts** | src/main.ts（44 行） | 全仓库零 import；AnswerMatcherCore.js 由 rails-core.ts 生成，rails-native/main.js 的 `JSB.newAddon` 覆盖其行为。WebAddon 动态组装方案落地前的旧入口。仍被 tsc 养着 |
| no-op 兼容壳 ×4 | level-picker.ts:23-25、notebook-picker.ts:20-22 | 空函数体，注释自认"compatibility no-ops for older cached Rails instance method tables"，plugin.ts:1281/1292 还在"调用" |
| 死处理器 onMnutilsEntranceClick | mnutils-entrance.ts:159-171 | 悬浮球 click 实际绑定 toggleWebPanel（:136），该 selector 全仓库无调用点；**tests/plugin-events.test.ts:132 在固化这个死代码** |
| 长按抑制机制断线（疑似 bug） | mnutils-entrance.ts:199 | 长按设置 `mnutilsEntranceSuppressClick` 时间戳，但真正的 click 处理器 toggleWebPanel 从不读它——唯一读者是永不触发的 onMnutilsEntranceClick。与真机未解问题"悬浮球长按无反应"同文件，清理时需谨慎 |
| 死导出类型 | `NoteResolver`/`MediaResolver`/`DrawingResolver`（card-html.ts:6-8）、`AnswerFrame`（answer-card-layout.ts:1）、`SafeNoteData`（safe-note.ts:1）、`BindingValue`（binding.ts:36）、`MindMapScope` 再导出（mindmap-scope.ts:3） | grep 零外部 import |
| 仅测试存活的导出 | `bindingAnswerTargets`（binding.ts） | 生产代码零调用 |
| 多余 export | `showMistakeLevelDropdown`（floating-toolbar.ts:123） | 唯一调用点在同文件 |

### 3.2 三套并行色板体系

| 值 | ui-tokens.ts（原生悬浮球） | tokens.css（web 面板） | card-html.ts:210-212（答案卡 webview 内联 CSS） |
| --- | --- | --- | --- |
| 主蓝 | `#3157a4`（当现役主色） | `--mn-blue-legacy-deep`（标注 legacy 勿新增） | `#2563eb` |
| 等级三色 | `#d70015/#b25000/#248a3d` | `--mn-level-0/1/2` 同值 | 无 |
| 纸面底色 | `#f7f8fa` | `#f5f7fb` | `#202124`/`#fff` 等 11 色独立 |

- ui-tokens.ts 注释自认"与 web/src/tokens.css 语义保持一致、改值需两处同步"——手工镜像没有构建机制兑现，**主蓝已经语义分叉**。
- floating-toolbar 的 `#6B7280`（mnutils-entrance.ts:121）游离于 ui-tokens 之外。

### 3.3 重复逻辑

- answer-card-view.ts：默认帧计算在 showAnswerCard（:26-33）与 resetAnswerCardPosition（:177-184）逐字重复 6 行；resize 手柄帧三处字面量且互不一致（初始 `-50/44×44` vs 运行时 `-36/30×30`，首次显示前帧不匹配）；closeButtonFrame/dragAreaFrame 每次布局重复读两遍同一 NSUserDefaults key。
- safe-note.ts:22/30 与 card-html.ts:10/18 的 `arrayOf`/`textOf` 逐字重复。
- pkdrawing-renderer.ts:20-25 与 pkdrawing-svg.ts:8-20 是同一几何逻辑的 TS/JS 双实现。

### 3.4 职责越界（UI 提示混入数据层）

mistake-manager.ts 有 11 处 showHUD/popup 直接嵌在数据操作函数里（655、661、896、1000、1130、1140、1280、1335、1346、1351、1399 行），最典型的是纯持久化函数 `saveMistakeReviewCurves`（:1140）也弹 HUD；:1346 的"新版使用虚拟错题库，不再需要绑定"是**面向已废弃流程的文案残留**。plugin.ts 也有 select/popup 混排（583、702、916、1219 行）。

---

## 四、目录级遗留产物（均已被 .gitignore，不影响仓库，但占工作区）

| 目录/文件 | 定性 | 依据 |
| --- | --- | --- |
| `heart-glow-demo/` | **纯遗留**（独立实验子项目，未合入正式 UI，主工程零引用） | grep web/src 零命中；build.mjs/package.json 无引用 |
| `web/export-demo/` | **纯遗留**（导出功能设计期静态原型，已被正式 PDF 导出链取代） | 全仓库零引用 |
| `src-docs/` | 空目录 | git 无历史 |
| `dist/mn4-answer-matcher-v1.9.13.mnaddon`、`…beta.2.mnaddon` | 旧版本包残留 | 无脚本引用 |
| `output/verify-beta15/17/19/26/28/29/35.mjs` | 一次性锚点断言脚本，已被正式测试超越 | package.json test 不引用 |
| `output/css-batch/`、`css-dedupe-*.mjs` | 已交付的去重工程工具（可重跑 merge-generations.mjs），非烂尾 | commit 27f30b5 |
| `ui-preview/` | **非遗留**——build.mjs:81 每次构建重新生成 | scripts/build-full-ui-preview.mjs |

`rails-native/` 五个文件全部在用、无死代码/调试残留（唯一小问题：WebPanelController.js:266 初始 frame 硬编码 900×640 未用 ui-constants）。tests/ 无已删功能残留。

---

## 五、重构建议（目标：便于迭代与修改）

### P0 删除类（低风险，机械清理，可立即做）

1. **删确认死 CSS**：玻璃 UI 全族、旧导出工具条家族、`.level3-5`、`@keyframes spin` 及 1.2 节散件。同时把 output/css-batch 的普查工具补一层"CSS class ↔ JSX/TS class 提取交叉核查"，避免下次再靠人肉。
2. **删 src/main.ts**（孤儿入口），并从 tsconfig 考虑显式排除或保留全量 check 但确保它不再被误认为入口。
3. **删死导出类型**（3.1 表）、`MindMapScope` 再导出、`showMistakeLevelDropdown` 的 export 关键字。
4. **收敛 escapeHtml 到两处各一**（TS 侧已单源，web 侧把 main.jsx/previewBridge 的两份合一）。
5. **目录清理**：heart-glow-demo、web/export-demo、src-docs、dist 旧包、output/verify-beta*.mjs。
6. **修正被固化的测试**：删除 tests/plugin-events.test.ts:132 对 onMnutilsEntranceClick 的存在性断言，并连带移除该死处理器（见 P1-4）。

### P1 合并类（中风险，消除结构性重复）

1. **终结 panel-preview.css 覆盖层**：把 130 对覆盖中"preview 层才是想要的最终值"的部分**写回 panel.css 的规则本体**，preview 层只留真正的本地预览专用样式（或干脆改为按 `__MN_FULL_UI_PREVIEW__` 条件加载，不打入真机包）。验收标准：真机 app.css 中 `!important` 从 1301 降到两位数、`--preview-*` 变量不再出现在真机包。注意 panel.css 是 merge-generations.mjs 的生成物——要么把覆盖吸收做进该工具的上游源，要么正式退役该生成流程（16 层旧源已删，流程的历史使命已结束，改为直接维护 panel.css 更利于迭代）。
2. **重建单一 token 层**：以 tokens.css 为唯一来源，删 ui-tokens.ts 的手工镜像（改为构建期生成，或原生侧读 web 包注入的 CSS 变量）；card-html.ts:210-212 的第三套色板提为同一来源的注入变量；补齐 539 处 hex 中出现 ≥4 次的 24 个高频值（#fff、#e2e8f0、#f8fafc、#dfe4ed、#667182、#64748b、#f1f5f9）。主蓝二选一：`#3157a4` 或现役 accent，不允许两边并存。
3. **执行 z-index 治理**：把 15 个散值归到 tokens.css 已定义的层级锚点 + 补一个 0-100 的应用层阶梯，消除 preview 层 `200 !important` 压 `1000` 的跨文件对抗。
4. **悬浮球手势收敛 + 修复断线抑制**：删 onMnutilsEntranceClick，把"长按后抑制 click"接到真正的 toggleWebPanel（读 suppress 时间戳）——这一项同时关系真机未解问题"长按无反应"，建议先在真机复现记录再动。
5. **退役 ui-redesign.js / ui-alignment.js DOM 补丁层**：把 4 个 sync 函数的能力迁入 React（data-level 由渲染时直接给出、复习天数摘要做成 React 条件渲染、换行检测用 CSS container query 或 useLayoutEffect、Phosphor 勾选图标并入 MorphIcon/Icon 组件）。这两个文件退役后面板 DOM 由 React 独占，迭代改 UI 不再需要"改 JSX 同时改补丁 JS"。
6. **pinch-zoom 双实现收敛**：card-html.ts 的手工复制脚本改为构建期从 frame-pinch-zoom.js 内联注入（build.mjs 已有 esbuild 内联先例：pkdrawing-core-webview）。
7. **answer-card-view 去重**：默认帧计算提取单一函数；resize 手柄帧统一为常量（同时修掉初始帧与运行时帧不一致）；布局参数一次读取。

### P2 架构类（改善长期迭代性）

1. **main.jsx 拆分**：1755 行单文件含 App + 12 个组件 + 工具函数，建议按页面拆 `pages/Overview|Browser|Review|Export|Settings` + `components/`（MorphIcon、LocateButton、MindMapMultiSelect、DateFilterButton、Empty、ExportSection 等）+ `lib/`（日期/搜索/审查状态纯函数）。已有导出冒烟机制（tests/web-render-smoke.test.ts）可保证拆分安全。
2. **showHUD 出数据层**：mistake-manager 的 11 处弹提示改为返回结果对象，由 plugin.ts/面板层统一决定提示方式；顺带清掉 :1346 废弃流程文案。
3. **筛选逻辑复用**：错题浏览页与导出页各自实现了一套"状态/日期/标签/等级/搜索"筛选，语义高度重合，可提取共享的 filter 谓词模块，避免两页行为漂移。
4. **preview-favorites 迁移逻辑加截止期**：一次性迁移挂在每次 load() 上，建议按数据版本号判定跑过即卸载。

### 明确不建议动的

- `rails-native/` 现状健康，只在 P1-4 顺手统一 frame 常量即可。
- level-picker/notebook-picker 的 no-op 壳虽是死代码，但它服务"旧缓存 Rails 实例方法表"的兼容，删除需先确认不再有旧版本缓存在真机上存活（与升级路径相关），建议放最后并带真机验证。
- WebBridgeCommands 的 cleanupPdfArtifacts（beta33-36 遗留目录清扫）是对真机旧版残留的兼容清理，**保留**。
- 真机未解问题（长按、横幅）相关文件（mnutils-entrance.ts、note-navigation.ts、WebPanelController.js）不要在本轮清理中顺手重构，避免污染归因。

## 建议执行顺序

P0 一次性清完 → P1 按 1→2→3→6→7→5→4 排序（覆盖层终结和 token 重建收益最大；悬浮球手势放最后单独真机验证）→ P2 随后续迭代逐步做。每步按 AGENTS.md 约定记录 docs/changes 与 RELEASE_NOTES。
