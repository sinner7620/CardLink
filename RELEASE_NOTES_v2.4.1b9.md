# CardLink v2.4.1b9

## 修复

- 修复打开 AI 配置页、加载 OCR 结果时提示 `Invalid regular expression: unmatched parentheses` 的问题。
- OCR Markdown 中包含图片语法或链接语法时，现在可以安全显示原题卡片与识别文本对比。
- 修复同一个 Markdown 渲染器在导出预览中的对应故障。

## 数据兼容

- 无需重新 OCR；`2.4.1b8` 已保存的单题 JSON 和整卡 JPG 可直接使用。
- 不改变 OCR 缓存、报告或 `CardLink/` 目录结构。
- 保持正式插件 ID、标题和 `stable` 构建渠道。

## 验证

- `pnpm check`：通过。
- 定向测试：57/57 通过。
- 全量测试：232/232 通过。
- `pnpm build`：通过；存在一条与本轮无关的既有 CSS 选择器警告。
- 安装包大小：575,775 bytes。
- SHA-256：`59185E834B8DB5811E842020D824D8B534221B9A6CD76B645A45113C8AF67057`。
- 已复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b9.mnaddon`，交付副本哈希一致。

## 未验证限制

- 当前环境无法直接执行用户 iPad 上的 MarginNote WebView 真机复测。
