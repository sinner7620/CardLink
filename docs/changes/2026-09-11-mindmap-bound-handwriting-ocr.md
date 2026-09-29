# OCR 题目准备加入脑图绑定手写

## 变更目的

让错题 OCR 题目准备能够读取并包含 MarginNote 脑图画布上绑定到原题卡片的手写内容，使公式推演、草稿和补充批注可随整张题目卡片一并识别。

## API 依据

- MarginNote 官方 `JSBMbModelTool` 头文件开放 `getSketchNoteForMindMap:focusNoteId:`，JavaScript 方法名为 `getSketchNoteForMindMapFocusNoteId(topicId, focusNoteId)`。
- 官方同时开放 `getSketchNotesForMindMap(topicId)`、`MbBookNote.mediaList`、`getDrawingSize()`、`getStrokesCount()` 与 `getMediaByHash(hash)`。
- 当前 `marginnote` npm 类型声明尚未包含按焦点卡片读取的单数方法，因此实现采用运行时能力探测，不伪造静态类型。

## 已实现行为

- AI 隐私/发送内容配置新增 `mindMapHandwriting`，默认 `false`，并在设置页显示为独立的“脑图绑定手写”开关。
- 创建题目准备任务时固定该开关；后续每题渲染使用任务快照，不读取可能已被用户中途修改的当前配置。
- 对每道错题使用 `sourceNotebookId + sourceNoteId` 查询绑定脑图草稿。
- 从草稿自身、摘录图片、评论、合并评论及 `mediaList` 防御式收集媒体哈希，并通过 `MN.db.getMediaByHash()` 读取数据。
- 按文件头识别 PNG/JPEG/GIF/WebP；非栅格媒体按 PencilKit/PKDrawing 笔迹处理。
- 若同时存在原始笔迹与栅格回退，只保留原始笔迹，避免把同一手写重复加入 OCR 图片。
- 原始笔迹以内联 `canvas[data-drawing]` 追加到题目 HTML，由项目既有 PKDrawing 解码器渲染；栅格回退以内联图片追加。
- Web 端仍使用同一个 iframe 与 `html2canvas` 生成最终整卡 JPG，因此右侧上传预览与 OCR 实际收到的内容一致。
- 单题进度显示包含数量或无手写、API 不支持、媒体不可读等状态；读取手写失败不会使题目本身 OCR 失败。

## 影响文件与模块

- `src/ai-subsystem.ts`：设置归一化、任务快照、官方手写查询、媒体读取分类、题目 HTML 合成与状态回传。
- `web/src/main.jsx`：独立开关、准备流程说明及单题绑定手写状态。
- `web/src/lib/previewBridge.js`：预览配置同步。
- `tests/ai-subsystem.test.ts`：官方接口、媒体读取、PKDrawing 合成、任务快照和界面回归断言。
- `package.json`、`RELEASE_NOTES_v2.4.1b5.md`：版本和发布说明。

## 兼容与数据影响

- 版本升级为 `2.4.1b5`，`mnChannel` 保持 `stable`，正式插件 ID 和标题不变。
- 旧设置没有 `mindMapHandwriting` 时归一化为关闭，不会改变既有上传范围。
- 不修改 MarginNote 原始笔迹、绑定关系或错题记录；功能仅只读媒体并合成临时 OCR 图片。
- OCR 结果仍按既有结构保存在本地题目文本快照中，后续 AI 总结只发送快照文字。

## 验证

- `pnpm check`：通过。
- 定向测试 `tests/ai-subsystem.test.ts`、`tests/bridge-schema.test.ts`、`tests/web-render-smoke.test.ts`：通过，51/51。
- `pnpm test`：通过，225/225。
- `pnpm build`：通过；保留现有 `.sfIconGlyph:svg` 非法伪类警告，不影响产物生成。
- 正式构建产物 `dist/CardLink-v2.4.1b5.mnaddon`：572,791 字节。
- 已复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b5.mnaddon`；源文件和交付副本 SHA-256 均为 `B4E47AA8F6A671D007C8F24FB9DB8F248058FCE65B7432123B7F0A282006D3D6`。
- 包内 `mnaddon.json` 已确认正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b5`。

## 未验证限制

- 当前环境无法取得用户真实 MarginNote 数据库中的绑定草稿；自动绑定、焦点绑定、手动绑定及隐藏笔迹的实际媒体字段仍需真机验证。
- 如果未来 MarginNote 修改未纳入稳定类型声明的单数接口名称，界面会明确显示“不支持读取”，原题 OCR 仍继续执行。
