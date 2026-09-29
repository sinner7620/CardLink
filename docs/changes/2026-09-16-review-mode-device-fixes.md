# 复习模式真机修复与绑定开关恢复

## 目的

修复 2.4.2-b7 真机反馈：多题目脑图绑定开关不能关闭；复习工具条显示文字、反馈与首尾状态不明确；错题信息点击导致 MarginNote 闪退；跨脑图切题落入浮窗而非主脑图。

## IPS 结论

- 报告 `MarginNote 4-2026-09-15-230431.ips` 的事件号为 `5CC99F68-299C-437E-BEEB-82ECC26C6FB8`，异常是主线程 `SIGABRT`。
- `lastExceptionBacktrace` 明确经过 `-[UILabel initWithFrame:]`、`_UILabelLayer setBounds:`、JavaScriptCore Objective-C 构造回调和 UIButton 点击事件。
- 对应代码正是错题信息面板点击后先无参数创建 `UILabel`、再补 frame 的路径。现改为一次性传入经过有限数校验的完整 frame；不再保留无参数构造。

## 已实现行为

- 多题目脑图独立绑定重新成为可持久化开关，默认开启但允许关闭。关闭后恢复题目学习集级答案绑定；开启时按题目子脑图分别保存绑定。
- 复习工具条保持“序号数字、上一题、下一题、错题信息、退出”的顺序；后四项只显示图标，不再显示中文标题。
- 图标直接源自项目根目录 `SF-Symbols-7.0.4-SVG.zip`：`chevron.left`、`chevron.right`、`info.circle`、`rectangle.portrait.and.arrow.right`。通过本地 Playwright 渲染为 36×36 透明 PNG，构建时以内联 data URL 进入原生包，再由 `UIImage.imageWithDataScale` 生成 18pt 模板图像。
- 工具条尺寸、32pt 圆形控件、3pt 间距、胶囊圆角、描边、阴影、透明底色、强调态和中性悬停色与错题详情 `.detailActionBar` 规范对齐。触摸按下立即改变底色与透明度；宿主提供 `UIHoverGestureRecognizer` 时启用鼠标悬停底色，UIButton 同时开启原生 pointer interaction。
- 第一题的上一题按钮、最后一题的下一题按钮禁用并降至 28% 不透明度；切换过程中全部按钮暂时禁用，完成后按当前序号恢复状态。
- 队列内同一题目脑图继续调用 `notebookController.changeFocusToNote(target)`；目标学习集或根脑图变化时调用现有 `openSourceByMistakeId` 主脑图定位链，不调用浮窗聚焦接口。

## 影响文件

- `src/review-mode.ts`、`src/main.ts`、`src/plugin.ts`、`src/rails-core.ts`：复习工具条、事件、信息面板和跨脑图定位。
- `assets/review-symbols/*.png`、`build.mjs`、`src/globals.d.ts`：SF Symbols 原生图像资源和构建内联。
- `src/settings.ts`、`web/src/main.jsx`：绑定开关持久化和设置页交互。
- `tests/plugin-events.test.ts`：真机故障对应的结构契约。

## 兼容性与数据影响

