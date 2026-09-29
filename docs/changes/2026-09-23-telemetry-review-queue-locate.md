# 上报地址、今日队列与原题定位方式

## 目的与行为

- 移除 `cardlink.cn.eu.org` 上报入口；匿名统计和调试联通测试只尝试主端点及 workers.dev 备用端点。
- 从逾期池补入今日队列的记录 ID 按本机日期保存在原生数据层。刷新后保留，次日自动清空；复测完成时从补入队列移除。初版 Web 本地存储实现有分页刷新缺陷，见下方后续修复。
- 设置页新增“定位原题方式”：默认“仅定位”；选择“定位并聚焦”后，普通错题定位进入与复习模式相同的脑图焦点定位流程。原生复习模式继续显式请求焦点模式。
- 后续 UI 调整：该设置恢复为与其他设置相同的点击行，显示当前值；点击后使用 MarginNote 原生选择弹窗，取消不修改设置。
- 后续图标调整：“定位当前错题原题”保留图钉，“定位原题方式”使用独立的 SF Symbols 准星图标，避免相邻设置项重复。

## 影响文件与数据

- 遥测：`src/telemetry.ts`、`tests/telemetry.test.ts`。
- 定位设置和桥接：`src/settings.ts`、`src/plugin.ts`、`src/rails-core.ts`、`src/mistake-manager.ts`、`web/src/main.jsx`、`web/src/lib/previewBridge.js`、`web/src/ui/settings.css`、`web/src/sf.jsx`、`web/src/sf/focusMode.svg`、`tests/plugin-events.test.ts`。
- 今日队列：`src/manual-review-queue.ts`、`tests/manual-review-queue.test.ts`、`tests/web-bridge.test.ts`、`tests/web-render-smoke.test.ts`、`package.json`（纳入常规测试）。
- 文档：`docs/modules/src/telemetry.md`、`docs/pages/review.md`、`docs/pages/settings.md`。

已有错题与复习日期不变；新设置使用现有设置存储，旧配置默认“仅定位”。今日补入队列只在原生数据层存记录 ID，不存题目内容。

## 验证与限制

