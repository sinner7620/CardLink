# 设置分页面与同脑图子卡答案

## 目的

把设置页按用户指定的四类重排，并把现有 CardMask 式遮罩原型接入按颜色筛选的子卡片答案匹配与做题流程。

## 实现

- Web 设置页在顶栏下方增加四段悬浮胶囊；分别显示答案配置、错题管理、个性设置、关于插件。滑块沿用快捷区筛选/全选的时间和缓动，支持减少动态效果。
- 答案绑定管理逐行展示已有绑定；可切换混合/指定，指定答案脑图或直接子卡，扫描并勾选题目颜色，刷新对应索引，以及二次确认删除。当前脑图绑定入口可选择答案脑图或直接子卡。旧绑定字段缺省时继续使用答案脑图规则。
- 快捷区根据绑定关系中选定的题目颜色列题；做题中按钮变红，筛选区显示被冻结的当前做题队列。原有遮罩引擎继续遮盖所选题目的直接子卡；答案侧边按钮可弹出子卡答案窗口或解除当前题目遮盖。
- 个性设置保存子卡展示方式、深浅遮盖和 CardLink 答案卡评论自动折叠。错题分类说明及调试入口仍可访问。

## 影响范围与数据

- 原生：`src/binding.ts`、`src/plugin.ts`、`src/answer-lookup.ts`、`src/matcher.ts`、`src/same-map-practice.ts`、`src/mnutils-entrance.ts`、`src/quick-menu-selection.ts`、`src/rails-core.ts`、`src/settings.ts`、`src/card-html.ts`、`src/mistake-manager.ts`。
- Web：`web/src/main.jsx`、`web/src/ui/settings.css`。文档：设置、工具栏、绑定和答案查找说明。
- 新绑定字段均为可选；旧绑定记录及错题数据不迁移。未选颜色时快捷区不给出题目；子卡匹配限定为题目直接子卡。

## 验证与限制

- `pnpm check` 通过。子卡匹配、遮罩、快捷区、绑定、桥协议与 Web 渲染等 8 个相关测试文件共 148 项通过。`pnpm build` 通过；构建仍报告现有 `.sfIconGlyph:svg` 选择器告警。
- 本地浏览器预览检查了设置胶囊、绑定管理行、颜色筛选展开布局；`git diff --check` 通过。未在 MarginNote 设备中运行。
- MarginNote 设备未连接。Canvas 层级、手写遮盖顺序、原生弹窗和真实脑图颜色需要真机验收；浏览器预览只能验证设置排版和切换。
- 当前未交付安装包、未修改版本号，也未发布到 GitHub/Gitee。

## 设置页交互跟进

- 绑定管理列说明集中在列表顶部；主匹配胶囊的“指定”半区内展开答案脑图/子卡片子滑块。答案脑图名称本身成为更换入口。筛选、刷新、删除改为图标按钮，筛选与折叠、删除与确认使用 Morphicons 官方形变。删除行为参照错题本两次点击确认，原生第三层弹窗移除。
- 匹配规则置于绑定管理之前；错题管理移除“定位当前错题原题”设置入口。个性设置改用紫色图标主题，拆为答题体验、操作与窗口、内容显示三个块。
- 跟进验证：`pnpm check`、桥协议/领域/Web 渲染与桥交互测试 104 项、`pnpm build` 均通过。本地预览检查了绑定管理展开、指定子滑块、筛选展开与个性设置分块，并实际执行了删除图标两次点击：首次进入确认态，第二次使预览绑定行从 2 行变为 1 行。仍未进行 MarginNote 真机检查，未交付安装包。

## iPad 设置点击卡死修复