- 关闭多脑图独立绑定不会删除已有 scoped 绑定；重新开启后原绑定仍在。关闭状态下新绑定写入学习集级键。
- 鼠标悬停背景依赖宿主导出 `UIHoverGestureRecognizer`；未导出时仍保留系统 pointer interaction 与触摸按压反馈。
- 跨脑图定位沿用现有官方主脑图聚焦及其同步状态提示，不使用答案浮窗接口。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，272/272；复习模式契约覆盖 PNG 内联、图标无标题、IPS 崩溃构造移除、按钮反馈/首尾灰态、同脑图与跨脑图定位分流，以及绑定开关持久化。
- `pnpm build`：通过，生成 `dist/CardLink-v2.4.2-b8.mnaddon`；存在既有 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json`：版本 `2.4.2-b8`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`。核心脚本包含 4 个内联 PNG、`imageWithDataScale`、hover selector、`changeFocusToNote` 与 `focusNoteInMindMapById`，不含 `focusNoteInFloatMindMapById`。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b8.mnaddon` 均为 589,555 bytes，SHA-256 均为 `8edc6210a95cc5793f4c5ce8e07f162d6346a3666ab6f7543aa674462e7d7545`。
- MarginNote 真机：IPS 根因已有证据，修复后的原生控件仍需在目标设备复测。

## 2.4.2-b9：复习模式图标加载修复

### 新日志结论

- b8 运行日志在 `startReviewMode` 开始后 4 ms 报错：`undefined is not an object (evaluating 'n.dataWithBase64EncodedStringOptions')`。
- b8 将 `NSData` 作为 `marginnote` npm 模块运行时导出值导入；类型包虽然导出了同名类型，但其构建后的模块没有导出原生类值。复习模式因此在首次创建按钮图标时中断，尚未进入题目聚焦代码。

### 修复行为

- 删除 SF Symbols PNG 的 data URL 内联和 Base64 解码，不再调用未在官方声明中的 `dataWithBase64EncodedStringOptions`。
- 构建时将 `assets/review-symbols/` 原样复制到插件包 `review-symbols/`。
- 图标优先通过官方 AddonLib/MNUtils 的 `MNUtil.getImage(path, 2)` 读取；MNUtils 不存在时，按该方法的官方实现使用 JSB 全局 `NSData.dataWithContentsOfFile(path)` 与 `UIImage.imageWithDataScale(data, 2)`。
- MNUtils 和原生读取路径分别隔离异常；图标失败只写日志，不再终止工具条创建或题目定位。
- 删除未进入官方 UIImage 声明的 `imageWithRenderingMode` 调用，复习模式图像路径仅依赖官方类型/API。

### 影响与兼容性

- 不改变队列数据、错题记录、绑定数据和切题规则。
- MNUtils 继续是可选依赖；存在时复用其 API，不存在时使用 MarginNote 官方 JSB 全局类。
- 插件包新增 `review-symbols/` 下四个 PNG 文件；不再把四张图编码进 `AnswerMatcherCore.js`。

### b9 验证与交付

- `pnpm check`：通过。
- `pnpm test`：通过，272/272。
- `pnpm build`：通过；存在既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内 `mnaddon.json`：版本 `2.4.2-b9`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`。
- 包内包含四个 `review-symbols/*.png`；复习模式产物片段确认按 `MNUtil.getImage` → 全局 `NSData.dataWithContentsOfFile`/`UIImage.imageWithDataScale` 的顺序加载，不包含原来的内联 Base64 解码分支，也不调用浮窗聚焦。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b9.mnaddon` 均为 589,659 bytes，SHA-256 均为 `01076cb5c3b1e947e243647a647df01e3cc8417fc64bebf06bd5b3fa09557a6a`。
- MarginNote 真机：b8 日志指向的确定性启动异常已从代码和产物中移除；b9 的原生工具条显示、点击和定位仍需在目标设备验收。

## 2.4.2-b10：Just Glass 材质与信息单行布局

### 实现边界

- 只读核对同级 `E:\project\just glass`：其真实光学效果由 WebView 内 WebGL 着色器与 SVG backdrop 采样自身场景实现，无法读取当前原生 `UIView` 下方的 MarginNote 脑图内容。
- 没有把 WebGL 画布或透明 WebView 伪装成宿主背景折射层，也没有使用 MarginNote 未公开的 `UIVisualEffectView`、`UIBlurEffect` 或 `UIGlassEffect`。
- 采用 Just Glass `static-shell` 的明确回退参数，以官方 JSB 可用的 `UIView`/`UIColor`/`CALayer` 属性实现静态玻璃材质：背景 `#f3f8ff` 74%、白色边框 72%、顶部高光 95%、底部 `#49688e` 内沿 9%，以及 `#1e3c63` 蓝灰投影。

