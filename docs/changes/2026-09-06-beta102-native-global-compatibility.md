# beta.102 原生全局兼容修复

## 变更目的

修复 beta.101 在启用 MinerU OCR 后批量读取错题时，所有题目均因
`undefined is not an object (evaluating 'K.NSFileManager.defaultManager')`
而被计为不可用的问题；同时确认 beta.100 日志中的答案查找失败实际发生在
匹配成功后的答案窗口创建阶段。

## 实现行为

- AI 子系统不再从 `marginnote` JavaScript 包导入 Objective-C 原生类。
  `NSFileManager`、`NSData`、`NSJSONSerialization`、`NSMutableURLRequest`、
  `NSURLConnection`、`NSOperationQueue` 均改用 MarginNote 注入的运行时全局对象。
- 保留 `NSJSONReadingOptions`、`UIAlertViewStyle` 等确实存在于包运行时导出的枚举，
  不扩大改动范围。
- 新增回归断言，禁止上述原生类重新进入 `marginnote` 命名导入。
- 收紧 `UIFont` 回归断言为检测实际属性调用，允许源码注释记录根因；答案窗口代码
  仍不得执行任何 `UIFont.*` 调用。
- 对最终 `AnswerMatcherCore.js` 做产物级检查，确保不存在
  `.NSFileManager` 等模块属性访问，所有原生类均保持为全局引用。

## 受影响文件或模块

- `src/ai-subsystem.ts`
- `tests/ai-subsystem.test.ts`
- `package.json`（版本 `2.3.3-beta.102`）
- `RELEASE_NOTES_v2.3.3-beta.102.md`

## 兼容性与数据影响

- 不修改错题库、AI 设置、OCR 缓存和报告数据结构，不需要迁移。
- 不改变跨学习集错题读取与答案匹配规则。
- 修复只调整原生 API 的解析方式；未启用 MinerU 的分析路径也继续兼容。
- 插件继续构建正式渠道（`mnChannel: "stable"`），插件 ID 与标题不变。

## 验证

- `pnpm check`：通过。
- AI 子系统定向测试：23/23 通过。
- `pnpm test`：207/207 通过。
- `pnpm build`：通过；Vite 仍报告既有 `.sfIconGlyph:svg` CSS 警告，不影响构建完成。
- 构建产物审计：六个原生类的模块属性匹配均为 0；全局引用均存在。
- 已复制 `dist/mn4-answer-matcher-v2.3.3-beta.102.mnaddon` 到
  `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.102.mnaddon`。
- 源包与交付副本 SHA-256 均为
  `77fba1a940cfa5fffb413f9af2d3ac3edc5488f51b703b07bc83e0f1e9f42ea4`，校验一致。

## 未验证限制

- 尚未在 MarginNote 4 真机中重新运行同一组 8 道错题的 MinerU 分析。
- 尚未在真机复测答案窗口显示；源码与自动化已覆盖 beta.100 的 `UIFont` 崩溃点。
