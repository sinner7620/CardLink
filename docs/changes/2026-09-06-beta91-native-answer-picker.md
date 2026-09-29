# beta.91 候选条恢复 beta.61 原生答案选择器

## 变更目的

按用户要求，答案窗口候选条不再展开自绘下拉框，改回 beta.61 已验证过的 MarginNote 原生多答案选择弹窗。

## 参考版本核对

从用户提供的 `mn4-answer-matcher-v2.3.3-beta.61.mnaddon` 解包检查 `AnswerMatcherCore.js`，确认旧实现使用 `select(options, title, message, true)`；选项由序号、倒序路径、标题、标准答案标记和答案摘要组成。本轮按该结构迁回当前源码，而非模拟新的弹层样式。

## 已实现行为

1. 候选长条触发 `onChooseAnswerCandidate:`，该事件已注册到 Rails Core 与旧插件入口。
2. 事件从当前窗口保存的去重候选清单生成 beta.61 同款选项，并调用 MarginNote 原生 `select`。
3. 选择有效索引后原位重新渲染答案窗口，窗口位置与完整候选清单保持；取消弹窗不改变当前答案。
4. `answerCandidatesDropdown`、`answerCardCandidateButtons`、`onAnswerCandidateTap` 与 `onToggleAnswerCandidates` 整套自绘下拉实现已删除。
5. beta.90 的候选条 26pt 中线对齐与高置信结果不显示候选入口继续生效。

## 影响文件或模块

- `src/answer-card-view.ts`：候选按钮改接原生选择事件，删除自绘下拉视图和候选行。
- `src/plugin.ts`：恢复 beta.61 的原生答案选择流程。
- `src/rails-core.ts`、`src/main.ts`：注册新的候选选择事件并移除旧下拉事件。
- `tests/plugin-events.test.ts`：验证原生选择结构及旧下拉彻底退役。
- `package.json`：版本迭代到 `2.3.3-beta.91`。
- `RELEASE_NOTES_v2.3.3-beta.91.md`：本轮发布说明。

## 兼容性与数据影响

存储键、绑定格式、索引格式和桥接命令均不变。交互从窗口内下拉改回系统原生选择弹窗；候选判定与数量口径不变。

## 验证

- `pnpm check`：通过。
- `pnpm test`：180/180 通过。
- `pnpm build`：通过。构建仍报告既有 `.sfIconGlyph:svg` CSS 警告，本轮未涉及该设置页样式，产物正常生成。
- 构建产物：`E:\project\MN\dist\mn4-answer-matcher-v2.3.3-beta.91.mnaddon`，498938 字节。
- 交付副本：`E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.91.mnaddon`。
- 两者 SHA-256：`D106D3BB75D48DC71F3426799B17241A0A96D1EE046043ADFE96C11CE1CB7D3C`，一致。
- 包内核对：包含 `onChooseAnswerCandidate`；不再包含 `answerCandidatesDropdown` 或 `onAnswerCandidateTap`。

## 未验证限制

桌面环境无法呈现 MarginNote 原生 `select`；弹窗行高、长文本折行和选择后切换仍需 iPad 真机确认。
