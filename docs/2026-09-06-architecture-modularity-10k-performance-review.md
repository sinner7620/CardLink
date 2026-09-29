# 插件架构 / 模块化 / 可维护性与 10000 道错题量级性能审查报告

> 2026-09-06 · 仅代码调查，未修改任何功能代码。基准脚本位于 `.codex-tmp/bench-10k.ts`（临时产物，不入库）。
> 审查对象：当前工作区 v2.3.3-beta.75（native + web 工作台）。

---

## 一、总体结论（TL;DR）

1. **架构分层清晰、工程质量高于同类 MarginNote 插件平均水平**：纯函数域层 + 存储层 + 业务编排层 + 桥接层 + React 工作台五层职责明确，且有文档（`docs/boundaries.md`、`docs/modules/`）与变更记录纪律支撑。
2. **纯 JS 逻辑在 10000 量级下全部开销 ≤ 70ms**（实测），单次答案查询为微秒级——**插件自身算法不是性能瓶颈**。
3. **万条量级的真实风险集中在三处**：
   - **存储写放大**：`saveMistakeState` 每次复习/标记/收藏都全量序列化约 6MB JSON 并写 NSUserDefaults + 备份文件（实测序列化 25.7ms，原生 plist 序列化与磁盘 I/O 需真机验证，预计单次点击可感卡顿）。
   - **无缓存的 `loadBindings()`**：`repairAndOrganizeMistakes` 整理万条记录时**每条记录触发一次原生本地存储读取**（约 1 万次），这是明确的、易修的 O(n) 原生调用放大点。
   - **Web 端列表全量渲染**：错题浏览列表 `records.map` 渲染全部已载入记录（万条载入完毕后即 1 万行 DOM），无虚拟滚动；复习队列条目未做 `React.memo`。
4. **当前工作区 `pnpm test` 存在 2 个既有失败**（见 §5.4），发布前需处理。

---

## 二、架构与模块化程度

### 2.1 分层结构（native 侧 ~9800 行 TS，web 侧 ~2400 行）

```
plugin.ts (1369行, 流程编排/UI入口)          mistake-manager.ts (1388行, 错题业务编排)
   │                                              │
matcher.ts / answer-lookup.ts / ordered-pairing.ts   mistake-domain.ts (纯函数)
   │            (索引与匹配)                        mistake-store.ts (持久化/备份/迁移)
domain.ts (纯函数: 归一化/索引/排序)                 mistake-tags.ts (纯函数: 标签编解码)
   │                                              │
store.ts / settings.ts / index-store.ts / note-tree.ts / mindmap-*.ts (基础设施)
   └──────────── marginnote API (native bridge) ────────────┘
rails-core.ts (43 个 slash-command 桥接)  ⇄  web/src/main.jsx (React 19 工作台, 2182 行)
```

**做得好的地方：**

| 设计 | 证据 | 评价 |
|---|---|---|
| 域逻辑纯函数化 | `domain.ts`（0 依赖）、`mistake-domain.ts`、`mistake-tags.ts` 不 import marginnote | 可直接 Node 测试（本次基准即得益于此） |
| 统一 scope 语义 | `scope-key.ts` 一个 `scopeKey()` 贯穿索引/绑定/错题 | 避免了 notebookId/rootNodeId 拼键漂移 |
| 存储分版本迁移 + 独立备份 | `mistake-store.ts` v1→v2 迁移、文档目录 3 槽轮换备份、旧键只读兼容后置空 | 数据安全设计成熟，容灾路径明确 |
| 索引快照落 cachePath | `index-store.ts`：写后回读校验，失败回退旧存储 | 符合"缓存可丢"语义，NSUserDefaults 不被数 MB plist 撑爆 |
| 写入验证事务 | `commitSourceTagTasks`：撤销组 + 未执行直写兜底 + 回读验证才提交 | 解决了 MN 未打开学习集丢写的真机问题，注释完整 |
| 分页桥接传输 | `beginMistakeWorkbenchTransfer` 首页 25 条 + `mistakesPage` 续传 + revision 缓存 | 面板首屏不传全量，设计正确 |
| 观测内置 | `recordRuntimeState` 分段计时（bridge.start/end、refreshIndex、mistakeDetail 分段） | 真机诊断已有抓手 |

**模块化短板：**