### 错题信息

- 信息面板由一个四行 UILabel 改为四个有完整 frame 的单行 UILabel。
- 来源使用 `lineBreakMode = 4`（尾部省略）；即使路径很长，也不会占用等级、复测次数和上次结果的行位。

### SVG 结论

- MarginNote 官方 `UIImage` 与 AddonLib/MNUtils 的 `getImage` 路径不提供 SVG 解码接口。
- 保留官方 SF Symbols SVG 作为设计源文件；插件运行时继续加载构建生成的 2× PNG，避免引入 WebView 图标层或未公开原生解码器。

### b10 验证与交付

- `pnpm check`：通过。
- `pnpm test`：通过，272/272；覆盖 Just Glass 材质参数、错题信息固定单行与尾部省略、图标加载、工具条事件及定位分流。
- `pnpm build`：通过；存在既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内 `mnaddon.json`：版本 `2.4.2-b10`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；包含四个 `review-symbols/*.png`。
- 产物确认包含 `#f3f8ff`、`#49688e`、`#1e3c63`、`numberOfLines = 1` 和 `lineBreakMode = 4`，复习模式代码不调用 `focusNoteInFloatMindMapById`，也不引入 WebGL。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b10.mnaddon` 均为 589,767 bytes，SHA-256 均为 `2495E98F99E66075EDA6B9E2B1F09CD7BD8ECAF6F07E245AD56986C632D7A663`。
- MarginNote 真机：静态玻璃的最终透明度、投影、图标显示和长来源截断仍需在目标设备验收。

## 2.4.2-b11：复习工具条改为原生 SVG 绘制层

### 目的

- 解决 2× PNG 在 iPad 上出现明显毛边，以及四枚图标光学尺寸不一致的问题。
- 不再沿位图加载路径追加倍率或缩放补丁，而是完整替换图标渲染架构。

### 实现

- 从项目根目录 `SF-Symbols-7.0.4-SVG.zip` 取回 `chevron.left`、`chevron.right`、`info.circle`、`rectangle.portrait.and.arrow.right` 四个原始 SVG。
- 删除四个运行时 PNG，以及 `MNUtil.getImage`、`NSData.dataWithContentsOfFile`、`UIImage.imageWithDataScale`、缓存和位图降级逻辑。
- 在原生玻璃工具条内部增加一个 190×44 pt 的透明 `UIWebView`；构建时以 esbuild text loader 读取四个 SVG 并直接内联进 HTML，每枚图标统一为 18×18 pt 的矢量绘制框，不依赖运行时文件路径或 CSS mask。
- SVG 层关闭 `userInteractionEnabled`、滚动和无障碍元素，只负责绘制并置于原生按钮上方；下层 `UIButton` 仍独立负责点击、hover、按压、禁用及 accessibility label。
- 首题/末题禁用透明度与错题信息强调色通过同一绘制层状态函数同步。SVG 层不设置 delegate，也不建立新的 WebView bridge。

### 兼容性与数据影响

- 不改变复习队列、切题定位、错题记录和绑定数据。
- 使用 MarginNote 类型包公开的 `UIWebView` 与 `NSURL.fileURLWithPathIsDirectory`；不依赖 MNUtils，也不调用未公开 SVG 解码器。
- 保留 b10 的 Just Glass 静态玻璃材质和错题信息单行截断。

### b11 验证与交付

- `pnpm check`：通过。
- `pnpm test`：通过，272/272；覆盖 SVG 文件、统一尺寸、透明绘制层、原生按钮交互保留、首尾/详情状态同步，以及 PNG/UIImage 加载链完全移除。
- `pnpm build`：通过；存在既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内 `mnaddon.json`：版本 `2.4.2-b11`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`。
- 包内 `review-symbols/` 只有四个 SVG，PNG 数量为 0；产物包含 SVG 绘制状态函数，不包含 `MNUtil.getImage` 或 `UIImage.imageWithDataScale` 图标路径。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b11.mnaddon` 均为 591,164 bytes，SHA-256 均为 `32628E2FBCF973D3DCC30E070314C778AB0750FDED0FA243E0EB076593288EC2`。
- MarginNote 真机仍需确认 UIWebView 的最终抗锯齿、首次显示和鼠标悬停反馈。

## 2.4.2-b12：恢复 SVG 工具条的玻璃外观

### 真机现象与根因

- b11 真机截图显示四枚 SVG 已正确绘制，但整个 190×44 pt SVG 层仍是白色矩形，完全遮住下方原生 Just Glass 胶囊。
- b11 只设置了 `UIWebView.opaque = false` 和 WebView 背景透明；`UIWebView.scrollView` 仍保留 UIKit 默认白色背景，因此问题不在 SVG 或原生玻璃层。

### 修复

- 新增统一的 `configureReviewSvgSurface`，同时设置 WebView 与内部 ScrollView 的 `opaque = false` 和透明背景。
- SVG 绘制层使用与工具条一致的 22 pt 圆角并开启裁切，限制任何宿主装载背景只能出现在胶囊轮廓内。
- 首次创建和每次跨题重挂载均调用同一透明配置函数，避免两条路径漂移。
- 保留透明 WebView 只绘制 SVG、下层原生 UIButton 负责交互的分层结构；未加入 PNG 或位图降级。

### b12 验证与交付

- `pnpm check`：通过。
- `pnpm test`：通过，272/272；覆盖双层透明、圆角裁切、重挂载恢复与既有 SVG-only 契约。
- `pnpm build`：通过；存在既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内 `mnaddon.json`：版本 `2.4.2-b12`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`。
- 包内只有四个 `review-symbols/*.svg`，PNG 数量为 0；产物包含 ScrollView 透明和 SVG 层圆角裁切，不含复习图标位图加载链。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b12.mnaddon` 均为 591,205 bytes，SHA-256 均为 `578134841ACE445025EE176C96E1780EC787AE747F8F3553E1DD4F1FAD15FD0B`。
- MarginNote 真机仍需确认白色矩形消失且原生玻璃材质完整可见。

## 2.4.2-b13：五控件统一绘制与光学尺寸对齐

### 真机现象与根因

- 序号仍由下层原生 UIButton 标题绘制，而透明 SVG WebView 位于其上；MarginNote 的 WebView 合成层没有正确显示下层文字，导致数字消失。
- b12 对所有 SVG 强制设置 18×18 pt。SF Symbols 的 `viewBox` 宽高比不同，尤其退出图标较宽，在方框内按比例缩放后实际高度只有约 14.8 pt，因此与箭头、信息图标看起来大小不一。

### 修复

- 序号和四枚 SVG 全部进入同一个透明 HTML 绘制层；序号按钮清空原生标题，只保留 `第 N 题` accessibility label。
- 五个视觉槽位沿用原生按钮的 x/width，统一使用 32 pt 高度和 flex 垂直居中，消除原生文字与 WebView 图标的坐标系差异。
- 四枚图标统一为 18 pt 光学高度，宽度由原始 viewBox 比例确定：13.15、12.4、18.32、21.82 pt，不拉伸图形。
- 序号使用 15 pt、600 字重、等宽数字；`setReviewToolbarState` 同步序号、首尾禁用和信息强调态。

### b13 验证与交付

- `pnpm check`：通过。
- `pnpm test`：通过，272/272；覆盖序号首次绘制/状态更新、同层坐标系、等高 SVG 比例、空原生标题和既有原生交互。
- `pnpm build`：通过；存在既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内 `mnaddon.json`：版本 `2.4.2-b13`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`。
- 产物确认包含序号等宽字体与状态同步、13.15/12.4/18.32/21.82 pt 四个比例宽度、空原生按钮标题；包内四个 SVG、零个复习 PNG且无位图加载链。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b13.mnaddon` 均为 591,425 bytes，SHA-256 均为 `56A96C40D68AC068A1D59C79528A2AEE91488BCDE80B40E9B423A94A46B5F037`。
- MarginNote 真机仍需确认最终光学大小、字体基线及透明玻璃外观。

## 2.4.2-b14：Morphicons 官网图标与答案生成代理修复

### 五控件视觉结论

- 真机网格截图显示五个控件的槽位中心线基本一致，但视觉尺寸不一致：序号为 15 pt，明显小于图标；旧 SF Symbols 的 viewBox 比例不同，退出图标在 18×18 方框内等比缩放后高度不足。
- Morphicons 官网说明图标直接消费 Lucide/Tabler/Heroicons 等 IconNode 数据，且不同库共享 24×24 网格。本次选择项目已有依赖中的 Lucide `ChevronLeft`、`ChevronRight`、`Info`、`LogOut`。

### 图标实现

- 新增只接受受信任 IconNode 数据的 `lucideSvg` 序列化器，输出统一 `viewBox="0 0 24 24"`、20 pt 画布、2 pt stroke、round linecap/linejoin。
- 序号改为 18 pt/20 pt 行高、600 字重和等宽数字；五个视觉槽继续共享一个透明 WebView 坐标系。
- 删除旧四个 SF Symbols SVG、`.svg` text loader、构建资源复制和 TypeScript SVG 模块声明。没有静态/位图双轨，也没有 PNG 降级。
- 本次没有图形状态间的 morph，故不创建 Morphicons 引擎；项目内既有形变仍严格使用官方 `createMorph`。

### 答案生成根因与修复

- `findCurrentAnswer` 在弹窗前保存整个 `AnswerLookupContext`，其中含原生 `NodeNote`/`MbBookNote` JSB 代理。确认弹窗关闭卡片菜单并改变选择状态后，代理可能失效；后续 `cloneNotesToTopic([lookupQuestion.note], ...)` 因而被统一错误层映射为“所选卡片无效”。
- 上下文新增稳定 `lookupQuestionNoteId`。创建阶段调用 `MN.db.getNoteById` 重新读取原题，以来源学习集 ID 重新构造 `NodeNote`、父节点链和路径，并把新的 `MbBookNote` 传给 `cloneNotesToTopic`。
- 若原题确已删除，抛出已有 `sourceNoteUnavailable` 码，显示明确的“原题卡片不存在或尚未同步”，不再误报当前选择无效。

### b14 验证范围

- 类型检查和结构测试覆盖 Lucide IconNode、24×24/20 pt/2 pt 统一规格、18 pt 序号、旧资源链移除，以及答案创建按 noteId 重新取活对象。
- `pnpm check`：通过。
- `pnpm test`：通过，272/272。
- `pnpm build`：通过；存在既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内 `mnaddon.json`：版本 `2.4.2-b14`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；`package.json` 的 `mnChannel` 保持 `stable`。
- 包内共 17 个条目且不包含 `review-symbols/`；四枚工具条图标由打包后的 Lucide IconNode 数据直接生成。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b14.mnaddon` 均为 588,387 bytes，SHA-256 均为 `ECDBAEB1C5BEB4893848F47D2D38190EFD1DB15C4578DCCAA7D2840F82AF9FC0`。
- MarginNote 真机仍需确认最终视觉对齐，以及绑定答案脑图中的复制、父节点复用和编辑器打开行为。

