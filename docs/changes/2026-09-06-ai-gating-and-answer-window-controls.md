# 2026-09-06 — AI 总开关门控、答案窗口控件统一与错题工作台根治性修复（v2.3.3-beta.97）

基线：beta.96。本轮依据《AI 错题总结方案》与全面排查报告做根治性修复，不含兜底式补丁。

## 变更目的

1. 答案查找窗口悬浮条控件尺寸不一致（关闭/刷新/候选字形无显式字号、候选圆角与尺寸脱钩、缩放手柄创建 44pt 后被改写为 30pt）。
2. AI 错题分析在总开关关闭时仍然随面板运行：Web 每次分页后都发送 `aiRunDueSchedules`，总览 AI 模块未开启也拉取设置与报告，违背"默认关闭、开启后才加载运行"的方案要求。
3. 排查报告确认的三个真机症状根因：AI 分析批量读取独占 JS 线程（含逐题触发整库重写）、分页续传失败后"正在载入 25/N"横幅永久滞留、调试开关依赖整页重载导致永不回显。
4. 排查报告 AI 子系统高优先缺陷：OCR 缓存 32 位采样弱哈希会错配图片、MinerU 结果按下标对位、手动分析无并发抑制、300 条截断静默、证据引用未校验、"手写内容"开关为死控件、报告过期按科目重复全量计算。

## 实现行为

### AI 总开关门控（默认关闭，开启前零运行）

- `dashboard` 响应新增 `aiEnabled` 字段（`src/rails-core.ts`），取自 `aiRuntimeEnabled()`（`src/ai-subsystem.ts`）。
- Web 端仅当 `aiEnabled === true` 才发送 `aiRunDueSchedules`；总览 `AIOverview` 接收 `enabled` 与 `onOpenSettings`，关闭态只渲染"AI 分析未开启 + 前往配置"，不发起任何 AI 桥接请求；开启后由 `onEnabledChanged` 通知 App 静默重载。
- 原生 `aiBridge` 拆分配置段与运行时段：`aiGetSettings/aiSaveSettings/aiListStudySets/aiSetCredential/aiClearCredential/aiTestProvider/aiTestMinerU` 始终可用（总开关本身在配置页操作）；其余运行时命令统一位于 `!enabled` 门闸之后，关闭时直接拒绝。
- `aiListStudySets` 增加 `isMindMapNotebook` 过滤，与核心绑定入口口径一致。
- 配置页"缓存与报告"组仅在开启后挂载，`loadStorage` 仅开启后调用。

### 线程饥饿根治

- `mistake-manager.ts` 抽出 `answerCandidatesForRecord` 共享内核，新增只读提取 `mistakeContentById`（不刷新记录、不同步标签、不写库）；`mistakeDetailById` 行为不变，复用同一内核保证两处答案解析规则同源。
- `runAnalysis` 改用只读提取，AI 批量读取对 `mistakes.v2` 零写入；让出策略从"每 4 条 10ms"改为逐题 `delay(0.03)`，桥接在每道题之间都有响应窗口。

### 分页与调试

- 分页续传新增 `streamLoading` 状态：横幅仅在续传进行中显示，失败或被新请求取代后撤下，不再谎报加载仍在进行。
- `mergeMistakePage` 显式落 `recordsComplete`/`nextOffset`，完结页不再残留上一页续传游标（JSON 序列化丢 undefined 键导致的展开残留）。
- `setDebugMode` 与 `setPluginEnabled` 共用同一数据流：以命令结果就地更新 `matching.debugModeEnabled`，不再依赖整页 dashboard 重载。

### AI 子系统高优先缺陷