1. **两个巨石编排层**：`plugin.ts`（1369 行）混杂生命周期、工具栏、绑定流程、诊断代码（`recordAnswerCardDiagnostics` 约 100 行调试代码内联在生产文件）；`mistake-manager.ts`（1388 行）同时承担标记、复习、标签同步、恢复扫描、工作台数据、提醒定时器六类职责。拆分点明显（如 mistake-review-flow / mistake-recovery / mistake-workbench-data）。
2. **`web/src/main.jsx` 2182 行单文件**：App + 浏览器 + 复习队列 + 详情 + 设置 + 导出全在一个文件，无组件拆分文件。虽然有 `React.memo`（仅 `MistakeListItem` 一处），组件粒度难以维护。
3. **模块级可变单例偏多**：`matcher.ts` 5 个模块级 Map、`childMapIdsCache`、`workbenchTransfer`、`workbenchDataCache`。生命周期清理只在部分入口（`clearIndex` 挂在 sceneDidDisconnect；`childMapIdsCache` 只在两个批量入口清），跨场景语义靠约定而非框架保证。
4. **`store.ts` 纯转发层**：37 行只做 `export * from "./binding"` + 绑定存储，`binding.ts`（208 行）与它职责交叠，读者需要跳两跳。
5. **错误处理大量静默 `catch {}`**：防御式容错是刻意的（真机 NSNull 问题），但无分类计数/上报，长期会掩盖新问题。

### 2.2 可扩展性

- **匹配模式可插拔**：`title / parent-order / regex` 通过 `matchMode` 字段 + `findAnswersForQuestion` 分发（`answer-lookup.ts` 仅 28 行）。新增模式只需：新域函数 + `answer-lookup` 一个分支 + `plugin.ts` 标签文案 + 桥接设置项——成本可控。
- **桥接命令为 if-chain**：`rails-core.ts` 43 个 `command === "..."` 分支 + 字符串 payload 无类型校验。`tests/bridge-schema.test.ts` 用白名单测试部分兜底（当前正因白名单未同步而失败）。建议改表驱动（command → handler + payload schema），扩展成本和出错率都会下降。
- **绑定模型复杂度临近上限**：scoped 键 + 笔记本级键 + 双重回退 + `answerOnlyBindingScopes` 排除集，`unbindCurrent`（plugin.ts:1155-1205）已经需要大段注释解释"假解除"边界。再加一种键语义时建议先收敛为单一存储结构（如 `{scopeKey: target}` 平表）。
- **多语言/文案**：所有 UI 文案硬编码中文散落在 native 与 web 两侧，无集中文案层。当前用户群下可接受，记录在案。

---

## 三、可维护性

**强项：**
- 测试 169 个断言/13 个文件，其中 `mistake-performance.test.ts` 用**源码文本断言固化性能约束**（如"工作台函数不得调用 `MN.db.getNoteById`"、"批量操作 `saveMistakeState` 恰好 1 次"）——这是把性能评审结论固化为回归防线的少见做法，价值高（但正则匹配源码的方式较脆弱，重构改名即碎）。
- 文档体系完整：`docs/boundaries.md`（明确不做清单）、`docs/changes/`（每轮变更）、`docs/modules/`（逐文件说明）、历史问题归因报告（滚动性能分析）。
- AGENTS.md 强制版本迭代 + 变更记录 + SHA-256 校验交付，流程纪律严格。

**弱项：**
- 两个 1300+ 行巨石文件是主要维护摩擦点；`main.jsx` 尤甚。
- 源码断言型测试对重构不友好。
- 当前工作区测试红灯（见 §5.4），说明"每轮 pnpm test 通过"的纪律在最近一轮被打破。

---

## 四、性能：10000 道错题量级

### 4.1 实测数据（Node 22 / tsx，本机桌面环境；MN 真机 JavaScriptCore 预计慢 2–4 倍）