- 用户提供的 `MarginNote 4-2026-09-25-120323.ips` 记录 2026-09-25 12:03:23 的 `FRONTBOARD` 10 秒 scene-update watchdog 终止；主线程停在 Core Data `sqlite3_step`，上层为插件 JS 调用及 WebKit 导航回调。崩溃日志无法标出具体 JS 行，代码排查发现每次 dashboard 都遍历绑定学习集全部卡片，并逐卡通过 `NodeNote` 判定脑图归属；点击答案脑图名称也会先执行同样的扫描。
- `managedAnswerBindings()` 改为只读取绑定记录、学习集标题和脑图标题。`answerMatchingSettingsData()` 改为从已选卡片与已有绑定键判断范围，移除每次 dashboard 的全学习集扫描。题目可选颜色改为首次展开对应筛选区时按需扫描，按原始 `childMindMap` 范围字段判断颜色，并分批让出执行权。选择答案脑图前也先让出执行权再扫描候选。
- 影响文件：`src/plugin.ts`、`src/rails-core.ts`、`web/src/main.jsx`、`web/src/lib/previewBridge.js`、`tests/settings-crash-guard.test.ts`、设置说明、`package.json` 与 `RELEASE_NOTES_v2.4.4-b15.md`。绑定数据不迁移；已选颜色、匹配方式和现有错题记录不变。
- `pnpm check` 通过；崩溃防回归、桥协议、设置页渲染、匹配等 6 个相关测试文件共 109 项通过；`pnpm build` 通过，仍有既有 `.sfIconGlyph:svg` CSS 告警。包内 `mnaddon.json` 核对为版本 `2.4.4-b15`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`。安装包从 `dist/CardLink-v2.4.4-b15.mnaddon` 复制至 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b15.mnaddon`。未发布 GitHub/Gitee。
- iPadOS 设备复测尚未进行，尤其需复测答案脑图名称、更改颜色筛选及其他设置项；桌面测试不能证明 watchdog 问题已在真机彻底消失。

## 绑定设置局部刷新与颜色筛选跟进

