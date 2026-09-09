# AI 错题分析与科目配置

## 目的

在不改变错题主数据库的前提下，为错题工作台加入按科目汇总的 AI 分析，并保持现有插件的简洁 UI 风格。

## 已实现

- 新增独立 AI 设置、凭据状态、科目和报告存储；一门科目可绑定多个学习集，同一学习集只归属一门科目。
- 设置页“错题管理”新增 AI 入口，配置页提供总开关、科目、OpenAI/DeepSeek、MinerU、发送范围、定期生成、OCR 缓存和报告管理。
- API Key/Token 通过原生安全输入框接收；默认仅会话保存，可选择带风险提示的本地持久化，Web 端只接收掩码状态。
- 总览底部新增 AI 错题总结：科目选择、生成预检、进度、过期提示，以及薄弱点、错误模式、复习建议和证据题回跳。
- OpenAI 与 DeepSeek 使用 Responses API 和 JSON Schema 报告；问题、答案、路径、等级、历史和自定义标签按隐私设置组装。
- MinerU 使用精准解析 `vlm`：批量申请上传地址、二进制 PUT、异步轮询、ZIP 解压和 OCR 缓存；每批保守限制 50 个文件。
- 每科可配置每日、每周或每月生成；插件打开工作台时检查到期项并补跑，不承诺应用关闭时后台唤醒。
- AI 只读取错题事实并生成报告，不修改错题等级、标签、复习计划或 `mistakes.v2`。

## 影响范围

- 核心：`src/ai-subsystem.ts`、`src/rails-core.ts`、`src/globals.d.ts`
- Web：`web/src/main.jsx`、`web/src/ui/overview.css`、`web/src/ui/settings.css`
- 测试与交付：`tests/ai-subsystem.test.ts`、`package.json`

## 兼容性与数据影响

- 新设置键为 `mn4-answer-matcher.ai.settings.v1`，凭据使用独立键；现有设置和错题记录无需迁移。
- 报告位于 `MNAnswerMatcher/ai/reports`，OCR 缓存位于 `MNAnswerMatcher/ai/ocr`。
- AI 默认关闭；未配置科目和密钥时不会产生外部请求。
- 本地持久化密钥不具备系统 Keychain 级加密，界面在写入前明确提示。

## 验证

- `pnpm check`：通过。
- `pnpm test`：187/187 通过。
- `pnpm build`：通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.95.mnaddon`。
- 源安装包 SHA-256：`217927E961B47BC0E986A7E2335D48EFE8B20D399CF8555C334F7F2E825BEEAA`。
- 已复制到 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.95.mnaddon`；副本 SHA-256 相同。

## 未验证限制

- 未使用真实 OpenAI、DeepSeek、MinerU 密钥进行计费 API 调用。
- MinerU 的 NSData 二进制 PUT、ZIP 下载解压和返回目录结构仍需在 MarginNote 4 真机验证。
- 定期生成依赖工作台被打开触发前台检查，应用关闭时不会准点运行。
- 单次分析当前最多处理 300 道错题，超出部分留待后续分层聚合版本处理。
