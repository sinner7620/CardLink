# 手写原图作为选项随分析请求发送

日期：2026-09-13。基于 v2.4.1-b4 工作树（快照 c7400d1）。

## 目的

落实《AI 错题分析实现复核与完善方案》的目标设计「题目文本与绑定手写一起发送」中可先行落地的部分：把脑图绑定手写原图作为独立附件，经用户显式开关后随题目文本一起发送给分析模型。此前分析模型只接收文字，手写只能以 OCR 文本形式间接到达。

## 实现行为

- 新增设置 `privacy.handwritingToModel`（默认关闭），位于 AI 配置页「发送内容」组：「手写原图发给分析模型」。开启条件在提示中说明：需开启「脑图绑定手写」且图片上传不为「禁止」；模型需支持图片输入。
- 题目准备阶段：网页端渲染整卡后，若文档内含 `.bound-mindmap-handwriting` 区块，单独对该区块截图，与整卡截图一起经 `aiSubmitPreparationImage` 的 `handwritingDataUri` 提交；原生侧另存为独立文件（`images/<hash(recordId-handwriting)>.jpg`），并在准备快照中记录 `handwritingImageFile / handwritingImageMime / handwritingImageBytes`。截图失败只导致该题无手写原图，不阻断 OCR 准备。
- 分析阶段：开关开启且题目走 OCR 路径时，读取快照中的手写原图（单图 Base64 上限 4,000,000 字符，单次请求上限 `MAX_ANALYSIS_IMAGES = 30` 张），以附件编号 `Qxxx-H1` 写入该题文本行，并经 `analysisUserContent` 组装进请求：Chat Completions 用 `image_url` 内容块，Responses 用 `input_image` 内容块；Base64 绝不拼入 prompt 文本。
- 请求头部注明随附手写原图数量与对应规则；未附带的原因（未重新准备、无绑定手写、图片超限）与数量上限截断均写入报告 `limitations`。
- 该开关不参与 `preparationPolicyFingerprint`：准备时无条件另存手写原图，因此事后开启开关对已准备题目直接生效，无需重新准备；但手写内容本身变化仍会经来源指纹触发重新准备。
- 开关变化会经 `taskSettingsFingerprint` 取消进行中的分析任务，与既有发送范围变更行为一致。

## 受影响文件

- `src/ai-input.ts`：新增 `ModelImageAttachment` 与 `analysisUserContent`。
- `src/ai-subsystem.ts`：设置结构/归一化、快照字段、`processPreparationImage` 另存手写图、`aiSubmitPreparationImage` 透传、`runAnalysis` 附件收集与 limitations、`callLLM` 多模态请求体、`readImageFileDataUri` 辅助函数。
- `web/src/main.jsx`：准备流程单独截图手写区；设置页新增开关、摘要行与提示文案；`normalizeAISettingsView` 补默认值。
- `tests/ai-input-behavior.test.ts`：`analysisUserContent` 行为测试（chat/responses 两种协议、无附件回退）。
- `tests/ai-subsystem.test.ts`：新增手写原图直传契约的窄静态检查。

## 兼容与数据影响

- 旧准备快照无手写图字段：开关开启后这些题目被记入 limitations（未重新准备），不会误用旧数据；重新准备一次即恢复。
- 手写原图仅存本地 CardLink 目录，只有开关开启时才随请求外发；OCR 链路行为不变。

## 已验证

- `pnpm check` 通过（tsc --noEmit）。
- `pnpm test` 257 项全部通过。首跑暴露回归：无附件时请求体被组装成内容数组，破坏纯文本请求兼容；已修正为仅在存在手写附件时使用多模态内容数组，纯文本请求与 b4 完全一致。
- `pnpm build` 通过，产出 `dist/CardLink-v2.4.1-b4.mnaddon`（本地构建验证，非交付包；未升版、未复制到同步文件夹）。

## 未验证限制

- MarginNote 真机链路：绑定手写渲染区块在实际卡片中的呈现、html2canvas 区块截图质量、真机 HTTP 多模态请求体是否被所选服务接受，均未在设备上验证。
- 各服务（OpenAI Responses、DeepSeek 等）对图像字段与尺寸上限的支持未在线验证；DeepSeek 官方接口当前不支持图片输入，开启开关向其发送图片会得到服务端错误。