- 点击答案脑图名称、修改匹配方式或题目颜色后，Web 先前会调用整个 dashboard 加载流程；原生绑定写入通知也会触发一次全量加载。现新增仅返回匹配设置及绑定行的 `bindingSettingsSnapshot`，绑定相关原生通知改走单独回调，避免重取错题分页快照。个性设置和插件窗口关闭按钮使用命令返回值就地更新。
- 绑定行从存储读取后按绑定键固定排序，不受存储字典枚举顺序变化影响。筛选项改为色块胶囊按钮，选中项使用强调色边框与浅色背景，移除复选框及辅助说明。
- 颜色选择仍由题目脑图卡片的 `colorIndex` 决定；MarginNote 公开插件接口未提供自定义调色板的 RGB 值，因此色块按内置调色板近似显示。自定义颜色模板下色块可能与原生卡片不同，颜色编号及筛选行为不受影响。
- 影响 `src/plugin.ts`、`src/rails-core.ts`、`web/src/main.jsx`、`web/src/ui/settings.css`、`web/src/lib/previewBridge.js`、相关测试及本说明。无需迁移绑定或错题数据。
- 验证：`pnpm check` 通过；绑定扫描、排序、桥协议及 Web 渲染等 4 个相关测试文件共 47 项通过；`pnpm build` 通过（仍报告已有的 `.sfIconGlyph:svg` CSS 告警）。本地浏览器预览确认色块、选中强调与选色后行位置不变。包内清单为 `2.4.4-b16`、`marginnote.extension.mn4-answer-matcher`、`CardLink`；安装包已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b16.mnaddon`。MarginNote iPad 真机未连接，原生弹窗和错题列表不重载仍待设备复测；未发布 GitHub/Gitee。

## 选卡添加颜色、做题队列和个性设置跟进

- 颜色筛选改为只展示已保存的色块与添加/逐项删除按钮。用户在当前题目脑图只选一张卡片后确认添加；原生检查当前学习集、脑图范围和可见节点，直接读取该卡 `colorIndex`，不扫描学习集。原有颜色数组保持兼容。
- 快捷区从当前 `mindmapView.mindmapNodes` 构造题目树，用渲染节点自身的颜色和父子关系过滤；避免学习集笔记副本颜色不同步导致选绿题却列出其他颜色。遮罩校准修正 `selViewLst` 的 `{note,view}` 结构；未选卡时使用脑图视图坐标，开始做题不再强制要求标定卡片。
- 设置块增加间距，顶栏页签增加移动滑块。个性设置将答案展示明确命名为“子卡片答案展示”；遮盖设置展开颜色与自定义图片选择，图片保存在本机设置。内容显示改为待复习设置，允许配置题目预览默认展开的评论数；卡片各条评论独立折叠，记录手动状态。旧深浅遮盖设置读取时兼容。
- 影响设置、桥接、快捷区、遮罩与卡片预览模块及相关文档。无绑定或错题数据迁移；新增设置字段有默认值。iPad 真机仍需验证图像遮罩层与实际脑图坐标。
- 最终验证：`pnpm check` 通过；设置防卡死、快捷区、同脑图遮罩、子卡匹配、桥协议、卡片预览及错题导出等 10 个相关测试文件共 162 项通过；`pnpm build` 通过，仍报告原有 `.sfIconGlyph:svg` CSS 告警。本地浏览器预览检查了设置块间距、顶栏滑块、添加颜色确认流程、遮盖展开设置和评论数选择。包内清单核对为 `2.4.4-b17`、`marginnote.extension.mn4-answer-matcher`、`CardLink`。MarginNote iPad 真机未连接；做题遮罩坐标、自定义图片覆盖及原生选卡仍需设备复测。未发布 GitHub/Gitee。

## 首次全选与遮盖定位修正

- 快捷区的“全选”状态现在与所选题目集合一致；切到筛选时先切换模式，再读取题目，保留从未选状态开始的交互。开始做题不再以空集合误报“选择范围”。
- 同脑图遮盖读取选中视图及其对应卡片 ID，并以该卡脑图节点位置校准 Canvas。未选卡时通过 MarginNote 选卡接口选中本次范围内第一张题目卡片；移除未经校准直接将脑图视图当作画布的路径。实际未放置遮盖时启动失败并显示原因。
- 待复习评论数量改为弹窗选择；颜色添加按钮使用官方 Morphicons 从加号变为对勾，取消图标紧随其右，选卡提示与“题目卡片颜色”同排。顶栏滑块样式移出窄窗口媒体查询，在所有窗口宽度下生效。
- 影响快捷区、同脑图遮盖、设置 Web 页面与样式，以及设置和工具栏说明。已有绑定与设置无需迁移。MarginNote iPad 真机未连接，原生自动选卡及遮盖层级仍待复测。
- 验证：`pnpm check` 通过；只运行并适配既有相关测试，6 个文件共 51 项通过，未新增测试；`pnpm build` 通过，仍报告既有 `.sfIconGlyph:svg` CSS 告警。包内清单核对为 `2.4.4-b18`、`marginnote.extension.mn4-answer-matcher`、`CardLink`。安装包复制至 iCloud 同步目录；未发布 GitHub/Gitee。

## 做题队列与设置布局复核

- 快捷区创建时按做题状态初始化队列滑块，不依赖 WebView 装载后的脚本调用；开始做题后直接显示队列。队列行点击定位原题，做题悬浮条复用复习模式的玻璃外壳、SVG 绘制、触摸控件和官方脑图定位入口，提供题目列表、上一题、下一题与结束。做题导航保持当前脑图，以免焦点模式重建画布导致遮盖丢失。
- 新脑图首次选卡定位改为等待视图出现并重试；遮盖坐标仍基于实际选卡视图。自定义图片改用透明且不接收触摸的 WebView 渲染，覆盖到答案遮罩内。
- 设置分类胶囊进入页面布局，滚动内容不再经过其下方；绑定子滑块明确清除通用按钮背景及阴影，恢复胶囊形状。评论展开数量改用 MarginNote 原生 `select` 弹窗，移除自写 Web 弹窗。
- 影响 `src/mnutils-entrance.ts`、`src/same-map-practice.ts`、`src/review-mode.ts`、`src/note-navigation.ts`、`src/rails-core.ts`、`src/plugin.ts`、设置 Web 页面和样式。无绑定或设置数据迁移。MarginNote iPad 真机仍需验证队列跳转、原生悬浮条层级、首次选卡与图片遮盖。
- 验证：`pnpm check` 通过；只运行并适配现有 6 个相关测试文件，共 51 项通过，未新增测试；`pnpm build` 通过，仍报告已有 `.sfIconGlyph:svg` CSS 告警。本地浏览器预览确认设置胶囊占据独立空间，绑定子滑块按钮计算样式为透明背景、999px 圆角、无阴影。包内清单核对为 `2.4.4-b19`、`marginnote.extension.mn4-answer-matcher`、`CardLink`；安装包已复制至 iCloud 同步目录。未发布 GitHub/Gitee。

## b20 样式层级与焦点遮盖修复

- 用户提供的 b19 诊断文档指出 `app.css` 的 `@layer` 层级异常。核对源文件发现 `web/src/ui/shell.css` 的 `mn-ui-priority` 块缺少闭合，导致后续样式被错误嵌套，通用按钮规则压过错题本和绑定滑块等专用规则。补齐层边界后，构建产物仅有顶层 `mn-ui-base`、`mn-ui-priority` 两层。设置分类胶囊恢复原先的绝对定位、独立宽度和半透明玻璃背景，内容与胶囊约隔 10px；绑定匹配按钮恢复原选择器与参考 HTML 的主/子滑块动画。
- 对照 CardMask v0.1.0 源码，继续使用其选卡视图与脑图节点校准 Canvas、每 0.16 秒同步遮盖的方式。焦点模式重建脑图画布时，不再停止做题会话；清理旧画布遮盖并用当前可见题目重新选卡、校准、放置遮盖。学习集真正切换或明确结束做题时才停止会话。
- 移除做题模式独立悬浮工具栏及原生事件入口；快捷区当前做题队列、点击定位原题和结束做题保留。影响 `web/src/ui/shell.css`、`settings.css`、`src/same-map-practice.ts`、`src/review-mode.ts`、`src/mnutils-entrance.ts`、`src/plugin.ts`、`src/rails-core.ts`、设置及工具栏说明。绑定、错题和个性设置数据无需迁移。
- `pnpm check` 通过；现有同脑图遮盖、子卡匹配、Web 渲染、桥协议、插件事件相关测试 74 项通过，未新增测试；`pnpm build` 通过，仍有既有 `.sfIconGlyph:svg` 告警。本地浏览器检查设置胶囊、绑定主/子滑块、错题列表与详情；MarginNote iPad 未连接，焦点模式画布重建后的遮盖层级与图片遮盖仍需设备复测。
- 包内清单核对为 `2.4.4-b20`、正式 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；安装包复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b20.mnaddon`。未发布 GitHub/Gitee。

