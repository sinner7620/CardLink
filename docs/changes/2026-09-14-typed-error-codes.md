# 2026-09-14 类型化错误码与桥接呈现边界

## 目的

把“错误是什么”与“错误如何展示”分开，消除依赖中文异常文本和正则判断错误类别的脆弱映射。该改动是后续 i18n 的基础，但当前只提供中文文案，不改变 Web 界面语言。

开始实施前已按要求将上一轮插件修改独立备份为提交 `45bd83d`；该提交未包含用户此前对 `AGENTS.md`、`docs/workflow.md` 的改动，也未包含无关未跟踪文件。

## 实现行为

- 新增 `src/errors.ts`：定义受类型约束的 `ErrorCode` 清单、`ErrorParams`、`CardLinkError` 及跨边界安全识别函数。duck-type 识别只接受登记过的 code，未知字符串不会伪装成正式错误码。
- `src/error-messages.ts` 改为以 `error.<code>` 键查中文表，支持参数化文案。`describeError` 有码时优先查表、无码时保留原关键字正则作为一个版本的兼容层；原 passthrough 白名单已删除。
- `presentError` 统一返回 `{ code?, message }`。`src/rails-core.ts` 在命令分发 catch 中先记录原异常，再将呈现信封交给原生响应层；`rails-native/WebPanelController.js` 序列化可选 code 和必需 message。
- Web 端不新增错误码逻辑，仍使用 `reason.message`；现有 string/object 兼容行为不变。
- 首轮将 matcher、mistake-manager、ai-subsystem 中 40 余个稳定、面向用户的抛错点码化，并补充插件配置、更新包校验和调试门闸的少量同类入口。内部协议断言、无效命令及动态服务端业务错误仍保持原异常。
- AI 网络边界区分 `network` 与 `timeout`，保留原生或 HTTP 细节作为呈现参数；AI 后台任务的失败汇总也通过 `describeError` 转换，避免把 code 裸露到任务状态或报告限制说明。

## 影响文件

- 错误模型与呈现：`src/errors.ts`、`src/error-messages.ts`
- 码化抛错点：`src/matcher.ts`、`src/mistake-manager.ts`、`src/ai-subsystem.ts`、`src/plugin.ts`、`src/updater.ts`、`src/rails-core.ts`
- 原生错误信封：`rails-native/WebPanelController.js`
- 测试：`tests/domain.test.ts`、`tests/bridge-schema.test.ts`、`tests/ai-subsystem.test.ts`、`tests/mistake-write-behavior.test.ts`
- 契约文档：`docs/modules/src/error-messages.md`、`docs/modules/src/rails-core.md`、`docs/modules/web/lib/mnBridge.md`

## 兼容与数据影响

- 不修改错题、绑定、索引、AI 设置或缓存的持久化格式，无数据迁移。
- 桥接错误对象只新增可选 `code`；`message` 始终存在且已经是用户文案。旧 Web 忽略新增字段，新 Web 原有 `reason.message || String(reason)` 逻辑继续可用。
- 未码化异常暂时保留关键字归类与安全兜底；不再因“看起来像策划文案”而任意透传。
- 用户随后明确授权本轮同版本替换 `2.4.2`；授权只适用于本轮。`package.json` 版本与正式插件身份不变，更新 `RELEASE_NOTES_v2.4.2.md` 后重新执行完整交付校验并替换既有安装包。

## 验证

- `pnpm check`：通过。
- 相关行为与协议测试：97/97 通过，覆盖有码查表、参数插值、未知 code 拒绝、无码兼容、桥接信封形状、AI 批处理错误呈现及错题写入错误分类。
- `pnpm test`：264/264 通过。
- `pnpm build`：通过，生成 `dist/CardLink-v2.4.2.mnaddon`；构建仍报告既有 `.sfIconGlyph:svg` CSS 选择器警告，本任务未修改该样式。
- `git diff --check`：通过（仅有 Git 的 LF→CRLF 工作区提示，无空白错误）。
- 未做 MarginNote 真机验证；原生控制器对新增可选字段的序列化与 Web 展示仍需设备验收，本轮不据此声称真机已验证。

## 同版本替换交付

- 授权：用户于 2026-09-14 明确要求“编译替换当前2.4.2”；该例外不延续到后续修改。
- 最终门禁：`pnpm check` 通过；`pnpm test` 264/264；`pnpm build` 通过。构建仍有既有 `.sfIconGlyph:svg` CSS 选择器警告，本任务未修改该样式。
- 归档内 `mnaddon.json`：version `2.4.2`、addonid `marginnote.extension.mn4-answer-matcher`、title `CardLink`；`package.json` 为 `mnChannel: "stable"`。
- 源包 `E:\project\MN\dist\CardLink-v2.4.2.mnaddon` 与交付副本 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2.mnaddon` 均为 582,376 bytes，SHA-256 均为 `48e7cc6734b7ccbda2029173a7977fc0a8d5aeb8c841542773b794216af9e35d`。
- 未发布到 GitHub/Gitee；远端发布仍需另行明确授权。
