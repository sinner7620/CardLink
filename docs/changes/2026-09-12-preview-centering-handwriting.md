# 预览居中与绑定手写显示

## 目的与实现

- `src/card-preview.ts`：修复缩小后贴左上角；有剩余空间的轴居中，长内容保留顶部起始和滚动，手势锚点计入偏移。预览文档双击或双轻点切换绑定手写，拖动、缩放和合成鼠标事件不重复触发，卸载清理事件。
- `src/card-html.ts`：摘录图片也读取配对 drawing，与 PaintNote、LinkNote 复用叠加渲染。
- `src/pkdrawing-renderer.ts`：叠加画布使用底图固有尺寸，不再按笔迹边界扩展后拉伸，避免笔迹坐标和图片错位。
- `src/bound-handwriting.ts`：从 AI 模块提取现有绑定手写读取与 HTML 追加能力。交互预览初始隐藏，双击展示；无绑定、接口不支持或不可读时展示对应状态。
- `src/mistake-manager.ts`：错题详情与待复习原题调用交互追加路径；AI 只读内容读取器不加入这些附件。
- `src/ai-subsystem.ts`：复用提取后的模块，保留原有 OCR 开关和默认不上传绑定手写的行为。
- `web/src/CardPreview.jsx`：为支持手写切换的 iframe 补充无障碍操作说明。
- 测试覆盖预览几何、触摸判定、叠加坐标、摘录图层、绑定读取状态及 AI 边界；已有静态断言随模块拆分调整，移除冻结错误画布尺寸公式的断言。

## 兼容与限制

无存储迁移，不修改 MarginNote 原始笔迹、绑定或卡片。仅本地题目预览追加绑定手写；AI OCR 仍由既有隐私开关控制。绑定手写在独立区域展开，不推测其相对卡片的脑图坐标。图片叠加仅用于明确配对的 paint/drawing；无底图笔迹仍独立显示，无法推断无关联评论间的图层关系。

尚无用户真机原始媒体可复核坐标。真实 PencilKit 数据解码、图片上笔迹是否具有额外宿主坐标变换，以及不同绑定方式仍需 MarginNote 真机验收，不能用合成数据验证替代。

## 验证

- `pnpm check` 通过；`pnpm test` 243/243 通过。
- 最后补充 iframe 操作说明后，11 项 Web 渲染冒烟测试再次通过。Vite Web 生产构建及 Safari 13 目标的原生核心 esbuild 构建通过，验证产物仅写入 output，不覆盖已交付 dist 包；保留既有 `.sfIconGlyph:svg` CSS 警告。
- 内置浏览器、本地 Vite 合成数据验证：600×700 预览缩至60%后卡片为360×420，偏移120×140，双轴居中；底图和叠加层位置及尺寸完全一致。放大到150%后两层仍一致（834×417）。
- 双击题目标题后显示绑定手写，隐藏状态由 true 变 false；触摸双击、拖动排除、合成事件去重及销毁由行为测试覆盖。
- 使用合成解码笔迹检查视觉叠加；没有宣称真实 MarginNote 媒体已验收。临时浏览器夹具已清理。
- 标题同步另见 [标题同步记录](2026-09-12-mistake-title-sync.md)。未升级版本、替换 b1 安装包或远端发布。

## 后续授权交付 2.4.1-b2

用户要求生成 b2，已将 package 版本更新为 `2.4.1-b2` 并新增 `RELEASE_NOTES_v2.4.1-b2.md`。最终输入的 `pnpm check`、`pnpm test`（243/243）和 `pnpm build` 均通过，既有 CSS 警告仍存在。已读取包内 manifest，确认版本、正式插件 ID 和标题，渠道保持 stable。