## 2.4.2-b15：同名空卡强制定向到绑定答案脑图

### b14 真机反馈与根因修正

- b14 仍出现“所选卡片无效”，且新卡落入题目脑图。此前把问题归因于确认弹窗后的原题 JSB 代理失效，只修了源对象重取，没有修复同一学习集内多个脑图共享 notebook ID 的落点歧义。
- `cloneNotesToTopic(notes, topicid)` 的官方契约只保证克隆到指定笔记本；当题目脑图与答案脑图属于同一个学习集时，二者的 `topicid` 相同，该调用本身不能表达“答案子脑图”。随后通过候选扫描寻找答案根失败时，克隆卡会留在学习集根层。
- 旧实现直接对候选对象探测 `addChild`，异常的原始文本又可能命中通用 `noteId|卡片` 错误映射，从而显示与真实原因无关的“所选卡片无效”。

### 实现

- 删除生成流程中的 `cloneNotesToTopic` 和弹窗后原题读取。使用官方 `createNoteWithTitleTopicid(title, answerNotebookId)` 创建同名空答案卡。
- 对具体答案脑图绑定直接读取保存的 `rootNodeId`，不再依赖候选扫描能否返回答案根。
- 树关系优先走官方 AddonLib/MNUtils 的 `MNNote.addAsChildNote`；该封装先通过 `realGroupNoteForTopicId` 规范化父子卡，再调用宿主 `MbBookNote.addChild`。AddonLib 是可选依赖，因此缺失或未生效时对底层方法做能力探测后降级。
- 每次挂载后重新读取新卡并核对 `parentNote.noteId`；全部写入完成后再通过 `isInMindMap` 校验答案绑定范围。
- 若答案根不存在、宿主不支持挂载、父关系未生效或最终范围校验失败，抛出新的类型化错误并删除本次生成的答案卡/父卡，避免题目脑图或根层残留半成品。
- 父节点复用规则、不刷新索引和成功后打开编辑器的行为保持不变。

