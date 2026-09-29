# 悬浮球快捷功能区首阶段

## 目的

把全局悬浮球的点击入口改为快捷功能区，提供清晰的三项功能入口与打开、关闭动效。

## 实现

- `src/mnutils-entrance.ts`：点击悬浮球展开/收起原生快捷区，展示「打开插件页面」「绑定卡片颜色」「开始刷题」。打开插件页面沿用现有面板生命周期；后两项在对应功能尚未接入时禁用并说明状态。
- 快捷区使用 `UI_COLORS` 主强调色和浅色面板、44 点以上操作行；按悬浮球停靠位置向屏幕内部展开，并限制在窗口边界内。轻微位移与透明度通过 MN Utils 的 `MNUtil.animate` 执行，系统减少动态效果时直接切换。
- 点击区外、再次点击悬浮球、开始拖动、长按、关闭学习集和场景断开均会收起或移除快捷区。现有悬浮球停靠位置持久化及长按复位保留。
- `src/main.ts`、`src/rails-core.ts`、`src/plugin.ts` 注册新动作；`src/globals.d.ts` 补齐 MN Utils 动画时长签名。更新受影响的行为测试与旧静态断言。
- 更新 `docs/pages/toolbar.md` 的入口契约与同脑图方案阶段状态。本轮没有改变颜色、绑定、匹配或刷题数据。

## 参考依据