- 原包：`E:\project\MN\dist\CardLink-v2.4.1-b2.mnaddon`。
- 交付：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1-b2.mnaddon`，577,849 bytes。
- 两份文件 SHA-256 一致：`CE0856DED4C41CBFA12348028FB1A820BD285FB3A3E13B491388AFD9C2369021`。
- 本次包含标题同步与预览手写修改，保留历史 b1 交付文件。尚未进行 MarginNote 真机验收；未远端发布。

## b2 真机截图反馈：绑定手写原位叠加仍未完成

用户随后提供的图二确认：原卡片上的圈画与公式属于当前“脑图绑定手写”独立展示路径，b2 仍把它显示在卡片下方。此前配对 paint/drawing 叠加修复没有覆盖该场景，不能声称已解决用户这张卡片的原位叠加。

现有 PKDrawing 独立渲染会按笔迹边界裁去空白并平移到新画布；HTML 卡片标题和图片也经过重新排版。仅修改 top/left 或将独立 canvas 绝对定位到卡片上，无法证明与原脑图坐标一致。

核对了 [MindMapNode.frame](https://mn-docs.museday.top/reference/marginnote/mindmap-node/) 和 [草稿读取接口](https://mn-docs.museday.top/reference/marginnote/mb-model-tool/)，以及本地 SDK 的图片 size/selLst 信息；[getDrawingSize](https://mn-docs.museday.top/reference/marginnote/mb-book-note/) 返回的是媒体字节数，不是画布尺寸，不能用来推导坐标。现有资料和两张图片不能确定实际草稿坐标、卡片边界及额外变换。

本轮未用猜测坐标修改笔迹渲染。待用户提供仅含该卡片与绑定手写的学习集导出样例后，核对原始媒体及布局数据，再决定能否按原坐标合成；此问题仍未修复。报错布局另见 [错误浮层修复](2026-09-12-error-overlay.md)。

## 导出样本核查（2026-09-12）

用户提供 `多元微分不带答案(2026-09-12-17-04-40).marginpkg` 后，只读打开归档，将其中的 SQLite 学习集副本提取到忽略目录 `output/handwriting-sample/`。未修改原始导出包，未把用户媒体加入源码或测试夹具。

- 已通过父节点关系确认目标位于「多元微分 → 多元微分应用 → 单调性」，题名为「2012数二; 880第四章综合选择5; 26版660数一二三第228题」。
- 目标卡片 `CB56C7A2-4267-47F0-BBB6-02FEE7261AAE` 的 `ZMINDPOS` 为 `(12532.531250, 983.279114)`。绑定草稿通过 `ZGROUPNOTEID` 指向该卡片，保存相同原点。
- 草稿评论是 `SketchNote / PKDrawing`，携带全局矩形 `{{12595, 1286}, {746, 426}}`。使用项目现有解码器成功读取 45 条笔画；点坐标亦在脑图全局范围内。原题图片为 1120×255 PNG，其摘录和评论没有配对 drawing，因此 b2 的配对图片叠加路径不会处理这些笔画。
- 现有 `sketchMediaHashes` 只提取媒体 hash，丢失评论的 rect；独立画布再按笔迹边界平移。这解释了笔迹被单独排到下方、原位置关系丢失。
- 样本共 384 条类型 4 记录，378 条可通过绑定 ID 找到卡片，361 条具有与卡片一致的非空原点；161 条绑定记录包含多个 drawing。该统计仅核对元数据关系，不代表所有媒体均已解码，也不证明运行时所有坐标都遵循同一变换。不能为该题硬编码偏移，亦不能分别裁剪多个 drawing 后期待它们保持相对位置。

### 尚缺的布局信息与下一步边界

减去卡片原点可得到脑图内的相对位置，但 HTML 预览重新排版了标题、图片和标签。导出数据中的摘录 `selLst.rect` 是 PDF 页区域，`imgRect` 是图片像素区域；均不能当作图片在脑图卡片内部的位置。所检查的目标卡片与学习集字段未提供可直接复原该内部布局的矩形。

官方 [MindMapNode 头文件](https://github.com/marginnoteapp/Addon/blob/master/API/JSBMindMapNode.h) 暴露节点 frame；[UIView 头文件](https://github.com/marginnoteapp/Addon/blob/master/API/UIKit/JSBUIView.h) 暴露子视图和坐标转换。但当前没有 MarginNote 真机来核对卡片内容视图结构、图片实际 frame 及其与草稿坐标的关系。SDK 的 `DocumentController.imageFromFocusNote` 属于文档控制器，不能未经验证当成脑图整卡截图接口。后续需要取得运行时卡片与图片布局数据，或验证可用的整卡原生渲染路径，再实施通用叠加。

本轮完成样本定位、数据库/归档解析和目标笔迹解码，未修改生产渲染代码、升级版本或生成新安装包。原位叠加仍未完成；没有真机验收。只读分析及记录更新不运行应用测试或构建。