- 新增 `src/content-fingerprint.ts`：自包含 SHA-256（FIPS 180-4）与 UTF-8 编码实现，OCR 缓存键从 32 位采样哈希改为全量内容指纹，杜绝错配；`ai-subsystem.ts` 移除 `simpleHash`/`nestedZipUrls`。
- MinerU 批量结果结构化解析（`file_results`/`results` 数组，按 `data_id` 回对 `full_zip_url`），不再全文扫描 zip 链接；收到未知 `data_id` 显式报错；轮询等待全部完成，单项失败按题目计入不可用。
- `aiStartAnalysis` 增加同科目活动任务抑制（"该科目已有分析任务正在进行"）；调度循环跳过有活动任务的科目；终态任务按创建时间保留最近 10 条。
- 截断可感知：分析集按最近更新取前 300 条，报告 `coverage` 增加 `total/analyzed`，`limitations` 注明"本次仅分析最近更新的 N 道（上限 300）"。
- 证据校验（方案 §22）：AI 引用的 Q 编号经 `validateEvidence` 对照匿名映射，幻觉引用剔除并在 `limitations` 注明数量。
- "手写内容"开关生效：手写 canvas（`data-drawing`）仅在 `privacy.handwriting === true` 时进入 MinerU 上传集合（默认不上传，与方案 §63 一致）。
- `aiListReports` 过期检测按科目记忆化指纹，不再每份报告全量重算。

### 答案窗口控件统一并放大

- `window-controls.ts` 成为悬浮条几何单一来源：控件统一 40×40（贴近 HIG 44 触控目标）、条高 52、圆角由尺寸推导、三控件统一显式字号 `UIFont.systemFontOfSize(19)`；候选控件圆角与尺寸同步推导；拖动热区统一 60 覆盖整条。
- `answer-card-view.ts`：悬浮条初始帧改由 `answerControlBarLayout` 生成（创建与重排同源）；缩放手柄统一 44×44，不再被改写为 30×30；候选初始标题改为空串（显示态恒由 `syncAnswerCandidatesControl` 写入序号）。
- 浏览器预览桥 `dashboard` mock 补充 `aiEnabled: true`，保持 AI UI 可预览。

## 受影响文件

- `src/ai-subsystem.ts`、`src/content-fingerprint.ts`（新增）、`src/mistake-manager.ts`、`src/rails-core.ts`、`src/window-controls.ts`、`src/answer-card-view.ts`、`src/globals.d.ts`（本轮曾加又撤销，最终无变化）
- `web/src/main.jsx`、`web/src/lib/previewBridge.js`、`web/src/ui/overview.css`（新增 `.aiEmpty .aiBackFallback` 一条规则，写入 AI 所有权块内）
- `package.json`（版本 2.3.3-beta.97、测试清单加入 content-fingerprint）、`tests/ai-subsystem.test.ts`、`tests/domain.test.ts`、`tests/content-fingerprint.test.ts`（新增）

## 兼容性与数据影响

- 不修改错题记录、答案绑定、设置键与桥接协议结构；`dashboard` 新增 `aiEnabled` 为增量字段，旧 Web 忽略、新 Web 对旧原生按未开启处理（`aiEnabled === true` 才放行），安全方向一致。
- OCR 缓存键更换后旧缓存（旧哈希文件名）不再命中，属于可再生成缓存，按方案设计直接失效重建；`MNAnswerMatcher/ai/ocr` 目录下旧文件将在下次"清除 OCR 缓存"时一并移除。
- AI 默认仍为关闭（`enabled: false`），本次仅把"关闭"落实为运行时零加载。

## 验证

- `pnpm check` 通过。
- `pnpm test` 通过 200/200（新增 SHA-256 测试向量含百万字符长输入、门控/并发抑制/指纹/截断披露等源码断言；悬浮条几何断言更新为 40/52/96/140）。
- `pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.97.mnaddon`。
- 安装包已复制至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.97.mnaddon`；源包与副本 SHA-256 均为 `1b1ab2329c7bf8115c5b174bc8ff257ad56c8ed02a368709511b819219073cbd`。

## 未验证限制

- 真机（iPad，880 条错题）复测：分页在 AI 开启/关闭两种状态下的连续翻页、AI 配置页交互、调试开关回显、悬浮条新尺寸观感与触控。
- MinerU `file_results` 字段名与 `data_id` 回显、OpenAI/DeepSeek Responses 真实凭据调用仍未真机验证。
- 方案中的三级分析、语义缓存、任务持久化、Provider 契约层属后续阶段，本轮未实现，不在此声明为已完成。
