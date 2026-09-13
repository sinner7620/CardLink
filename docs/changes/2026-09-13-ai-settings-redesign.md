# AI 配置页重做：设置逻辑统一与 iOS 风格界面

日期：2026-09-13。基于 v2.4.1-b5 工作树。UI 规范参照 emilkowalski/skills 的 apple-design skill（WWDC Fluid Interfaces 要点的 web 转译：按压即响应、材质模糊、大字号负字距、reduced-motion/transparency/contrast 适配）。

## 目的

按用户要求全量重做 AI 总结配置页的设置逻辑与界面（禁止打补丁）：

1. 启用开关改为 switch 样式。
2. 科目管理样式重做。
3. OCR AI 配置与分析 AI 配置统一在「AI 服务」下，分两行：第一行下拉选择分析错题 AI，第二行为题目识别（OCR）配置，题目识别配置项移入其中。
4. 发送内容精简：卡片内手写与脑图绑定手写统一为「手写内容」；删除「图片上传」选项。
5. 新发送模型：只有手写内容允许作为图片上传（且只发给分析模型）；题目卡片整张经 OCR 识别成文字发送；未开启 OCR 则不发送题目。

## 新发送模型（取代 b4/b5 行为）

- **题目**：整卡（去手写）截图 → OCR 文字 → 作为题目文本发送。`planQuestionInput` 产出 `ocrHtml`（无手写整卡）与 `renderHtml`（含手写，供捕获）。`needsOCR = mineru.enabled`；OCR 关闭时 `aiStartQuestionPreparation` / `runAnalysis` 明确拒绝（"未开启题目识别（OCR），题目不发送"），不再有原生文字直读分支（答案文字提取仍用 questionNativeText）。
- **手写内容**：`privacy.handwriting` 统一开关。手写不进 OCR 截图；开启时准备阶段在渲染文档内逐个捕获手写元素（`.bound-mindmap-handwriting` 区块 + 各 `canvas[data-drawing]` 宿主），隐藏后截整卡，手写图片数组经 `handwritingDataUris` 提交，另存为 `handwritingImages: { file, bytes }[]`（每题最多 `MAX_HANDWRITING_IMAGES = 6` 张，单张 Base64 ≤ 4,000,000 字符）。分析时随题目以 `Qxxx-H1…n` 编号经 `analysisUserContent` 直传（单次请求总数仍受 `MAX_ANALYSIS_IMAGES = 30` 限制），缺失数量写入报告 limitations。
- **设置迁移**：`privacy.images`、`mindMapHandwriting`、`handwritingToModel` 删除；旧三开关任一开启迁移为手写内容开启。`mineru.policy` 删除，旧 "never" 迁移为识别关闭，其余等价于开启。策略指纹版本升至 4，旧混合快照（含 b5 的单图手写字段）全部失效，需重新准备。

## 配置页 UI（全部重写）

- 结构：启用（switch）→ AI 服务（分析错题 AI 下拉 + 题目识别 OCR 可展开行 + 服务档案编辑列表）→ 发送内容（参考答案/章节路径/复习历史/自定义标签/手写内容，全部 switch）→ 科目与学习集（重做样式，定期检查生成文案改为「打开插件时按间隔检查」）→ 高级（题目准备工作台、缓存与报告，仅在启用后显示）。
- 控件：新增 `AISwitch`（51×31 iOS 开关，transform 动画，reduced-motion 关闭动画）；行样式 `.aiRow`（14px 主文字/-0.01em、12px 辅助文字、44px+ 触控目标、按压即有 `:active` 反馈）；工具栏保持毛玻璃材质，h1 21px/-0.02em；输入/选择 44px、14px。
- `web/src/ui/settings.css`：删除原有三层重复 AI 样式块，AI 配置页样式整合为文件末尾单一来源；辅助文字全部 ≥12px；保留 overview 页 `.aiOverview/.aiPreflight` 窄屏媒体规则。

## 受影响文件

`src/ai-input.ts`（重写）、`src/ai-subsystem.ts`（设置/快照/准备/分析管线）、`src/rails-core.ts`（aiClearCredential 登记到命令边界清单）、`web/src/main.jsx`（AISettingsPage 重写、准备流程双捕获、normalizeAISettingsView 迁移）、`web/src/ui/settings.css`、`tests/ai-input-behavior.test.ts`（重写）、`tests/ai-subsystem.test.ts`（契约更新）、`docs/pages/settings.md`。

## 兼容与数据影响

- 旧准备快照（b4 混合 OCR、b5 单张手写图）因策略指纹版本变化全部失效，升级后需重新准备；旧设置迁移保留用户意图（见上）。
- OCR 内容缓存不受影响（按图片内容哈希命中）；清空 OCR 缓存入口不变。

## 已验证

- `pnpm check` 通过；`pnpm test` 256 项全部通过（重写 ai-input 行为测试：手写不入 OCR 截图、OCR 关闭拒绝发送、缓存指纹、真实准备/分析链路含手写图片直传与取消、预算按整题截断；更新 ai-subsystem 契约断言与桥命令一致性）。
- `pnpm build` 通过。测试期间修复两处实现 bug：手写图片存储路径重复 `images/` 前缀；OCR 内容缓存导致批量准备不发请求（测试改为每题独立图片）。

## 未验证限制

- 配置页与准备/分析流程在浏览器和 MarginNote 真机上的视觉与交互未实测（本变更无浏览器截图验收）。
- 真机绑定手写元素捕获质量、多模态请求被服务接受程度仍未验证；DeepSeek 官方接口不支持图片输入，开启手写内容向其发送会得到服务端错误。
- 本轮为普通开发提交，未升版、未交付安装包；交付需按流程另起 b6。
