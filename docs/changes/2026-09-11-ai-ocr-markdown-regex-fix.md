# 修复 AI 配置页 OCR Markdown 正则崩溃

## 变更目的

修复打开 AI 配置页并显示已保存 OCR 结果时出现 `Invalid regular expression: unmatched parentheses`、导致 OCR 对比区域无法显示的问题。

## 已实现行为

- 修正 Markdown 图片语法 `![说明](地址)` 和链接语法 `[文字](地址)` 的匹配表达式。
- OCR 文本包含图片引用或链接时不再在 `RegExp` 构造阶段抛出异常。
- 图片引用继续以安全的文字占位渲染；链接继续只显示链接文字，不把 OCR 返回的地址直接注入页面。
- 导出页共用同一个 Markdown 预览函数，因此同类内容的导出预览也同步修复。

## 影响文件与模块

- `web/src/main.jsx`：修复 Markdown 图片、链接渲染表达式，并导出渲染函数供冒烟测试直接执行。
- `tests/web-render-smoke.test.ts`：新增包含图片及链接 Markdown 的真实执行回归测试。
- `package.json`：版本升级为 `2.4.1b9`，正式渠道配置保持不变。

## 兼容与数据影响

- 不修改 OCR JSON、题目图片或报告数据结构，不需要重新 OCR。
- 已保存的 OCR 结果可直接在新版本中打开。
- 插件 ID 仍为 `marginnote.extension.mn4-answer-matcher`，`mnChannel` 仍为 `stable`。

## 验证

- 定向测试：通过，57/57；覆盖 OCR Markdown 图片和链接渲染。
- `pnpm check`：通过。
- `pnpm test`：通过，232/232。
- `pnpm build`：通过；构建仍报告一条既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响安装包生成。
- 正式构建：`dist/CardLink-v2.4.1b9.mnaddon`，575,775 bytes。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b9.mnaddon`。
- 源文件与交付副本 SHA-256 一致：`59185E834B8DB5811E842020D824D8B534221B9A6CD76B645A45113C8AF67057`。
- 包内清单：版本 `2.4.1b9`、标题 `CardLink`、正式插件 ID 保持不变。

## 未验证限制

- 当前环境无法直接在用户 iPad 的 MarginNote WebView 中复现，但导致异常的表达式已在与生产源码同源的 Web bundle 中真实执行并覆盖。
- 既有 `.sfIconGlyph:svg` CSS 构建警告不属于本轮正则修复范围。