## b21 首题定位与 CardMask 遮盖同步跟进

- 对照提供的 CardMask v0.1.0 `main.js`：其同步逻辑只要求学习集一致、Canvas 仍挂在视图树上，不把脑图对象引用或定位卡暂时不可见当作遮盖失效。移除 CardLink b20 添加的这两项判据；焦点切换期间保留仍有效的遮盖，Canvas 脱离视图时才按当前可见题目重新选卡校准，且只在新画布就绪后清理旧遮盖。脑图节点暂为空时也保留遮盖，避免过渡帧露出答案。将纯色遮盖不透明度恢复至 CardMask 的 0.99。
- 开始做题时按快捷区题目树的显示顺序整理队列，先用现有官方定位入口定位第一题，再确认实际选中视图正是该题并用它校准 Canvas。重新校准时优先使用当前选中的队列题目；学习集判定优先采用 CardMask 使用的 `notebookController.notebookId`。保留已有的子卡题目范围、自定义遮盖图片和快捷区交互。
- 影响 `src/same-map-practice.ts`、`src/mnutils-entrance.ts`、工具栏说明与版本文件；绑定、错题及设置数据无需迁移。未新增测试。`pnpm check`、现有相关测试 45 项与 `pnpm build` 通过；构建仍报告既有 `.sfIconGlyph:svg` 告警。设备未连接，焦点模式下 Canvas 是否保持同一原生视图、重新校准延迟及自定义图片性能仍需 iPad 验证。
- `2.4.4-b21` 包曾复制到同步目录。最终复核新增“旧 Canvas 仍挂载但已不属于当前脑图”的判定，沿用 CardMask 校准时的视图父链判断；按版本规则改用 `2.4.4-b22` 交付，不覆盖 b21。该改动后再次执行 `pnpm check`、现有相关测试 45 项和 `pnpm build`，均通过。
- b22 包内清单核对为版本 `2.4.4-b22`、正式 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；安装包复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b22.mnaddon`。未发布 GitHub/Gitee。