- MarginNote 官方 [Addon API](https://github.com/marginnoteapp/Addon) 与 [AddonLib `mnutils.js`](https://github.com/marginnoteapp/AddonLib/blob/main/mnutils.js)：复用 `MNButton` 的现有入口手势和 `MNUtil.animate(func, time)`。
- 仓库 `docs/design/interaction.md`、`src/ui-tokens.ts`。历史 beta.64–69 的原生菜单反馈仅用于识别已出现的生命周期问题；未恢复其多项设置逻辑。

## 验证与限制

- `pnpm check` 通过；`tests/card-preview.test.ts` 与 `tests/plugin-events.test.ts` 共 40 项通过；`git diff --check` 通过。
- MarginNote 设备检查：本轮未连接设备；原生视图层级、手势和旋转后的真实表现尚待真机验收。
- 本轮按用户后续要求交付 `2.4.4-b1` 安装包；最终检查、包身份、交付位置与哈希见下方。

## 安装包交付

- 版本：`2.4.4-b1`，正式插件渠道 `stable`。
- `pnpm check`、`pnpm test`（279 项通过）、`pnpm build` 均通过；本轮没有新增测试。构建报告已有 Web CSS 选择器 `.sfIconGlyph:svg` 警告，本次快捷功能区不使用该选择器，安装包仍成功生成。
- 包内 `mnaddon.json` 已核对：ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b1`。
- 源文件：`E:\project\MN\dist\CardLink-v2.4.4-b1.mnaddon`；交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b1.mnaddon`。两者 SHA-256 一致：`9BB68EDC7C64121A86621ADD6CA28E165700CBCE1DF2395EBD7D3FA15662D99E`。

## 后续修复：快捷区点击闪退（2.4.4-b2）

- 用户提供的 MarginNote 4 `2026-09-24 10:10:11` 崩溃日志显示主线程 `SIGABRT`，异常回溯经过 `-[UILabel initWithFrame:]`、`_UILabelLayer setBounds` 和 JSB 点击回调。与快捷区 `menuLabel` 中无 frame 构造 `new UILabel()` 的调用相符。
- `src/mnutils-entrance.ts` 改为构造 `UILabel` 时传入完整 frame；现有 `tests/card-preview.test.ts` 的快捷区行为测试要求标签构造时得到有限尺寸。这与仓库 `src/review-mode.ts` 已采用的原生控件初始化方式一致。
- 版本与新包为 `2.4.4-b2`。最终输入的 `pnpm check`、现有 `tests/card-preview.test.ts`（10 项）和 `pnpm build` 均通过；按新规则未运行完整 `pnpm test`。构建仍报告与本次修复无关的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对：ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b2`。
- 源文件：`E:\project\MN\dist\CardLink-v2.4.4-b2.mnaddon`；交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b2.mnaddon`。两者 SHA-256 一致：`04205F3CD0356324BD35489A3AE54D2FD75C8837F8FAEF5C7FF6F28FAF4C4B54`。
- 尚需 MarginNote 真机复测点击、关闭及动画；桌面自动化不能证明真机已不再崩溃。

## 后续调整：悬浮球自身展开动效（2.4.4-b3）

- 用户提供的 10.94 秒屏幕录像显示紧凑入口在约 0.3–0.4 秒内扩展为同一圆角菜单，文字随后显现；关闭时内容先消失，再缩回原入口。录像是另一应用的界面，CardLink 保留自己的颜色与三项快捷入口。
- `src/mnutils-entrance.ts` 改为扩展 MNButton 的原生 UIButton 本体，不再创建旁边的独立可见面板；透明点击区只负责区外关闭。展开时按钮从 44 点圆球长成 232×204 点圆角面板，之后显现内容；关闭反向执行。面板保持浅色半透明表面和柔和阴影，沿屏幕内侧定位；系统减少动态效果时直接完成状态切换。
- 保留原有拖动停靠、长按复位和学习集/场景清理。`tests/card-preview.test.ts` 的现有快捷区行为测试改为检查同一按钮的展开、内容显现与收回；移除一条与新视觉冲突的旧阴影静态断言。
- 影响范围为原生悬浮球交互、`docs/pages/toolbar.md`、版本与发布说明；不修改答案绑定、错题或索引数据。
- 最终输入的 `pnpm check`、受影响的 `tests/card-preview.test.ts` 与 `tests/plugin-events.test.ts`（合计 40 项）及 `pnpm build` 通过；没有运行完整 `pnpm test`。构建仍提示无关的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对：ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b3`。源文件：`E:\project\MN\dist\CardLink-v2.4.4-b3.mnaddon`；交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b3.mnaddon`。按当前规则不做哈希验证。
- 桌面自动化覆盖原生按钮状态与点击路由，不能检查真实渲染。尚未在 MarginNote 真机对照视频验证动画轨迹、玻璃质感、手势和不同停靠边；因此不能宣称达到像素级一致。

## 后续调整：水滴拉伸与回弹（2.4.4-b4）

- 针对用户指出的等距放大问题，展开改为三个连续阶段：44 点球体先纵向拉至 68×126 点，随后横向展开至比目标略大的尺寸，最后回弹至 232×204 点；内容在回弹时显现。关闭时内容先淡出，再经细长形态收回球体。各阶段保持悬浮球所在外角不动。
- 修正 `ensureMnutilsEntrance` 在布局回调中把动画中的球体直接设为最终尺寸的问题。减少动态效果时直接切换，避免多阶段运动。
- 影响 `src/mnutils-entrance.ts`、快捷区现有行为测试、`docs/pages/toolbar.md`、版本和发布说明；卡片匹配及数据格式未变。
- `pnpm check`、受影响的 `tests/card-preview.test.ts` 与 `tests/plugin-events.test.ts`（40 项）通过。MarginNote 真机视觉对照仍待用户验收。
- `pnpm build` 通过；包内 `mnaddon.json` 核对为正式渠道 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b4`。安装包已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b4.mnaddon`，没有运行完整测试或哈希验证。构建仍提示与本次动效无关的 `.sfIconGlyph:svg` CSS 警告。

## 后续调整：分段胶囊、题目范围与真实遮罩（2.4.4-b5）

- 按用户提供的 HTML 参考实现左右滑动的分段选择动效，仅借鉴运动方式；配色、圆角、字号沿用 CardLink 的原生浅色表面、蓝色强调色和 44 点主操作规格。首排以原 MNButton 图标形成圆形插件入口，旁侧是开始／停止刷题胶囊。
- 「筛选」读取当前脑图卡片，按父节点构成可展开树；复选框选择题目及子树，「全选」选择全部并收起列表。没有颜色设置时按用户决定显示所有颜色索引的卡片；若已有该脑图的颜色设置则按颜色过滤。列表宽高随内容增长并受窗口和 360×520 点上限约束，超出高度使用原生滚动。
- `same-map-practice.ts` 根据勾选题目的直接子节点创建不拦截触摸的原生答案遮罩，复用 CardMask v0.1.0 的 Canvas 候选评分与坐标标定思路。停止、脑图失效、关闭学习集或断开场景时清理遮罩；没有选择或标定失败时给出提示。
- 移除拦截整个窗口触摸的透明关闭层；用不取消底层触摸的轻点识别器实现区外关闭。展开的快捷区拖动时保持展开，并在松手后重新停靠；拖动脑图不会被当成区外轻点。图标入口打开插件页面，开始胶囊尾部保留关闭热区。
- 影响原生快捷区、脑图范围收集、遮罩生命周期、动作注册、文档和版本；旧跨脑图匹配与原有绑定数据格式未改。颜色设置界面与「查找答案」同脑图匹配分支仍是后续范围。
- 最终输入的 `pnpm check`、受影响的 `tests/card-preview.test.ts`、`tests/same-map-practice.test.ts`、`tests/plugin-events.test.ts`（共 41 项）及 `pnpm build` 通过；未运行完整 `pnpm test`。`git diff --check` 无空白错误。构建仍提示与本轮无关的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对正式渠道 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b5`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b5.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b5.mnaddon`。未做哈希验证。
- 桌面测试验证分段动作、树形选择、直接子卡遮罩创建与停止及展开拖动状态；MarginNote 设备尚未连接，原生滚动容器、Canvas 候选层级、手写覆盖关系与动画手感仍需真机验收。

## 后续修正：图标对齐、整行强调和参考切换动效（2.4.4-b6）

- 用户截图显示圆形入口图标偏向左上，树行复选框与文字视觉错位；分段切换过快且额外加入了参考 HTML 中没有的越位回弹。
- `src/mnutils-entrance.ts` 将插件图标作为固定 30 点、居中的图像视图放在原悬浮球按钮内，展开时沿用同一图标；树行取消复选框，用整行浅蓝底色和蓝色文字表示选中，部分选中的父节点使用更浅底色。
- 分段胶囊的视觉层使用透明、不可交互的 `UIWebView`，原生按钮继续处理点击。滑块直接采用参考 HTML 的 `transform 0.45s cubic-bezier(0.32, 0.72, 0, 1)`，文字颜色使用 `0.28s ease 0.06s`；移除原生越位与二段回弹。快捷区高度变化采用 0.4 秒动画，减少动态效果设置下 CSS 过渡关闭。
- 更新 `docs/pages/toolbar.md`、现有受影响测试、版本与发布说明。刷题遮罩、颜色设置数据、卡片匹配逻辑和插件身份未变。
- 最终输入的 `pnpm check`、受影响的 `tests/card-preview.test.ts`、`tests/same-map-practice.test.ts`、`tests/plugin-events.test.ts`（共 41 项）与 `pnpm build` 均通过；`git diff --check` 无空白错误。未运行完整 `pnpm test`，也未做哈希验证。构建仍提示与本轮无关的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对正式渠道 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b6`。源文件为 `E:\project\MN\dist\CardLink-v2.4.4-b6.mnaddon`，交付副本为 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b6.mnaddon`。
- 桌面测试覆盖分段动作、整行选中状态、树形范围、刷题遮罩生命周期与现有入口；MarginNote 设备未连接，实际像素位置、Web 视图合成与动画手感尚未验证。

## 后续修正：恢复悬浮球、统一留白和列表层级动画（2.4.4-b7）

- 按用户反馈撤回 b6 的独立悬浮球图像视图，恢复原 `MNButton.setImage` 图标样式。展开后圆形入口单独显示图标，底层悬浮球图标随展开隐藏，不做跨位置移动。
- 上排图标与开始胶囊、分段胶囊统一采用 12 点外边距；列表从第二排下方 12 点开始，底部同样保留 12 点。
- 筛选从「全选」状态进入时默认清空勾选（正在刷题时保留真实刷题范围）；读取当前脑图卡片不再自动全选。
- 题目列表重建时保留旧列表，旧层淡出、新层淡入，同时变更列表高度、控件位置与外层面板尺寸；树节点展开、收起和切换到全选共用这条 0.4 秒动画路径。
- 影响 `src/mnutils-entrance.ts`、快捷区现有行为测试、工具栏文档、版本与发布说明；其他匹配与遮罩数据格式未变。
- 最终输入的 `pnpm check`、仅快捷区一条定向行为测试及 `pnpm build` 通过；未运行完整测试。构建仍提示与本轮无关的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对正式渠道 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b7`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b7.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b7.mnaddon`。未做哈希验证。
- MarginNote 设备未连接；原生控件间距、图标交替和列表动画的实际视觉效果尚未在设备上验收。

## 后续重构：当前脑图扫描与悬浮球锚定展开（2.4.4-b8）

- 问题根因是扫描以学习集所有笔记为输入，且调用题目树时把脑图归属判断恒设为真。`quick-menu-selection.ts` 现从当前 `mindmapView.mindmapNodes` 提取实际节点 ID；`mnutils-entrance.ts` 在形成树前与学习集笔记求交集，文档目录等未进入当前脑图的笔记不会出现。
- 新建 `quick-menu-geometry.ts` 统一计算球体锚点、展开方向、可用宽高与动画中间帧。右侧从球体向左下、底边向上展开；目标尺寸到屏幕边缘即截止，拖动球体后实时重算并延展。
- 原 MNButton 始终保留 44 点大小与位置，成为打开插件页面的按钮；展开时在球内显示原生线条绘制的窗格图标。快捷区面板为球体后方独立视图，打开与收回共用方向和锚点，收回不重新定位球体。关闭按钮独立成圆形；底边展开时控件布局随面板上下翻转。
- 题目列表和已存在的刷题遮罩数据格式未改。最终输入的 `pnpm check`、一条快捷区定向行为测试与 `pnpm build` 通过；`git diff --check` 无空白错误。未运行完整测试，未做哈希验证。构建仍有既有的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对正式渠道 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b8`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b8.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b8.mnaddon`。
- 桌面定向测试覆盖非脑图文档目录排除、右侧及底边锚定、碰边截断、移动后延展与球体位置不变。MarginNote 设备尚未连接，原生面板的真实动画、触摸层级和窗格图标显示尚未在设备上验收。

## 后续调整：图标规范、固定宽度与展开节奏（2.4.4-b9）

- 原悬浮球 PNG 配合不对称内容内边距造成图标偏移，展开态的窗格还是手工拼接原生视图。现改为 44 点透明 WebView 中央的 28 点 SVG：以 CardLink 标志的 24 点矢量路径作为初态，通过官方 `morphicons/dom` 的 `createMorph` 和 `smooth` 预设形变为 Lucide 窗格图标，设置 `{ reducedMotion: "user" }`。移除手工窗格与透明度切换；球体位置、触摸入口及插件页面动作不变。
- `src/mnutils-entrance.ts` 的筛选树仅根据题目数量调整高度，快捷区目标宽度始终为 272 点；屏幕空间不足仍由 `quick-menu-geometry.ts` 截断。展开分为短促形成、舒展显现和收定三段，控件在舒展阶段同步出现；关闭沿对应阶段反向收回。
- 新增 `src/quick-menu-icon-data.ts` 和独立的 WebView 脚本 `src/quick-menu-icon-runtime.mjs`，由 `build.mjs` 编译注入；更新工具栏功能文档及原有快捷区定向行为测试。题目选择、遮罩数据和插件身份不变，安装包版本升级到 `2.4.4-b9`。
- 最终输入的 `pnpm check`、一条快捷区定向行为测试与 `pnpm build` 均通过；`git diff --check` 无空白错误。未运行完整测试，也未做哈希验证。构建仍提示既有的 `.sfIconGlyph:svg` CSS 警告。
- 桌面定向测试覆盖图标 WebView 居中布局、固定宽度及快捷区开关状态；MarginNote 设备未连接，图标形变和动效手感尚未真机验收。
- 包内 `mnaddon.json` 已核对正式渠道 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b9`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b9.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b9.mnaddon`。

## 后续调整：恢复插件图标与连续展开（2.4.4-b10）

- 用户要求悬浮球始终显示原插件 icon。`src/mnutils-entrance.ts` 恢复使用插件内 `logo.png` 与 MNButton 的 `setImage`，设置对称内容内边距保持居中；展开后同一 44 点按钮直接执行打开插件页面动作，外观与收起状态一致。移除窗格图标、SVG 图标 WebView、形变脚本和对应构建注入，删除不再使用的图标源文件。
- 原展开与收起由三段串行 `MNUtil.animate` 构成，阶段完成之间会出现短暂停顿。改为一次 0.38 秒的原生动画，同时过渡面板尺寸、圆角和控件透明度；保留从悬浮球位置展开、触边限制及原路径收回。删去只服务于旧分段动效的中间帧计算。
- 更新 `docs/pages/toolbar.md`、现有快捷区行为测试和发布说明。题目扫描、选择、刷题遮罩数据及插件身份不变。桌面检查与包信息见本节后续记录；MarginNote 设备尚未连接，视觉平滑度需真机验收。
- `pnpm check`、一条快捷区定向行为测试与 `pnpm build` 均通过；`git diff --check` 无空白错误。未运行完整测试，也未做哈希验证。构建仍提示既有的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b10`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b10.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b10.mnaddon`。

## 后续修正：悬浮球图标居中（2.4.4-b11）

- 用户真机截图显示 b10 的原插件图形只落在圆球左半侧。检查官方 AddonLib `mnutils.js` 后发现，实例 `MNButton.setImage(image, state)` 接收图片对象及按钮状态，原代码却把文件路径和缩放倍数传给它；按钮水平、垂直对齐值 `1` 也指向左侧和顶部。改用静态 `MNButton.setImage(button.button, path, scale)`，由 MNUtils 的 `getImage` 加载并按 2 倍图片比例处理；两轴对齐值改为居中的 `0`，内容内边距归零。
- 影响 `src/mnutils-entrance.ts`、`src/globals.d.ts` 中的 MNButton API 声明和对应已有断言，快捷区、刷题数据和插件身份不变。目标行为是原插件 icon 在收起和展开时都位于同一圆球中心，球体仍是展开后的插件页面入口。最终检查、包信息与真机限制见下方。
- `pnpm check`、一条 MNButton 入口定向检查与 `pnpm build` 通过；任务文件的 `git diff --check` 无空白错误。未运行完整测试，也未做哈希验证。构建仍提示既有的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b11`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b11.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b11.mnaddon`。桌面静态检查不能证明真机像素位置，需在 MarginNote 设备上复核。

## 后续修正：收起末尾的浅色闪现（2.4.4-b12）

- 收起时面板原本只缩小到悬浮球大小并隐藏子控件，浅色面板本身仍位于半透明悬浮球背后；动画结束后移除面板，造成白底突然变透明。`src/mnutils-entrance.ts` 现在在同一次 `MNUtil.animate` 中把面板整体透明度降到零，再移除视图。悬浮球图标、位置和打开插件页面的动作不变。
- 更新 `docs/pages/toolbar.md`、现有快捷区定向行为检查及发布说明；刷题范围、遮罩数据和插件身份不变。
- `pnpm check`、一条快捷区定向行为测试、`pnpm build` 和任务文件 `git diff --check` 通过；未运行完整测试，也未做哈希验证。构建仍提示既有的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b12`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b12.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b12.mnaddon`。MarginNote 设备未连接，真实收起效果仍需真机验收。

## 后续调整：水滴轮廓形变（2.4.4-b13）

- 用户要求将直接尺寸过渡改为水滴展开，并参考 Apple 动效准则。`src/mnutils-entrance.ts` 保留固定悬浮球，在面板上使用原生 `CAShapeLayer` 遮罩；三张拓扑相同的 `UIBezierPath` 轮廓分别为悬浮球圆形、朝可用空间鼓起且靠球体一侧收窄的水滴、完整圆角面板。`CAKeyframeAnimation` 显式插值 `path`，与面板透明度同步；收起反向播放。中途反向操作从显示中的路径继续，拖动或窗口尺寸变化时直接完成到稳定状态。
- 参考 Apple Human Interface Guidelines 的简短、有目的且可取消的动效建议；系统减少动态效果时不播放路径形变。MarginNote 官方 Addon API 暴露 `UIBezierPath`、`CAShapeLayer`、`CAKeyframeAnimation`、`CATransaction`；Apple 文档说明 `CAShapeLayer.path` 不支持隐式动画，因此使用显式关键帧。
- 更新 `src/globals.d.ts` 的原生 API 声明、`docs/pages/toolbar.md`、现有快捷区定向行为检查与发布说明。面板尺寸、筛选数据、刷题遮罩与插件身份不变。桌面验证和包交付见下方；MarginNote 真机上的遮罩渲染和手感尚未验收。
- `pnpm check`、一条快捷区定向行为测试、`pnpm build` 与任务文件 `git diff --check` 均通过；未运行完整测试，也未做哈希验证。构建仍提示既有的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b13`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b13.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b13.mnaddon`。

## 后续修正：点击悬浮球导致 MarginNote 闪退（2.4.4-b14）

- 用户提供的 `MarginNote 4-2026-09-25-000604.ips` 显示主线程抛出 `NSInvalidArgumentException`：`-[__NSCFType CGPath]: unrecognized selector`。点击入口会创建 b13 新增的 `UIBezierPath` 遮罩，并读取 `path.CGPath`；该原生桥接调用是崩溃点，JavaScript 的 `try/catch` 无法拦截 Objective-C 异常。
- `src/mnutils-entrance.ts` 移除整套 `UIBezierPath`/`CAShapeLayer` 路径关键帧实现，改为单次 `MNUtil.animate` 同步调整面板位置、尺寸、圆角和透明度。展开仍以固定悬浮球为起点，收起沿原路径返回并淡出。`src/globals.d.ts` 移除不再使用的桥接声明；`tests/card-preview.test.ts` 的现有定向行为测试不再提供这些原生 API 的模拟，确保入口可以在无路径 API 的环境下工作。
- `docs/pages/toolbar.md`、`RELEASE_NOTES_v2.4.4-b14.md` 对齐当前动画。b13 的水滴轮廓暂时回退；需要在 MarginNote 设备上找到并验证安全的形状实现后再恢复。刷题数据、面板布局和插件身份不变。
- `pnpm check`、一条快捷区展开／收起／打开插件页面定向行为测试、`pnpm build` 及任务文件 `git diff --check` 通过；未运行完整测试，也未做哈希验证。构建仍提示既有的 `.sfIconGlyph:svg` CSS 警告。
- 包内 `mnaddon.json` 已核对 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.4-b14`；安装包从 `E:\project\MN\dist\CardLink-v2.4.4-b14.mnaddon` 复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b14.mnaddon`。桌面测试确认不再调用崩溃的路径 API；MarginNote 设备上的点击和动效尚需实际验收。