- `pnpm check`：通过。
- 相关遥测、定位、错题队列测试：45/45 通过；桥接与 Web 渲染测试：44/44 通过。
- `pnpm test`：277/277 通过。
- 功能开发阶段的 `pnpm build`：通过；仍有既有 `.sfIconGlyph:svg` CSS 选择器警告。
- Playwright 本地预览：设置项及两个选项可见；从逾期池补入 1 题后，左上角刷新与整个 Web 页面重载均保留该题，今日队列显示 2 题。
- 原生选择器 UI 调整后：`pnpm check`、相关桥接/事件/Web 渲染测试（46/46）、`pnpm build` 均通过；本地预览截图确认设置行与相邻设置项对齐，显示当前模式及右侧箭头，不再内嵌下拉框。预览 mock 只能模拟选项切换，MarginNote 原生弹窗仍待设备验证。
- 准星图标调整后：相关 Web/事件测试 69/69 通过，`pnpm build` 通过；Playwright 本地预览截图确认两个相邻设置项分别显示图钉与准星，图标大小、底色和行对齐一致。
- `git diff --check`：通过；仅有工作区既有的 LF/CRLF 转换提示。源码和当前功能文档中已无被删除的上报域名及“三通道”文案。
- MarginNote 真机焦点呈现、跨学习集定位及设备 WebView 的本地存储保留尚未验证。
- `2.4.3-b7` 交付：最终输入的 `pnpm check`、`pnpm test`（278/278）和 `pnpm build` 均通过；构建仅有既有 `.sfIconGlyph:svg` 警告。包内 `mnaddon.json` 确认为版本 `2.4.3-b7`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；`package.json` 构建渠道为 `stable`，ZIP 成员完整性检查通过。
- 安装包 `dist/CardLink-v2.4.3-b7.mnaddon` 已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3-b7.mnaddon`；源包和副本均为 591,502 bytes，SHA-256 均为 `DD3715727A0E96D126B5723111D53DFD443A9A8B84AF70F245B822EF9D626128`。未进行 GitHub/Gitee 发布。

## 后续修复：大量错题刷新后补题消失

设备反馈表明 b7 在大量错题场景下仍会丢失补入队列。根因是原生 dashboard 先返回前 25 条，Web `DueReviewList` 的清理 effect 却把不在该批记录中的补入 ID 当成失效，并通过另一个 effect 把删减结果写回 `localStorage`。先前只有 5 条错题的本地预览无法复现。

本次将手动补题队列的状态所有权移至原生错题数据层：原生从完整错题库选取逾期记录并持久化 ID，dashboard 返回队列 ID；分页只传错题展示数据，不负责校验或修改队列。复测成功后由原生层移除该 ID；读取过程不写存储。Web 侧删除原有 `localStorage` 队列助手及基于分页记录的清理 effect。旧版 Web 本地存储中的补题 ID 不迁移到新队列；已有错题与复习计划数据不变。

影响文件：`src/manual-review-queue.ts`、`src/mistake-manager.ts`、`src/rails-core.ts`、`web/src/main.jsx`、`web/src/lib/previewBridge.js`、`tests/manual-review-queue.test.ts`、`tests/web-bridge.test.ts`、`tests/mistake-performance.test.ts`、`docs/pages/review.md`、`package.json`；删除旧 `web/src/lib/manualTodayQueue.js` 和 `tests/manual-today-queue.test.js`。

验证：超过首页 25 题的行为测试覆盖原生完整错题库选题、刷新只读不清队列、复测移除、次日失效；相关测试及最终全量 `pnpm test` 均通过（279/279），`pnpm check` 与 `pnpm build` 通过。MarginNote 真机刷新后的最终显示仍需设备验收。

`2.4.3-b8` 安装包内版本 `2.4.3-b8`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`，渠道 `stable`；ZIP 完整性检查通过，产物包含原生队列存储键且不包含旧 Web 队列键。`dist/CardLink-v2.4.3-b8.mnaddon` 已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3-b8.mnaddon`；两份均为 591,993 bytes，SHA-256 均为 `C90B7D4758FF4A32A4E50B9FD5B782794BAE3E29C8253A053758EEF22623B512`。未进行 GitHub/Gitee 发布。

## 正式版 2.4.3 交付

用户明确确认覆盖 2026-09-16 已交付的同版本安装包（旧 SHA-256 `002814FFBFC7F32FC5FF171B172F83EE616AC83E2288A65BFBAFD23D3989756E`）。将当前修复版提升为正式版 `2.4.3`，保留 `mnChannel: "stable"`、插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`。

最终输入的 `pnpm check`、`pnpm test`（279/279）和 `pnpm build` 均通过；构建仅报告既有 `.sfIconGlyph:svg` CSS 选择器警告。ZIP 完整性检查通过，包内版本与身份正确，原生队列存储键存在，旧 Web 队列存储键不存在。

`dist/CardLink-v2.4.3.mnaddon` 与已替换的 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.3.mnaddon` 均为 591,980 bytes，SHA-256 均为 `DBC8A1FFE004A3067E17A6FFFFADEF3223CCF0925003CCDEA165F3A7C43FBAAB`。MarginNote 真机刷新、原生选择弹窗及跨学习集焦点呈现尚待设备验收。

## 正式版 2.4.3 发布

- 发布提交 `18b6603a1b288dd294ae515679acaeaac239607b`，Git 标签 `v2.4.3`；仅提交本次发布涉及的源码、测试、功能文档和更新说明。
- GitHub Release：`https://github.com/sinner7620/CardLink/releases/tag/v2.4.3`；Gitee Release：`https://gitee.com/baidreams/CardLink/releases/tag/v2.4.3`。两边的更新说明与 `RELEASE_NOTES_v2.4.3.md` 一致。
- GitHub Actions 发布运行 `https://github.com/sinner7620/CardLink/actions/runs/35829282832` 成功，`check`、279 项测试、`build`、GitHub 发布及 Gitee 同步步骤均通过。
- GitHub 附件与重新下载的 Gitee 附件均为 591,980 bytes，SHA-256 均为 `DBC8A1FFE004A3067E17A6FFFFADEF3223CCF0925003CCDEA165F3A7C43FBAAB`，与本地安装包及同步目录副本一致。
- 按用户反馈，发布说明仅保留指定的三条更新内容，删除自行添加的标题、兼容性及限制文字。已分别更新 GitHub 与 Gitee Release 正文，并从公开 API 读取后逐字比对本地 `RELEASE_NOTES_v2.4.3.md`；两边一致，安装包附件保留。
