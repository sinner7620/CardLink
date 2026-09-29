# 复习模式跨学习集焦点模式修复

## 目的

修复复习模式切换到其他学习集的题目后只完成卡片定位和高亮、没有把目标题目卡片设为脑图焦点根节点的问题。

## 已实现行为

- 复习模式在跨学习集或跨脑图定位时显式请求进入焦点模式。
- 焦点模式意图写入跨学习集 pending 记录；无论前台等待期间完成切换，还是稍后由 `notebookWillOpen` 接力，都会在目标学习集当前的 `notebookController` 上调用 `changeFocusToNote`。
- 同一脑图内的快速切题继续直接调用当前 controller 的 `changeFocusToNote`，不经过跨学习集定位状态机。
- 目标卡片已定位但宿主缺少焦点模式接口或调用失败时，向用户显示独立失败提示，不再把内部复习状态误记为已进入目标焦点模式。
- 跨学习集完成后重新读取目标卡片用于复习状态，不保留切换前的卡片对象作为当前焦点引用。
- 同脑图快速切题和跨学习集接力统一采用“进入焦点模式 → 等待 80ms 布局 → 官方定位居中”的顺序，避免 `changeFocusToNote` 重建画布后覆盖此前的滚动位置。
- 焦点模式重建后再次检查目标卡片的真实焦点状态；未落地时不更新复习模式的内部焦点记录。
- 真机反馈表明进入焦点模式会清空普通卡片选中态，不能用 `focusNote`、`visibleFocusNote` 或选中项验证焦点根节点；移除该错误判据，改为原生切焦与布局后定位调用均不抛错即视为已派发成功。

## 影响文件

- `src/note-navigation.ts`：定位请求与 pending 增加 `enterFocusMode` 意图，并在目标学习集聚焦完成后进入卡片焦点模式。
- `src/mistake-manager.ts`：原题定位入口透传焦点模式选项。
- `src/review-mode.ts`：跨学习集/跨脑图切题请求焦点模式，并避免复用切换前的 controller。
- `tests/plugin-events.test.ts`：增加焦点模式意图持久化及 `notebookWillOpen` 接力的结构契约。

## 兼容性与数据影响

- 普通错题列表“定位原题”不传该选项，行为保持为定位和高亮，不会自动隐藏其他卡片。
- 旧 pending 记录没有 `enterFocusMode` 字段时按 `false` 处理。
- 没有修改错题记录、绑定数据或产品版本。

## 验证

- `pnpm check`：通过。
- `pnpm exec tsx --experimental-test-module-mocks --test tests/plugin-events.test.ts tests/mistake-performance.test.ts`：通过，38/38；修复完成后的相关范围验证。
- 交付版本最终输入重新执行 `pnpm check`、`pnpm test`（276/276）和 `pnpm build`：全部通过；构建仅报告既有 `.sfIconGlyph:svg` CSS 选择器警告。
- `git diff --check`：通过；仅有工作区既有 LF/CRLF 提示。
- 包内身份：版本 `2.4.3-b4`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`，渠道 `stable`。
- 安装包 `dist/CardLink-v2.4.3-b4.mnaddon` 与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3-b4.mnaddon` 均为 590,150 bytes，SHA-256 均为 `897D45EA97ED73041ADD4652381EF34C0E59FDEE99A996D1C91358C4B8C2DECB`。
- 居中顺序修复后的 `2.4.3-b5` 最终输入重新执行 `pnpm check`、`pnpm test`（276/276）和 `pnpm build`：全部通过；首次全量测试发现日志导出结构契约与新增 50ms 固定等待冲突，改为独立 60ms 落地检查后重新全量验证通过。
- `2.4.3-b5` 包内身份：ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`，渠道 `stable`。
- 安装包 `dist/CardLink-v2.4.3-b5.mnaddon` 与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3-b5.mnaddon` 均为 590,274 bytes，SHA-256 均为 `3185BCC4907FF4F5C6EF1121749D9235C94D2939CA92E7D488302276D697097F`。
- 焦点模式普通选中态误判修复后的 `2.4.3-b6` 最终输入执行 `pnpm check`、`pnpm test`（276/276）和 `pnpm build`：全部通过；构建仍只有既有 `.sfIconGlyph:svg` CSS 选择器警告。
- `2.4.3-b6` 包内身份：ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`，渠道 `stable`。
- 安装包 `dist/CardLink-v2.4.3-b6.mnaddon` 与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3-b6.mnaddon` 均为 590,243 bytes，SHA-256 均为 `B34C0A2CFEFBAC220E18A1388470931F6548A5CAE4219CDC4959C24FB5BC28C3`。
- MarginNote 真机跨学习集焦点模式尚待验证。

## 未验证限制

- 自动化环境不能确认 MarginNote 原生 `changeFocusToNote` 在目标设备上的最终视图表现；需分别验证快速切换完成和 `notebookWillOpen` 延迟接力两条路径。