| 热路径 | 10000 条耗时 | 对应代码 |
|---|---:|---|
| normalizeTitle ×N（2 万标题） | 7.2 ms | `domain.ts:10` |
| buildIndex 建索引（标题唯一） | 17.0 ms | `matcher.refreshIndex` JS 部分 |
| buildIndex（含 500 组重名） | 19.7 ms | 同上 |
| 单次 findAnswers 查询（含排序） | **≈0.00 ms（微秒级）** | `matcher.ts:215` |
| regex 答案索引首建 | 14.3 ms | `matcher.ts:239` |
| 工作台记录聚合（map + 分类） | 23.1 ms | `mistakeWorkbenchData` |
| compareMistakeRecords 全量排序 | 66.6 ms | `mistakeWorkbenchData` |
| 分类计数聚合 | 22.8 ms | 同上 |
| due/today/level 三遍过滤 | 5.2 ms | 同上 |
| revision FNV 哈希 | 1.6 ms | `mistakeWorkbenchRevision` |
| **全量错题库 JSON.stringify** | **25.7 ms / 6.07 MB** | `saveMistakeState` |
| 索引快照 stringify（截断后） | 15.1 ms | `saveStoredIndex` |
| reviewMistake 单条 | ≈0.00 ms | `confirmMistakeLevel` |

**结论：纯 JS 计算即使万条量级也不构成瓶颈。** `buildIndex` 的数组展开写法在重名场景理论上是 O(k²)，实测 500 组重名仅 +2.7ms，可接受但建议顺手改为 push。

### 4.2 真实瓶颈：原生桥调用与 I/O（按代码路径推算，需真机 recordRuntimeState 数据验证）

**① `saveMistakeState` 写放大 —— 万条量级最大的用户可感风险**
`mistake-store.ts:191` 每次调用做 4 件事：6MB stringify（实测 25.7ms）→ `setLocalDataByKey`（原生 plist 序列化 + 写 NSUserDefaults，MB 级对象通常 100ms–1s）→ `writeBackupFile`（6MB 写文件；每 15 分钟轮换时额外读+写 2 个 6MB 副本）→ `cleanupLegacyKeys`（2 次 NSUserDefaults 读）。
而触发面极广：**每次单题复习、改等级、收藏、批量操作结尾**都全量保存一次。10000 条错题时，"点一次确认复习"的存储成本 = 全库 6MB 重写。**建议**：主存储迁往文件（与索引快照同路径，已有先例）、或至少对收藏类高频轻操作做防抖/延迟合并。

**② `loadBindings()` 无会话缓存 —— 明确的 O(n) 原生读放大**
`store.ts:9` 每次调用 = 原生 `getLocalDataByKey` + 对象展开拷贝。而 `refreshRecord`（mistake-manager.ts:333）和 `markQuestionsAsMistakes`（:583）**逐条**调用 `answerBinding` → `loadBindings()`。`repairAndOrganizeMistakes` 整理 10000 条记录 = **10000 次原生存储读取**，叠加每条记录的 `getNoteById` + `readSourceTags`（评论扫描）+ `syncManualTagsFromSource`（再次读标签），单次整理预计 10s 级（好在有 `delay` 分片不阻塞，但总时长很长）。
对比：`settings.ts` 已有会话级缓存（含写入同步更新），**给 `loadBindings` 加同样的缓存是本报告性价比最高的单项优化**（约 10 行代码，风险低）。

**③ 定时提醒 `dueRecords`（mistake-manager.ts:1320）**
每 30 分钟 + 每次进前台：对全部 10000 条记录同步执行 `MN.db.getNoteById`（无分片、无 delay）。原生调用估计每次 0.05–0.2ms，即每半小时一次 0.5–2s 的 JS 线程占用，可能造成可感卡顿。**建议**：去掉 `!== undefined` 可用性检查（dashboard 已改用 `sourceAvailable` 快照，这里口径不一致）或分片执行。

**④ `refreshIndex` 万卡重建（matcher.ts:74）**
每卡：`new NodeNote`（原生包装）+ `isInMindMap` + `readSafeNote`（逐评论原生属性访问），共约 3–5 次原生调用/卡 = **3–5 万次原生调用**；另有 `delay(0.01)` 每 40 卡一歇 = 250 × ~10ms = **2.5s 固定让步地板**；结尾 6MB 快照写 + 回读校验 JSON.parse。综合估计真机 **5–15s**。已有 HUD + 分片，用户感知是"刷新慢但界面不死"，属于可接受设计；如需提速可加大批次（40→200）把让步地板降到 0.5s。

