# AI 发送策略、缓存、引用与取消修复

## 目的与范围

修复用户从 2026-09-11 审查中选定的四项问题：发送选项不生效、旧缓存误用、整批截断后引用错位、取消后仍保存报告。沿用已有工作树的手写模块提取和预览改动，不恢复或清理其他修改；未扩展到多模态直传或其他历史审查项。

版本从本地 2.4.1-b3 递增到 2.4.1-b4；保持 stable、marginnote.extension.mn4-answer-matcher、CardLink。不发布远端。

## 实现

- `src/ai-input.ts`：集中定义准备策略指纹、过滤图片/卡片手写、OCR 分流、快照身份比较及完整题目装包。脑图手写在卡片手写过滤后单独加入，两个开关互不替代；禁止图片是截图外发的总限制。
- `src/ai-subsystem.ts`：新准备快照为 schemaVersion 3，保存来源/策略指纹；来源涵盖原卡片正文、图片/卡片手写内容及选定脑图手写。OCR 缓存键也纳入识别配置。直接读取文字时不消费旧混合 OCR，不上传截图。
- 准备图片提交前、OCR 返回后重新读取并校验来源；分析逐题校验缓存，请求前再次核对所选来源。旧快照继续可查看，但缺少新指纹不能进入 OCR 分析分支。
- 119000 字符作为完整题目正文预算，为请求头保留 1000 字符。超长或剩余预算不足的题目整题跳过；后续能放入的题目仍可发送。引用表只由最终入包题目生成；校验引用要求自有键，排除未发送题号和对象原型键。
- 报告的 recordCount/coverage.analyzed/usable 使用实际发送数；新增 selected/budgetOmitted，局限字段注明跳过及不可用原因。科目范围指纹保存全科目，与列表比较范围一致。
- 请求前、原生网络回调、模型等待及保存前检查取消；取消即时进入终态，迟到成功/失败均不写报告。设置相关内容变化时取消正在进行的准备/分析，关闭再开启不恢复旧任务。OCR 网络回调也遵守同一规则。
- `web/src/main.jsx`：OCR 策略对两种引擎均显示，解释图片开关与手写关系；预检显示候选/可用/需准备数；本地文字快照不误显示旧图片。`web/src/lib/previewBridge.js` 补充对应预检样例字段。

## 兼容与数据影响

- 不修改错题主库存储，不写原卡片标签、掌握等级或复习历史。
- 旧 schema 1/2 OCR 及报告保留，图文核对仍可读；需要 OCR 的题目须重新准备，新快照覆盖该题原快照。原生文字题可直接分析。
- “禁止图片”优先于图片/手写选择；关闭 OCR 或 never 策略也禁止截图上传。image-only 仅识别无题干文字的媒体题，标题不能充当题干。auto 识别含允许媒体的题目；all 对纯文字整卡截图还需 images=always。
- 最终模型仍只接收文本。取消仅停止后续处理并丢弃结果，不能撤回已发给服务的请求。

## 受影响文件

`src/ai-input.ts`、`src/ai-subsystem.ts`、`web/src/main.jsx`、`web/src/lib/previewBridge.js`、`tests/ai-input-behavior.test.ts`、`tests/ai-subsystem.test.ts`、`package.json`、`docs/pages/settings.md`、本记录和 `RELEASE_NOTES_v2.4.1-b4.md`。

## 验证

- 新增行为测试执行实际 aiBridge、任务状态机、请求组装和持久化逻辑，仅 mock 原生网络、文件和卡片边界；覆盖策略矩阵、无上传文字分支、旧快照、原题/手写变化、设置变化、OCR 与模型迟到响应、整题预算及真实报告引用。
- 替换被本次新契约废弃的“必须仅读准备 OCR”等源码断言，保留无关既有测试。
- `pnpm test`：255/255 通过。类型检查及最终构建结果见下方交付记录。
- Playwright CLI + Edge 本地预览：920px 配置页可展开 GLM-OCR 共用策略并选择“不使用”；500px 发送范围可选择“禁止图片上传（含手写）”，无页面横向溢出；总览预检显示 3 候选、2 可用、1 需准备。截图在 `output/playwright/ai-policy-920.png` 和 `output/playwright/ai-privacy-500.png`。
- 预览控制台出现 favicon 404 和已有 `image` 图标 fallback 警告，未扩展修改图标系统。浏览器预览不代表原生或真实服务验证。
- 未做 MarginNote 真机验证，尚未确认实际桥接、跨学习集媒体同步、截图绘制及网络取消行为；网络取消目前是逻辑取消，未承诺停止远端计算。

## 交付记录

- 最终 `pnpm check`、`pnpm test`（255/255）、`pnpm build` 均通过；任务文件 diff/行尾空白检查通过。构建提示已有 `.sfIconGlyph:svg` 非法伪类警告，不影响本次构建完成，未扩展修改。
- 包内 `mnaddon.json` 核对：version `2.4.1-b4`、addonid `marginnote.extension.mn4-answer-matcher`、title `CardLink`；package.json 的 mnChannel 为 stable。
- 构建原件：`E:\project\MN\dist\CardLink-v2.4.1-b4.mnaddon`。
- 已复制：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1-b4.mnaddon`。
- 原件与复制件 SHA-256 一致：`D25A1025F7D8FC9F8929D0D641AEDD608C056E17762431D5C23E944F0AE7A5C9`。
- 临时浏览器与开发服务器已关闭；没有提交 Git 或发布 GitHub/Gitee。
