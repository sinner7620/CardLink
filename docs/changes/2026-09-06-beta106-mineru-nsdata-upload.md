# v2.3.3-beta.106 MinerU 图片 NSData 上传修复

## 变更目的

修复启用 MinerU 后全部含图片错题读取失败，并汇总提示 `NSData.dataWithBytesLength is not a function` 的问题。该方法虽然存在于 `marginnote` 类型声明中，但没有被 MarginNote 4 真机 JavaScriptCore 暴露。

## 已实现行为

- 删除 MinerU 上传路径对 `NSData.dataWithBytesLength` 的调用。
- 将图片 data URI 的 base64 正文解码为 Latin-1 二进制字符串，再通过项目现有真机路径使用的 `NSData.dataWithStringEncoding(binary, 5)` 创建请求体。
- 上传前检查空图片，NSData 创建失败时返回明确的 MinerU 图片数据错误。
- 增加回归测试，确保 AI 源码不再出现缺失的字节指针静态构造调用。

## 影响文件或模块

- `src/ai-subsystem.ts`
- `tests/ai-subsystem.test.ts`
- `package.json`
- `RELEASE_NOTES_v2.3.3-beta.106.md`

## 兼容性与数据影响

- 不修改错题数据、AI 设置、凭据、OCR 缓存或报告结构，无需迁移。
- 仅调整 MinerU 图片上传请求体的 NSData 构造方式；普通文字错题和 LLM 调用协议不变。
- 插件继续构建正式通道 `mnChannel: "stable"`。

## 验证

- AI 定向测试：通过，29/29。
- `pnpm check`：通过。
- `pnpm test`：通过，214/214。
- `pnpm build`：通过；保留一条既有的 Lightning CSS `.sfIconGlyph:svg` 伪类警告，不影响产物生成。
- 已检查正式产物：`AnswerMatcherCore.js` 包含 Latin-1 `dataWithStringEncoding` 路径，且不包含 `dataWithBytesLength`。
- 已复制 `dist/mn4-answer-matcher-v2.3.3-beta.106.mnaddon` 到 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.106.mnaddon`。
- 源文件与复制文件 SHA-256 均为 `45B3FD111533491F4B0E57C766E30DB7FE3AF4C6E5A7CEE736393256DD039DAA`，校验一致。

## 未验证限制

- 当前环境不能使用用户的 MinerU Token 在 MarginNote 真机上传实际题图；交付后建议用同一批 16 道错题复测。
