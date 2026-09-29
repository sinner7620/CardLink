# 增加智谱 GLM-OCR 引擎

## 变更目的

在现有错题题目准备流程中增加智谱 GLM-OCR，让用户可以按成本、速度和识别效果在 MinerU 与 GLM-OCR 之间选择，同时继续复用整卡渲染、逐题进度、本地文本快照与后续 AI 总结链路。

## 文档依据

- 智谱官方模型文档说明 GLM-OCR 支持 JPG、PNG、PDF，图片可使用 URL 或 Base64 输入，单图不超过 10 MB。
- 官方文档解析接口为 `POST https://open.bigmodel.cn/api/paas/v4/layout_parsing`，请求模型固定为 `glm-ocr`，Markdown 结果位于 `md_results`。
- 接口使用 Bearer API Key 鉴权；本实现不请求裁剪图片和布局可视化结果，避免无用响应数据。

## 已实现行为

- AI 设置新增 `ocrEngine`，允许选择 `mineru` 或 `glm-ocr`；旧配置缺少该字段时默认 MinerU。
- 新增 `glmOcr` 配置：默认 API 根地址、固定模型 `glm-ocr`、独立凭据引用和请求超时。
- 题目识别设置改为通用 OCR 开关和引擎选择：
  - MinerU 保留原 Token、策略、公式和表格设置；
  - GLM-OCR 显示 API 地址、固定模型、API Key 保存方式和 10 MB 提示。
- GLM-OCR 接收现有整卡 JPEG Data URI，发送前剥离 Data URI 前缀并提交纯 Base64。
- 发送前验证图片格式为 JPG/PNG，并按 Base64 长度估算二进制大小；超过 10 MB 时本地拒绝。
- 成功响应读取 `md_results`；空结果给出明确错误，不保存空快照。
- GLM-OCR 缓存文件使用 `glm-ocr-<图片SHA256>.json`，与既有 MinerU 缓存隔离，并保存 Token 用量信息。
- 题目准备任务在创建时固定 `ocrEngine`，整批任务不会因设置页中途切换而混用引擎。
- 已准备题目快照根据实际引擎记录 `provider` 和 `model`。
- 浏览器预览配置同步增加 GLM-OCR 示例状态。

## 影响文件与模块

- `src/ai-subsystem.ts`：配置归一化、凭据状态、GLM-OCR 请求、缓存隔离、引擎路由与任务引擎快照。
- `web/src/main.jsx`：OCR 引擎选择和 GLM-OCR 配置界面。
- `web/src/ui/settings.css`：OCR 说明与凭据状态样式。
- `web/src/lib/previewBridge.js`：GLM-OCR 预览配置。
- `tests/ai-subsystem.test.ts`：接口、Base64、响应、大小限制、缓存与界面回归断言。
- `package.json`、`RELEASE_NOTES_v2.4.1b4.md`：版本和发布说明。

## 兼容与数据影响

- 版本升级为 `2.4.1b4`；`mnChannel` 仍为 `stable`，正式插件 ID 与标题不变。
- 配置 schema 继续由归一化函数兼容读取：已有用户默认保留 MinerU，不会自动切换或发送到智谱。
- GLM-OCR API Key 使用独立凭据引用，不与 MinerU Token 或 AI 总结模型密钥混用。
- 切换引擎后需要重新执行题目准备，才会用新引擎覆盖对应题目的本地 OCR 文本。

## 验证

- `pnpm check`：通过。
- 定向测试 `tests/ai-subsystem.test.ts`、`tests/bridge-schema.test.ts`、`tests/web-render-smoke.test.ts`：通过，50/50。
- `pnpm test`：通过，224/224。
- `pnpm build`：通过；保留现有 `.sfIconGlyph:svg` 非法伪类警告，不影响产物生成。
- 正式构建产物 `dist/CardLink-v2.4.1b4.mnaddon`：571,663 字节。
- 已复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b4.mnaddon`；源文件和交付副本 SHA-256 均为 `6F7836A566A1C9884A295D7D1F77FC9AAAC088828ADF445CBB2CAB8F9FAEAA9B`。
- 包内 `mnaddon.json` 已确认正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b4`。

## 未验证限制

- 当前没有使用用户的真实智谱 API Key 发起计费请求；真实接口可用性、OCR 质量与超时表现仍需 MarginNote 4 真机验证。
