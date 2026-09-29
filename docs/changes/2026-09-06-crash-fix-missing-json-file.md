# 2026-09-06 — AI 配置页闪退根因修复：缺失 JSON 文件的原生异常（v2.3.3-beta.98）

基线：beta.97。本轮由真机证据驱动：用户提供五份 MarginNote 4 崩溃报告与一份 beta.97 运行日志。

## 证据链

1. 五份 .ips（`MarginNote 4-2026-09-06-153940/153948/174511/174538/174552.ips`）签名完全一致：SIGABRT（abort() called），主线程，`lastExceptionBacktrace` 自底向上为 `decidePolicyForNavigationAction`（面板 `mnaddon://bridge` 请求到达原生委托）→ MarginNote 委托转发（`___forwarding___`）→ `-[JSValue callWithArguments:]` 进入插件 JS → JS 经 ObjCCallbackFunction 调用 MarginNote JSB 方法（二进制偏移 20254296）→ Foundation `NSJSONSerialization` 抛出 NSInvalidArgumentException → 未捕获 → abort。
2. beta.97 运行日志证实崩溃发生时段的应用状态：三次崩溃后第 4 次启动存活，`uiConstants`/`runtimeLog` 正常，`dashboard` 因 `getSelectedNodes` 访问未就绪的 `mindmapView.selViewLst` 抛 JS 异常而失败（`currentNotebook=(空)`），随后用户仅导出日志、未进入 AI 配置，故存活。
3. 完整线程帧（`threads[0].frames`）显示抛出符号为 `+[NSJSONSerialization JSONObjectWithData:options:error:]`（读取方向）。marginnote 库 `readJSON` 实现为 `JSONObjectWithData(NSData.dataWithContentsOfFile(path), 1)`：文件缺失 → data 为 nil → 官方语义对 nil data 抛 NSInvalidArgumentException → 该异常穿透 JavaScriptCore，JS try/catch 无效 → abort。
4. 唯一无预检的调用点在 AI 子系统：`reports()` 读取 `MNAnswerMatcher/ai/reports/index.json`（首次生成报告前不存在；`aiListReports`/`aiGetCacheStats`/`aiGetReport` 均经过），OCR 缓存命中读取 `ai/ocr/<指纹>.json`（首次 OCR 必不存在）。点击"AI 错题分析"→ 配置页加载 → 触发读取 → 闪退，与用户症状完全吻合；签名跨 beta.95/96/97 一致，说明 AI 子系统引入即存在。
5. 对照组：`mistake-store.ts`、`index-store.ts` 的所有 `readJSON` 均带 `isfileExists` 预检，故错题相关页面从不闪退。

## 修复内容

- `src/ai-subsystem.ts`：新增 `readJSONFile(path)`（`isfileExists` 预检 → `readJSON`，缺失返回 undefined），`reports()` 与 OCR 缓存命中改走该助手；全文件 `readJSON(` 仅剩助手内部一处，并以测试断言固化（JS try/catch 不能替代预检，因为原生异常穿透 JSC）。
- `src/plugin.ts` `selectedQuestions()`、`src/rails-core.ts` `selectedNode()`：脑图视图未就绪时跳过 `getSelectedNodes`，按语义返回空选择并走既有回退——修复运行日志证实的冷启动 `dashboard` 整体失败。

## 受影响文件

`src/ai-subsystem.ts`、`src/plugin.ts`、`src/rails-core.ts`、`tests/ai-subsystem.test.ts`、`package.json`（版本号）。

## 兼容性与数据影响

不修改存储键、桥接协议与数据格式；`readJSONFile` 仅改变"文件不存在"分支的行为（原先崩溃，现返回空）。

## 验证

- `pnpm check` 通过；`pnpm test` 通过（新增两组根因断言）。
- `pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.98.mnaddon`。
- 源包与 iCloud 交付副本 SHA-256 一致（见 `RELEASE_NOTES_v2.3.3-beta.98.md`）。

## 未验证限制

- 需真机复测：点击 AI 配置页不闪退；AI 开启后全流程；冷启动面板首屏。
- 若真机仍出现同签名崩溃（同一偏移 20254296），则存在其他 JSB 文件读取路径，需继续按崩溃报告排查。
