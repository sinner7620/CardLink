# CardLink v2.4.1b7

## 修复

- 修复 MinerU OCR 完成下载并读取 `full.md` 时 MarginNote 4 可能直接闪退的问题。
- 移除 OCR 结果读取路径中的 `NSString.alloc()`：该调用在 MarginNote 的 JavaScriptCore 桥接层会暴露尚未初始化的 `NSPlaceholderString`，产生无法由 JavaScript 捕获的 Objective-C 异常。
- 改为通过已初始化的 `NSData` 获取 base64，再由纯 JavaScript UTF-8 解码器读取 Markdown，兼容中文、公式符号和非 BMP 字符。

## 兼容性

- OCR 缓存文件、题目文本快照与 MinerU API 调用格式不变，不需要迁移数据。
- UTF-8 解码器不依赖 `TextDecoder`，可在 MarginNote 4 当前 JavaScriptCore 环境运行。

## 验证

- 崩溃报告堆栈：已确认异常位于 `NSPlaceholderString length` → JavaScriptCore Objective-C 返回值转换，调用链来自 `NSURLConnection` 完成后的 OCR 结果处理。
- MinerU 定向测试：通过，40/40。
- `pnpm check`：通过。
- `pnpm test`：通过，228/228。
- `pnpm build`：通过；保留现有 `.sfIconGlyph:svg` 非法伪类警告，不影响产物生成。
- 正式构建产物：`dist/CardLink-v2.4.1b7.mnaddon`，573,716 字节。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b7.mnaddon`。
- 两份文件 SHA-256 均为 `F4134D67B3A6A59F548265B56F3213CFE32B7EDBE7974D51F41FF8AEC85ED474`。
- 包内清单确认：正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b7`。

## 未验证限制

- 当前环境无法在用户 iPad 的 MarginNote 4.4.5 内重放真实 MinerU 任务，修复仍需真机复测确认。
