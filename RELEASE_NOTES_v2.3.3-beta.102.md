# v2.3.3-beta.102

基线：beta.101。修复 AI 错题内容读取与答案窗口的 MarginNote 真机兼容问题。

## 修复

- 修复启用 MinerU 后逐题报
  `undefined is not an object (evaluating 'K.NSFileManager.defaultManager')`：
  原生文件、数据、JSON 与网络类不再从没有对应运行时导出的 `marginnote` 包读取，
  改为使用 MarginNote 注入的 Objective-C 全局对象。
- beta.100 日志中的答案匹配已成功找到唯一答案，失败发生在答案窗口创建；当前版本
  不再调用真机不存在的 `UIFont` 全局，答案查找结果可以继续进入展示阶段。
- 增加源码导入边界和最终构建产物回归检查，防止再次生成
  `K.NSFileManager` 一类必然为 `undefined` 的模块属性访问。

## 验证

- `pnpm check`：通过。
- AI 子系统定向测试：23/23 通过。
- `pnpm test`：207/207 通过。
- `pnpm build`：通过。
- 最终构建包与 iCloud 交付副本 SHA-256 一致：
  `77fba1a940cfa5fffb413f9af2d3ac3edc5488f51b703b07bc83e0f1e9f42ea4`。

## 未验证

- 需在 MarginNote 4 真机复测 MinerU 错题分析与答案窗口展示。