**⑤ Web 端渲染（万条全部载入后）**
- 错题浏览列表 `records.map` 全量渲染（main.jsx:977）：`MistakeListItem` 有 `React.memo`，重渲染可控，但**首挂载 1 万行 DOM（每行多按钮+图标）是硬成本**，且筛选/搜索每次输入对全量数组 filter + `visibleSignature` 全量 join（:1355-1358）。预计万条时首屏与搜索均有可感延迟。
- 复习队列 `DueReviewList`（:1270, 1490）条目**未 memo 化**，任何 state（answerZoom、detailsById 等）变化全表 reconcile——这正是 2026-09-02 归因报告确认过、部分修复过的问题残留（MutationObserver 层已按文档退役，列表项 memo 已做一半：浏览列表有、复习队列没有）。
- 正面设计：首页 25 条分页传输 + `waitForPaint` 续传、iframe 按需展开，避免了传输层与首屏的万条爆炸。
- **建议**：复习队列条目补 `React.memo`；浏览列表加窗口化渲染（已渲染上限 + 滚动追加即可，不必上完整虚拟列表库）。

### 4.3 流畅度判断（万条量级）

| 操作 | 预期表现 | 依据 |
|---|---|---|
| 点卡片 → 查答案/展示 | 流畅（<100ms） | 索引查询微秒级；卡 HTML 渲染只处理当前卡 |
| 标记错题（单/批） | 数百条内流畅；万条库时每次保存有可感延迟（~0.1–1s） | saveMistakeState 写放大 |
| 复习确认 | 同上 | 同上 |
| 打开工作台首屏 | 流畅 | 分页 25 条 + revision 缓存（聚合 JS 仅 ~120ms） |
| 浏览列表滚动/搜索（万条全载入） | 卡顿明显 | 全量 DOM + 无虚拟化 |
| 刷新答案索引（万卡） | 秒级等待，有 HUD 不冻结 | 设计如此 |
| 「刷新错题分类索引」整理（万条） | 10s 级后台任务 | 每条 5+ 原生调用 + 1 万次 loadBindings |
| 每 30 分钟提醒轮询 | 可能瞬时卡顿 | 万次 getNoteById 无分片 |

### 4.4 验证情况与局限

- `pnpm check` 通过；`pnpm test` **167/169 通过，2 个既有失败**（与本报告无关的调查产物未触碰 src）：
  1. `bridge-schema.test.ts`：原生新增命令 `switchAnswerCandidate` 未加入 web 白名单（原生/web 命令表漂移）。
  2. `web-render-smoke.test.ts`：`web/src/phosphor.jsx:21` 使用了 TS 语法 `Record<string, string>` 但文件是 `.jsx`，esbuild 构建失败。
- 基准为桌面 Node 环境，MN 真机（iPad/JavaScriptCore）数值预计 ×2–4；原生桥单次调用成本未测，§4.2 各项绝对值需真机 `recordRuntimeState` 日志核实（插件已内置 `durationMs` 打点，直接开启调试模式即可采集）。

---

## 五、优化建议（按性价比排序）

| 优先级 | 事项 | 预期收益 | 成本 |
|---|---|---|---|
| P1 | `loadBindings()` 加会话级缓存（对齐 `settings.ts` 做法） | 整理/批量标记万条时消除 1 万次原生读 | ~10 行，低风险 |
| P1 | `saveMistakeState` 主存储迁移到文件或写合并防抖 | 消除万条时每次复习的全库 6MB 重写 | 中，需迁移兼容 |
| P1 | `dueRecords` 去掉逐条 `getNoteById` 或分片 | 消除每 30 分钟 0.5–2s 线程占用 | ~5 行 |
| P2 | 复习队列条目 `React.memo`；浏览列表窗口化渲染 | 万条列表滚动/筛选流畅 | 中 |
| P2 | `refreshIndex` 批次 40→200 | 万卡刷新让步地板 2.5s→0.5s | 1 行 + 真机回归 |
| P2 | 修复 2 个失败测试（命令白名单、phosphor.jsx 语法） | 恢复发布门禁 | 小 |
| P3 | 拆分 `mistake-manager.ts` / `plugin.ts` / `main.jsx`；rails-core 表驱动 | 可维护性 | 大，建议随功能轮次渐进 |
| P3 | `buildIndex` 数组展开改 push；静默 catch 分类计数 | 长尾稳健性 | 小 |
