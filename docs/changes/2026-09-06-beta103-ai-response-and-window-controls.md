# beta.103 AI 响应与答案窗口控件修复

## 变更目的

修复 AI 错题总结在 48% 长时间无进度、失败只显示 `[object NSNull]`、API
测试没有可见结果，以及答案查找窗口关闭图标偏小且三个按钮规格未完全同源的问题。

## 实现行为

- Foundation JSON 解析结果递归归一化：原生 `NSNull` 在进入业务逻辑和 Web 桥前
  转换为 JavaScript `null`，错误信息只接受有效字符串，不再泄漏对象描述。
- 模型协议按服务类型分流：OpenAI 使用 `/responses`，DeepSeek 使用
  `/chat/completions` 与 JSON object 响应格式。
- 成功响应若没有文本内容会返回明确错误；API 测试开始时即时显示测试中状态，
  成功时显示服务名与模型，失败时展示规范化后的具体错误。
- 模型请求期间每秒推进可见进度，48% 后逐步前进并在 82% 等待响应；完成后进入
  保存阶段，避免长请求被误判为卡死。
- 答案窗口关闭、刷新、候选按钮统一通过 `createWindowControlButton` 创建，共用
  40pt 点击面、圆角、内缩和事件绑定；候选按钮仅保留选中态颜色差异。
- 关闭符号由字面框偏小的 `×` 调整为占位更完整的 `✕`，不引入真机不存在的
  `UIFont` 调用。

## 受影响文件或模块

- `src/ai-subsystem.ts`
- `web/src/main.jsx`
- `src/window-controls.ts`
- `src/answer-card-view.ts`
- `tests/ai-subsystem.test.ts`
- `tests/plugin-events.test.ts`
- `package.json`（版本 `2.3.3-beta.103`）
- `RELEASE_NOTES_v2.3.3-beta.103.md`

## 兼容性与数据影响

- 不修改错题库、AI 设置、凭据、OCR 缓存和报告数据结构，无需迁移。
- OpenAI 服务协议保持不变；DeepSeek 从不兼容的 Responses 请求改为其兼容的
  Chat Completions 请求。
- 插件继续构建正式渠道（`mnChannel: "stable"`），插件 ID 与标题不变。
- 按钮交互区域仍为 40pt，不改变答案窗口布局宽度与拖动区域。

## 验证

- `pnpm check`：通过。
- AI、原生控件与 Web 渲染定向测试：53/53 通过。
- `pnpm test`：210/210 通过。
- `pnpm build`：通过；Vite 仍报告既有 `.sfIconGlyph:svg` CSS 警告，不影响构建完成。
- 产物检查：版本、DeepSeek Chat Completions、NSNull 归一化与新关闭符号均已进入
  `AnswerMatcherCore.js`。
- 已复制 `dist/mn4-answer-matcher-v2.3.3-beta.103.mnaddon` 到
  `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.103.mnaddon`。
- 源包与交付副本 SHA-256 均为
  `95ce6ac257b41a6972835b4ce666fb0c4c97c42e2862bb87dd20b3d765b53963`，校验一致。

## 未验证限制

- 尚未使用用户实际 API Key 在真机请求 OpenAI 或 DeepSeek。
- 尚未在 MarginNote 4 真机目测 `✕` 与刷新、候选数字的最终光学大小。
