# 修复 MinerU OCR 结果读取闪退

## 变更目的

修复 MinerU OCR 任务完成后，插件在读取服务端结果 Markdown 的过程中导致 MarginNote 4 整个应用闪退的问题。

## 崩溃证据与根因

- 用户提供的 `MarginNote 4-2026-09-11-114401.ips` 显示主线程因未捕获 Objective-C 异常以 `SIGABRT` 终止。
- 最后异常栈包含 `_NSRequestConcreteObject`、`-[NSPlaceholderString length]`、`WTF::String::String` 和 JavaScriptCore 的 Objective-C 返回值转换，底部是 `NSURLConnection` 异步请求完成回调。
- 对照 OCR 下载路径，唯一会创建 NSString 占位对象的调用是读取 `full.md` 时的 `NSString.alloc().initWithDataEncoding(...)`。
- MarginNote 的 JavaScriptCore 桥会在 `init` 调用前尝试把 `alloc` 返回的 `NSPlaceholderString` 转成 JavaScript 字符串，从而向未初始化占位对象发送 `length`；此原生异常发生在桥接边界，JavaScript `try/catch` 无法拦截。

## 已实现行为

- `readUtf8` 不再创建 NSString 实例，而是用 `NSData.dataWithContentsOfFile` 读取文件，并从已初始化 NSData 获取 base64 字符串。
- 新增纯 JavaScript `decodeBase64Utf8`，将 base64 字节安全解码为 UTF-8 文本。
- 解码覆盖 ASCII、中文、二至四字节 UTF-8、非 BMP 代理对以及非法字节替换，不依赖 MarginNote 运行时是否提供 `TextDecoder`。
- 新增回归断言，禁止 OCR 子系统重新出现 `NSString.alloc()` 调用，并验证中文与非 BMP 字符的解码结果。

## 影响文件与模块

- `src/ai-subsystem.ts`：替换 MinerU `full.md` 原生字符串读取路径。
- `src/base64.ts`：新增运行时兼容的 base64 UTF-8 解码器。
- `tests/ai-subsystem.test.ts`：新增崩溃路径和 UTF-8 内容回归测试。
- `package.json`、`RELEASE_NOTES_v2.4.1b7.md`：版本与发布说明。

## 兼容与数据影响

- 版本升级为 `2.4.1b7`；`mnChannel` 保持 `stable`，正式插件 ID 和标题不变。
- 不修改错题数据、OCR 缓存格式、题目文本快照或网络协议，无需数据迁移。
- 已下载 Markdown 仍以原 UTF-8 内容进入 OCR 缓存和题目文本数据库。

## 验证

- 崩溃报告与源码调用链完成对照。
- MinerU 定向测试：通过，40/40。
- `pnpm check`：通过。
- `pnpm test`：通过，228/228。
- `pnpm build`：通过；保留现有 `.sfIconGlyph:svg` 非法伪类警告，不影响产物生成。
- 正式构建产物 `dist/CardLink-v2.4.1b7.mnaddon`：573,716 字节。
- 已复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b7.mnaddon`；源文件和交付副本 SHA-256 均为 `F4134D67B3A6A59F548265B56F3213CFE32B7EDBE7974D51F41FF8AEC85ED474`。
- 包内 `mnaddon.json` 已确认正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b7`。

## 未验证限制

- 当前环境无法在用户 iPad 的 MarginNote 4.4.5 内重放真实 MinerU 任务；需要安装本轮构建后进行真机 OCR 复测。
