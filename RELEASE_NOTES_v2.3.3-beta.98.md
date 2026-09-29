# v2.3.3-beta.98

基线：beta.97。依据真机崩溃报告（.ips）与运行日志定位并修复 AI 配置页闪退的确切根因。

## 根因（真机证据）

- 五份 MarginNote 4 崩溃报告（15:39 ×2、17:45 ×3）签名完全相同：主线程在 WebKit `decidePolicyForNavigationAction`（即面板 `mnaddon://bridge` 桥接分发）中，经 JSBridge 调用进入 `NSJSONSerialization JSONObjectWithData`，抛出无法被 JS 捕获的 `NSInvalidArgumentException`，异常穿透 JavaScriptCore 未被捕获，`abort()` 结束进程（SIGABRT）。
- 官方语义：向 `JSONObjectWithData` 传 nil data 会抛 NSInvalidArgumentException。marginnote 库的 `readJSON` 实现为 `JSONObjectWithData(NSData.dataWithContentsOfFile(path), …)`——**文件不存在时 data 为 nil，直接抛出**；该异常无法被 JS try/catch 捕获，任何 JS 层 try/catch 包裹都无效。
- AI 子系统的 `reports()` 裸调 `readJSON(reports/index.json)`：报告文件在第一次成功生成报告前不存在，而 `aiListReports`、`aiGetCacheStats`、`aiGetReport` 都会经过它。因此点击"AI 错题分析"配置页必触发读取 → 必闪退，且跨 beta.95/96/97 复现（AI 子系统引入即存在）。OCR 缓存命中读取（`ai/ocr/<指纹>.json`）同样裸调，首次 OCR 必崩。
- 同库的 `mistake-store`、`index-store` 的 `readJSON` 均有 `isfileExists` 预检，这正是错题页面从不闪退而 AI 页面必崩的差异所在。

## 修复

- `src/ai-subsystem.ts` 新增 `readJSONFile(path)`：`isfileExists` 预检后再 `readJSON`，缺失返回 undefined。`reports()` 与 OCR 缓存命中全部改走该助手；全文件 `readJSON(` 仅剩助手内部一处。
- 运行日志同时证实第二个问题：冷启动面板恢复先于脑图视图就绪，`dashboard` 内 `NodeNote.getSelectedNodes()` 访问未就绪的 `mindmapView.selViewLst` 抛 JS 异常导致整个 dashboard 失败。`src/plugin.ts` `selectedQuestions()` 与 `src/rails-core.ts` `selectedNode()` 增加 mindmapView 就绪预检，未就绪按语义返回空选择并走既有回退（lastClickedNote / focusNote）。

## 验证

- TypeScript 检查通过。
- 自动化测试通过：新增"JSON 文件读取带存在性预检"与"脑图未就绪选择查询走空回退"两组源码断言。
- `pnpm build` 通过；源包与 iCloud 交付副本 SHA-256 一致：`9c47f0172642ed260e8c0d79e7ec4dcfcc2ef2e6fdd0e2bc78c474312c5ba265`。

## 未验证

- 真机复测：点击"AI 错题分析"配置页不再闪退；AI 总开关开启后总览、科目绑定、密钥设置、报告生成全流程；冷启动（无学习集打开状态）面板首屏 dashboard 正常。
- 若真机仍出现同签名崩溃，需按崩溃报告中 MarginNote 二进制偏移 20254296 继续排查其他 JSB 文件读取路径。
