# v2.3.3-beta.103

基线：beta.102。修复 AI 错题总结、API 测试反馈和答案窗口按钮一致性。

## 修复

- 将 Foundation 返回的原生 `NSNull` 递归转换为标准 `null`，错误不再显示
  `[object NSNull]`。
- DeepSeek 改用 `/chat/completions`，OpenAI 继续使用 `/responses`；成功但无文本
  时给出明确提示。
- 总结生成在 48% 后持续显示请求进度，不再长时间停在同一数值。
- API 测试即时显示进行中状态，并明确返回服务名、模型或具体失败原因。
- 答案查找窗口的关闭、刷新和候选按钮统一为同一套 40pt 规格；关闭图标改为
  视觉占位更完整的 `✕`。

## 验证

- `pnpm check`：通过。
- 定向测试：53/53 通过。
- `pnpm test`：210/210 通过；`pnpm build`：通过。
- 源包与 iCloud 交付副本 SHA-256 一致：
  `95ce6ac257b41a6972835b4ce666fb0c4c97c42e2862bb87dd20b3d765b53963`。

## 未验证

- 需在 MarginNote 4 真机使用实际 API Key 复测两类服务及按钮光学尺寸。
