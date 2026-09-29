# MN4 Answer Matcher v2.3.3-beta.106

## 修复

- 修复启用 MinerU 时含图片错题全部读取失败的问题。
- 不再调用真机缺失的 `NSData.dataWithBytesLength`；图片上传复用已验证的 Latin-1 NSData 桥接路径。
- 增加空图片及 NSData 创建失败的明确错误提示。

## 验证

- AI 定向测试通过（29/29）。
- TypeScript 检查与正式插件构建通过。
- 全量自动化测试通过（214/214）。
- 已确认正式产物不含 `dataWithBytesLength`，并复制至 iCloud 同步目录。
- 源文件与副本 SHA-256 均为 `45B3FD111533491F4B0E57C766E30DB7FE3AF4C6E5A7CEE736393256DD039DAA`。

## 未验证限制

- 自动化环境不能使用用户实际 MinerU Token 执行 MarginNote 真机图片上传。
