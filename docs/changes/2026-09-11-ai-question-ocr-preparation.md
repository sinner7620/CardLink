# AI 错题题目 OCR 准备

## 变更目的

把大批量错题分析中的图片识别前移到显式的“题目准备”阶段。用户可以在 AI 配置页选择学习集，观察每道题实际发送的整卡图片和 OCR 结果；后续 AI 总结仅发送已落盘的文本，避免重复上传题图和分析时长时间停在内容读取阶段。

## 已实现行为

- AI 配置页新增“错题题目准备”工作区：
  - 选择指定学习集；
  - 按最近更新时间逐题处理该学习集内的错题；
  - 将完整原题 HTML 在隔离 iframe 中渲染，并使用 `html2canvas` 合成为单张 JPEG；
  - 右侧显示当前实际提交的题目卡片图片；
  - 显示单题阶段、单题进度、总进度、当前题号和 OCR 返回文本；
  - 完成后保留题目总数、成功数和失败数；
  - 单题读取、渲染或 OCR 失败会记为失败并自动继续下一题；任务可取消。
- 原生 AI 子系统新增逐题准备任务协议。图片提交后立即应答，MinerU 上传、轮询和结果下载在后台推进，网页以短轮询读取进度。
- `createMistakeContentReader` 新增跨学习集的轻量原题读取入口，只渲染原题，不触发答案索引和答案 HTML 生成。
- OCR 结果按错题 `recordId` 的 SHA-256 文件名独立保存为 JSON，目录为 `MNAnswerMatcher/ai/content/records/`。快照包含来源 ID、标题、整卡图片内容指纹、题目文本、原始 OCR 文本、服务/模型和处理时间。
- AI 总结改为读取本地准备文本；未准备题目以“题目尚未准备”进入不可用统计。只有启用“参考答案”时才按需读取实时答案。
- 缓存统计增加已准备题目数；清理操作同时删除 MinerU 图片结果缓存与已准备题目快照。
- 浏览器预览 mock 和桥协议显式路由同步覆盖新增命令。

## 影响文件与模块

- `src/ai-subsystem.ts`：题目准备任务、MinerU 逐题进度、内容快照存储、分析读取策略和缓存统计。
- `src/mistake-manager.ts`：跨学习集轻量原题读取。
- `src/rails-core.ts`：新增题目准备桥命令的显式路由。
- `web/src/main.jsx`：学习集选择、整卡渲染与提交、预览、进度和结果统计界面。
- `web/src/ui/settings.css`：题目准备双栏布局、图片预览、统计卡片与进度区域样式。
- `web/src/lib/previewBridge.js`：浏览器预览任务模拟。
- `tests/ai-subsystem.test.ts`：整卡 OCR、独立存储、分析禁用临时 OCR 和任务统计回归断言。
- `package.json`、`RELEASE_NOTES_v2.4.1b2.md`：版本与发布说明。

## 兼容与数据影响

- 版本升级为 `2.4.1b2`，构建仍使用正式渠道、正式插件 ID 和标题。
- 不修改 `mistakes.v2` 错题主库结构；新增题目文本为可清理、可重新生成的文件型派生数据。
- 已有 AI 报告无需迁移。生成新报告前，需要先为目标科目对应学习集完成题目准备；未准备题目不会回退为临时图片 OCR。
- 重新准备同一道题会覆盖该题旧快照，并以最新整卡图片内容指纹记录来源。

## 验证

- `pnpm check`：通过。
- 定向测试 `tests/ai-subsystem.test.ts`、`tests/bridge-schema.test.ts`、`tests/web-render-smoke.test.ts`：通过，48/48。
- `pnpm test`：通过，222/222。
- `pnpm build`：通过；保留既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响产物生成。
- 构建产物：`E:\project\MN\dist\CardLink-v2.4.1b2.mnaddon`，523,678 字节。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b2.mnaddon`，523,678 字节。
- 两份文件 SHA-256 一致：`F57FBB62731E0AC300151278C70C392B38465EBBF6214073F4142D95DA142758`。
- 包内 `mnaddon.json` 已核对：正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b2`。

## 未验证限制

- 当前环境无法替代 MarginNote 4 真机和真实 MinerU Token，尚未验证真实网络请求、服务端 OCR 质量及大量复杂卡片的连续运行稳定性。
- 整卡截图需要在 WebView 内创建画布；极端超长卡片、异常大图或跨域资源可能受画布尺寸、内存与加载超时限制。