### API 依据与限制

- MarginNote 官方 `JSBMbModelTool` 文档将 `createNoteWithTitleTopicid` 定义为“在指定笔记本创建新笔记”；`cloneNotesToTopic` 只定义到笔记本层级，不能单独指定同学习集内的子脑图。
- 官方组织维护的 AddonLib 中，`MNNote.addAsChildNote` 调用 `addChild`，而 `addChild` 会先用 `realGroupNoteForTopicId` 规范化脑图卡片。CardLink 不强依赖 AddonLib，保留能力探测降级。
- 自动化不能模拟 MarginNote 的原生脑图数据库；最终父子关系仍需真机确认。

### b15 验证与交付

- `pnpm check`：通过。
- `pnpm test`：通过，272/272。
- `pnpm build`：通过；存在既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响插件包生成。
- 包内 `mnaddon.json`：版本 `2.4.2-b15`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；`package.json` 的 `mnChannel` 为 `stable`。
- 项目产物与 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b15.mnaddon` 均为 588,905 bytes，SHA-256 均为 `5C902354AF515C622C8B272A724A661FF93B563D25F14CEE6ED3952C3662C5D7`。
- MarginNote 真机仍需确认目标版本宿主的 `MNNote.addAsChildNote`/`MbBookNote.addChild` 能正确落入已绑定子脑图；失败路径会回滚本次新建项，不会保留在错误脑图。

## 2.4.2 正式版晋升

- 用户明确要求将当前 `2.4.2-b15` 更新为正式版本号 `2.4.2`。
- 仅晋升版本标识；功能内容保持 b15，正式渠道、插件 ID 和标题不变。
- 本次为已存在的 `2.4.2` 交付文件的明确同版本替换，最终构建校验与哈希记录在正式版发布说明中。
- `pnpm check`、`pnpm test`（272/272）和 `pnpm build` 均通过；构建仅有既有 `.sfIconGlyph:svg` CSS 选择器警告。
- 包内身份核对为版本 `2.4.2`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`，渠道 `stable`。
- 项目产物与同步目录交付副本均为 588,881 bytes，SHA-256 均为 `45579B5C3C8F90117988731BFB333BF26833A45C5B19543A945C7A864ACE4813`。
