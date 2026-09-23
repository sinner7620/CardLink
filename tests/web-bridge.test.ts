import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

test("隐藏页面不触发 rAF 时仍装载应用脚本", () => {
  const scripts: any[] = [], timers: (() => void)[] = []
  runInNewContext(readFileSync("web/boot.js", "utf8"), {
    window: { addEventListener() {} },
    document: { createElement: () => ({}), body: { appendChild: (node: any) => scripts.push(node) } },
    requestAnimationFrame() { throw new Error("隐藏 WebView 不应依赖 rAF") },
    setTimeout: (callback: () => void) => timers.push(callback)
  })
  assert.equal(timers.length, 1)
  timers[0]()
  assert.equal(scripts[0].src, "./app.js")
})

test("日志同一调用栈直接写临时文件并保存，失败后可重试且无原生选中视图采样", () => {
  const source = readFileSync("src/note-navigation.ts", "utf8")
  const fn = source.match(/export function exportNavigationRuntimeLog[\s\S]*?\n\}/)?.[0]
  assert.ok(fn)
  const calls: string[] = []
  let fail = false
  const context: any = {
    exports: {}, __APP_VERSION__: "2.3.3-beta.67", runtimeLogExportPending: false,
    loadMatcherSettings: () => ({ debugModeEnabled: true }),
    runtimeLogText: () => "existing log", MN: { app: { tempPath: "/tmp", documentPath: "/docs" } },
    pushRuntimeDebugLine() {},
    cardLinkTempPath: (relative: string) => `/tmp/CardLink/temp/${relative}`,
    ensureStorageDirectory: () => true,
    writeTextFile: (file: string, text: string) => { assert.match(file, /^\/tmp\/CardLink\/temp\/logs\//); assert.equal(text, "\uFEFFexisting log"); calls.push("write") },
    saveFile: (_file: string, uti: string) => { assert.equal(uti, "public.plain-text"); calls.push("save"); if (fail) throw new Error("picker failed") }
  }
  runInNewContext(transpileModule(fn, { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  assert.equal(context.exports.exportNavigationRuntimeLog().saved, true)
  assert.deepEqual(calls, ["write", "save"])
  fail = true
  assert.throws(() => context.exports.exportNavigationRuntimeLog(), /picker failed/)
  assert.equal(context.runtimeLogExportPending, false)
  fail = false
  assert.equal(context.exports.exportNavigationRuntimeLog().saved, true)
})

const uiModules = ["controls", "shell", "overview", "mistakes", "review", "export", "settings", "detail"]

function readUiCss(...modules: string[]): string {
  return (modules.length ? modules : uiModules)
    .map(name => readFileSync(path.join(process.cwd(), "web", "src", "ui", `${name}.css`), "utf8"))
    .join("\n")
}

test("阶段一样式按页面所有权加载且旧覆盖层已退役", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const imported = [...source.matchAll(/import "\.\/ui\/([^\"]+)\.css"/g)].map(match => match[1])
  assert.deepEqual(imported, ["tokens", ...uiModules])
  assert.equal(existsSync(path.join(process.cwd(), "web", "src", "panel.css")), false)
  assert.equal(existsSync(path.join(process.cwd(), "web", "src", "panel-preview.css")), false)
  assert.doesNotMatch(readUiCss(), /\.mn-debug-glass|\.exportToolbar|\.exportPick(?:Rows|Row|Tools|Empty)/)
})

test("MarginNote 的 file 页面使用原生桥接而不是预览数据", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "lib", "mnBridge.js"), "utf8")
  assert.match(source, /__MN_FULL_UI_PREVIEW__/)
  assert.match(source, /mnaddon:\/\/bridge/)
  assert.doesNotMatch(source, /location\.protocol\s*===\s*["']file:/)
})

test("插件面板不再包含液态玻璃原生调用或透明联动", () => {
  const panel = readFileSync(path.join(process.cwd(), "rails-native", "WebPanelController.js"), "utf8")
  assert.doesNotMatch(panel, /UIGlassEffect|UIVisualEffectView|nativeLiquidGlass|nativeGlassMounted/)
})

test("跨脑图定位原题时只使用稳定会话尺寸，不采样切换过程中的临时 frame", () => {
  const addon = readFileSync(path.join(process.cwd(), "rails-native", "WebAddon.js"), "utf8")
  const panel = readFileSync(path.join(process.cwd(), "rails-native", "WebPanelController.js"), "utf8")
  assert.match(addon, /self\.pendingMistakeNavigation[\s\S]*preservePanelForNotebookSwitch/)
  assert.match(addon, /preserveAcrossNotebookSwitch[\s\S]*restorePanelAfterNotebookSwitch/)
  const preserve = panel.match(/function preservePanelForNotebookSwitch[\s\S]*?\n  \}/)?.[0] || ""
  assert.match(preserve, /controller\.view\.frame = savedFrame\(controller\)/)
  assert.doesNotMatch(preserve, /saveFrame\(controller\)|removeFromSuperview/)
  const restore = panel.match(/function restorePanelAfterNotebookSwitch[\s\S]*?\n  \}/)?.[0] || ""
  assert.match(restore, /var frame = savedFrame\(controller\)/)
  assert.doesNotMatch(restore, /__onPanelShow/)
  assert.match(panel, /controller\.view\.autoresizingMask = 0/)
  assert.match(panel, /function ensureLayout[\s\S]*var frame = savedFrame\(controller\)[\s\S]*controller\.view\.frame = frame/)
  const close = panel.match(/function closePanel[\s\S]*?\n  \}/)?.[0] || ""
  assert.doesNotMatch(close, /saveFrame\(controller\)/)
})

test("插件根页面固定，仅内容页和专用面板滚动", () => {
  const css = readUiCss()
  assert.match(css, /\.shell > main\s*\{[^}]*overflow:\s*hidden/)
  assert.match(css, /@layer mn-ui-priority/)
  assert.doesNotMatch(css, /!important/)
  assert.match(css, /\.overviewPage,[\s\S]*?\.exportPage\s*\{[\s\S]*?overflow:\s*auto/)
  assert.doesNotMatch(css, /\.shell > main\s*\{[^}]*overflow-y:\s*scroll/)
})

test("默认构建完全由开发源码生成，不再依赖 runtime baseline", () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"))
  const build = readFileSync(path.join(process.cwd(), "build.mjs"), "utf8")
  assert.equal(pkg.scripts.build, "node build.mjs")
  assert.equal(pkg.scripts["build:source"], "node build.mjs")
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /legacy-runtime|build-runtime/)
  assert.match(build, /src["'],\s*["']rails-core\.ts/)
  assert.match(build, /web["'],\s*["']vite\.config\.js/)
})

test("错题详情 UI 由源码实现并保持重构后的工具栏结构", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const css = readUiCss("mistakes", "detail")
  const preview = readFileSync(path.join(process.cwd(), "web", "src", "lib", "previewBridge.js"), "utf8")
  assert.match(source, /\.\/ui\/mistakes\.css/)
  assert.match(source, /previewLevelSelect/)
  assert.match(source, /detailTagPicker/)
  assert.match(source, /detailRemoveMistake/)
  // beta.65 重构：右侧状态行（等级+剩余天数两枚胶囊横排、· 分隔，各自状态色）、标签行（含灰底添加日期）、悬浮操作条与圆点折叠
  assert.match(source, /detailStatusCard/)
  assert.match(source, /detailStatusDivider/)
  assert.match(source, /detailLevelChip level level\$\{detail\.record\.level\}/)
  assert.match(source, /detailDueChip \$\{dueTone\}/)
  assert.match(source, /detailTagPicker detailTagBar/)
  assert.match(source, /detailAddedDate/)
  assert.match(source, /detailActionBar \$\{bar\.orientation\}/)
  assert.match(source, /detailBarDot/)
  // v7：定位原题/取消错题纯图标化；垃圾桶→对勾 Phosphor 形变；条内图标与文字放大
  assert.doesNotMatch(source, /phosphorTrashSimple|phosphorCheck:/)
  assert.match(source, /<DetailMorphIcon icon=\{Trash2\} active=\{removeArmed\} \/>/)
  assert.match(source, /createMorph\(path\.current/)
  assert.match(source, /settingsIcon ariaLabel="定位原题"><span className="barText"/)
  assert.match(source, /aria-label=\{removeArmed \? "再次确认取消错题" : "取消错题"\}/)
  assert.match(css, /\.detailActionBar svg, \.detailBarDot svg \{[^}]*width: 18px/)
  assert.match(preview, /解法二/)
  assert.match(source, /<CardPreview key=\{`\$\{detail\.record\.recordId\}:question`\}/)
  assert.match(css, /@container detailPane \(max-width: 430px\)/)
  assert.match(css, /\.detailLevelChip \.previewLevelSelect/)
  assert.match(css, /\.detailStatusCard \{[^}]*border-radius: 999px/)
  assert.match(css, /\.preview-detail-title-row \{[\s\S]*?grid-template-columns: minmax\(0,\s*1fr\) auto;/)
  assert.match(css, /\.detailDueChip\.isOverdue \{[^}]*--mn-level-0/)
  assert.doesNotMatch(css, /preview-level-[345]/)
})

test("2.3.2 详情交互修复进入源码构建", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const css = readUiCss()
  const icons = readFileSync(path.join(process.cwd(), "web", "src", "icons.jsx"), "utf8")
  const core = readFileSync(path.join(process.cwd(), "src", "rails-core.ts"), "utf8")
  const manager = readFileSync(path.join(process.cwd(), "src", "mistake-manager.ts"), "utf8")
  const cardHtml = readFileSync(path.join(process.cwd(), "src", "card-html.ts"), "utf8")
  const build = readFileSync(path.join(process.cwd(), "build.mjs"), "utf8")
  const pinch = readFileSync(path.join(process.cwd(), "src", "pinch-zoom.ts"), "utf8")

  const preview = readFileSync(path.join(process.cwd(), "web", "src", "CardPreview.jsx"), "utf8")
  const previewController = readFileSync(path.join(process.cwd(), "src", "card-preview.ts"), "utf8")
  assert.match(preview, /mountCardPreview\(win, wireFramePinchZoom\)/)
  // 触摸/gesture 事件跟踪统一在跨 Web/卡片共用的 pinch-zoom.ts
  assert.match(pinch, /gesturechange/)
  assert.match(pinch, /touchmove/)
  assert.match(previewController, /card\.style\.transform = scale === 1/)
  assert.match(previewController, /card\.style\.width = width \+ "px"/)
  assert.doesNotMatch(source, /documentElement\.style\.zoom/)
  assert.match(cardHtml, /maximum-scale=3,user-scalable=yes/)
  assert.match(cardHtml, /mountCardPreview\.toString\(\)/)
  assert.match(source, /当前队列没有题目[^\n]*icon=\{false\}/)
  assert.match(source, /previewLevelSelect[^\n]*\{name\}<\/option>/)
  assert.match(source, /detailTagDelete/)
  assert.match(source, /tagDeleteConfirmOverlay/)
  assert.match(source, /deleteMistakeTag/)
  assert.match(icons, /trash:/)
  assert.match(core, /command === "deleteMistakeTag"/)
  assert.match(manager, /export async function deleteMistakeTag/)
  assert.match(build, /webDist, "logo\.png"/)
  assert.doesNotMatch(source, /src="\.\/logo\.png"/)
  assert.match(source, /MindMapMultiSelect/)
  assert.match(source, /buildParentInsights/)
  assert.match(source, /mindMapSelectTrigger/)
  assert.match(css, /\.mindMapSelect/)
  assert.match(source, /<MistakeDetail key=\{detail\.record\.recordId\}/)
  assert.match(source, /key=\{`\$\{detail\.record\.recordId\}:question`\}/)
  assert.match(source, /key=\{`\$\{detail\.record\.recordId\}:answer:/)
  assert.match(css, /\.listToolbar > \.batchToggle/)
  assert.match(css, /text-overflow: ellipsis/)
})

test("运行日志只在独立调试功能区显示并通过原生桥接保存文本", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const core = readFileSync(path.join(process.cwd(), "src", "rails-core.ts"), "utf8")
  const navigation = readFileSync(path.join(process.cwd(), "src", "note-navigation.ts"), "utf8")
  const versionIndex = source.indexOf('"当前版本"')
  const logIndex = source.indexOf('"导出运行日志"')
  const debugGroupIndex = source.indexOf('title="调试功能"')
  assert.ok(versionIndex >= 0 && debugGroupIndex > versionIndex && logIndex > debugGroupIndex)
  assert.match(source, /taps\.count >= 5/)
  assert.match(source, /action\("setDebugMode", \{ enabled: true \}\)/)
  assert.match(source, /async function exportRuntimeLog\(\)[\s\S]*?MNBridge\.send\("exportRuntimeLog"\)/)
  assert.doesNotMatch(source, /action\("exportRuntimeLog"/)
  assert.match(core, /command === "exportRuntimeLog"/)
  assert.match(navigation, /export function exportNavigationRuntimeLog/)
  assert.match(navigation, /writeTextFile\(path/)
  assert.match(navigation, /saveFile\(path, "public\.plain-text"\)/)
  // 与 beta.2 相同的直接保存路径；导出不再同步读取原生选中视图或人为延时。
  const exportBody = navigation.match(/export function exportNavigationRuntimeLog[\s\S]*?\n\}/)?.[0] || ""
  assert.doesNotMatch(exportBody, /delay\(|recordRuntimeState\(|currentControllerState\(/)
  assert.match(exportBody, /cardLinkTempPath\("logs"\)/)
  assert.match(navigation, /if \(runtimeLogExportPending\) throw/)
  assert.doesNotMatch(navigation, /delay\(0\.05\)/)
  assert.match(navigation, /return \{ saved: true, filename \}/)
  assert.match(navigation, /if \(!loadMatcherSettings\(\)\.debugModeEnabled\) return/)
})

test("冷启动先绘制外壳且首次面板显示不会重复请求 dashboard", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const panel = readFileSync(path.join(process.cwd(), "rails-native", "WebPanelController.js"), "utf8")
  assert.match(source, /const initialLoadCompleteRef = useRef\(false\)/)
  assert.match(source, /DASHBOARD_SHELL_CACHE_KEY/)
  assert.match(source, /useState\(startupSnapshotRef\.current\)/)
  assert.match(source, /await load\(Boolean\(startupSnapshotRef\.current\)\)/)
  assert.match(source, /const initialTimer = window\.setTimeout\([\s\S]*?await load\(\)/)
  assert.match(panel, /controller\.view\.hidden = true;[\s\S]*?return controller/)
  assert.match(panel, /boot\.appRendered/)
  assert.match(source, /window\.__onPanelShow = async options => \{[\s\S]*MNBridge\.send\("mistakesRevision"\)[\s\S]*status\?\.revision !== dataRef\.current\?\.mistakes\?\.revision/)
  assert.match(panel, /controller\.webReady = false/)
  assert.match(panel, /webViewDidFinishLoad[\s\S]*self\.webReady = true/)
  assert.match(panel, /if \(controller\.webReady\) \{[\s\S]*window\.__onPanelShow/)
})

test("设置页可切换插件窗口关闭按钮位置", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const bridge = readFileSync(path.join(process.cwd(), "rails-native", "WebBridgeCommands.js"), "utf8")
  const panel = readFileSync(path.join(process.cwd(), "rails-native", "WebPanelController.js"), "utf8")
  assert.match(source, /"插件窗口关闭按钮"/)
  assert.match(source, /action\("setPanelCloseButtonSide"/)
  assert.match(bridge, /command === "setPanelCloseButtonSide"/)
  assert.match(panel, /function setCloseButtonSide/)
  assert.match(source, /action\("closePanel", null, false\)/)
  assert.match(source, /<Icon name="close" \/>/)
  assert.ok(source.includes('panelCloseSide === "left" && <div className="windowControlCapsule">{closeButton}{refreshButton}</div>'))
  assert.ok(source.includes('panelCloseSide === "right" && <div className="windowControlCapsule">{refreshButton}{closeButton}</div>'))
  assert.doesNotMatch(panel, /UIButton\.buttonWithType|controller\.closeButton/)
  assert.match(panel, /mn4-answer-matcher\.rails\.close-side\.v1/)
})

test("插件网页延伸到原生关闭按钮行且设置项位于插件分组", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const css = readUiCss("controls", "shell", "settings")
  const panel = readFileSync(path.join(process.cwd(), "rails-native", "WebPanelController.js"), "utf8")
  const answerGroupEnd = source.indexOf(']} />', source.indexOf('<SettingsGroup title="答案匹配"'))
  const pluginGroupStart = source.indexOf('<SettingsGroup title="插件"')
  const settingIndex = source.indexOf('"插件窗口关闭按钮"')
  assert.ok(settingIndex > pluginGroupStart && settingIndex > answerGroupEnd)
  assert.match(source, /className=\{trailing \? "hasTrailing" : ""\}/)
  assert.match(css, /button\.hasTrailing::after\s*\{[^}]*content:\s*none;/)
  assert.match(css, /\.topTools-left\s*\{[^}]*grid-column:\s*1;/)
  assert.match(css, /\.topTools-right\s*\{[^}]*grid-column:\s*3;/)
  assert.match(panel, /y: 0,[\s\S]*height: frame\.height/)
  assert.match(panel, /controller\.view\.addSubview\(controller\.webView\)/)
  assert.doesNotMatch(panel, /controller\.view\.addSubview\(controller\.titleBar\)/)
})

test("整条顶栏除按钮组外可拖动、Tab 居中且顶栏为白色", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const css = readUiCss("controls", "shell")
  const redesign = readUiCss("shell")
  const panel = readFileSync(path.join(process.cwd(), "rails-native", "WebPanelController.js"), "utf8")
  assert.match(panel, /controller\.headerPan = new UIPanGestureRecognizer\(controller, "handleHeaderPan:"\)/)
  assert.match(panel, /controller\.headerPan\.cancelsTouchesInView = false/)
  assert.match(panel, /controller\.headerPan\.delegate = controller/)
  assert.match(panel, /gestureRecognizerShouldBegin/)
  assert.match(panel, /insideHeader && !insideControls/)
  assert.match(panel, /Number\(start\.y\) <= TITLE_HEIGHT/)
  // 根源修复：浮窗顶边不得越入窗口安全区（UIWindow 宿主下越入会触发 UIKit
  // 调整 UIWebView inset/contentOffset，导致旧版 UIWebView 错误锚定 fixed 顶栏）。
  // 仅约束顶边，其余方向自由；不再保留 scrollEnabled/逐帧 offset 清零/scrollTo
  // 重锚等补偿链。
  assert.match(panel, /function safeAreaTop/)
  assert.match(panel, /function clampFrameTop/)
  assert.match(panel, /self\.view\.frame = clampFrameTop\(self, \{/)
  assert.match(panel, /Math\.max\(safeAreaTop\(controller\), Number\(frame\.y\) \|\| 0\)/)
  // 滚动架构：根 UIScrollView 仅在 setup 初始化时禁滚一次；
  // 拖动/布局路径不得再出现任何滚动补偿（scrollEnabled 翻转/settle/reanchor/scrollTo）。
  assert.match(panel, /scrollView\.scrollEnabled = false;/)
  assert.equal((panel.match(/scrollEnabled/g) || []).length, 1)
  assert.doesNotMatch(panel, /scrollEnabled = true|settleWebViewRootScroll|reanchorWebViewFixedElements|window\.scrollTo/)
  assert.doesNotMatch(panel, /leftDragArea|rightDragArea|titleDragArea/)
  assert.match(panel, /CONTROL_CLUSTER_WIDTH/)
  assert.match(panel, /controller\.webView\.opaque = false/)
  assert.match(panel, /controller\.webView\.layer\.cornerRadius = 14/)
  assert.match(source, /const refreshButton = <button className="iconButton"/)
  assert.match(source, /const closeButton = <button className="iconButton"/)
  assert.match(source, /className="windowControlCapsule"/)
  assert.match(css, /\.windowControlCapsule \{[\s\S]*width: 72px;[\s\S]*height: 32px;/)
  assert.match(css, /@keyframes windowControlJelly/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /\.topBar \{[\s\S]*background: #fff/)
  assert.match(css, /-webkit-backdrop-filter: none/)
  assert.doesNotMatch(css, /\.shell::after/)
  assert.match(css, /\.shell > main \{[^}]*border-radius: 14px/)
  // 滚动架构归一：main 为 flex 纵列（topBar 文档流 + 页面 flex 自持滚动），根不参与滚动
  assert.match(css, /\.shell \{[^}]*display: flex;[^}]*flex-direction: column;/)
  assert.match(css, /\.shell > main \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*display: flex;/)
  assert.doesNotMatch(css, /\.shell > main \{[^}]*height: 100%;/)
  assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*background:\s*transparent;/)
  assert.match(css, /grid-template-columns: minmax\(94px, 1fr\) auto minmax\(94px, 1fr\)/)
  assert.match(source, /topTools topTools-left[\s\S]*panelCloseSide === "left"[\s\S]*<nav className="topNav">[\s\S]*topTools topTools-right[\s\S]*panelCloseSide === "right"/)
  assert.match(redesign, /header\.topBar \{[\s\S]*width: 100%;[\s\S]*max-width: 100vw;[\s\S]*margin: 0;/)
  assert.match(redesign, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/)
  assert.match(redesign, /\.topBar > \.topNav \{[\s\S]*justify-self: center;[\s\S]*width: auto;/)
  assert.doesNotMatch(source, /className="appBrand"/)
})

test("窄窗口概览进度条参与卡片高度计算", () => {
  const redesign = readUiCss("overview")
  assert.match(redesign, /align-content: start/)
  assert.match(redesign, /grid-auto-rows: max-content/)
  assert.match(redesign, /\.overviewHero\s*\{[^}]*height:\s*max-content/)
})

test("左侧按钮始终贴边且错题候选显示全部自定义标签", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const css = readUiCss("controls", "shell", "mistakes")
  const previewCss = readUiCss("mistakes")
  const preview = readFileSync(path.join(process.cwd(), "web", "src", "lib", "previewBridge.js"), "utf8")
  assert.match(css, /\.topTools \{[^}]*margin-left: 0;[^}]*margin-right: 0;/)
  assert.match(css, /\.topTools-left \{[^}]*justify-self: start;/)
  assert.match(source, /function manualTagsOf\(record\)/)
  assert.match(source, /manualTagsOf\(item\)/)
  assert.match(source, /className="mistakeItemTags"/)
  assert.match(source, /manualTags\.map\(tag => <em key=\{tag\}>#\{tag\}<\/em>\)/)
  const titleIndex = source.indexOf('className="mistakeTitleRow"')
  const sourceIndex = source.indexOf('className="mistakeSourceLine"', titleIndex)
  const footerIndex = source.indexOf('className={`mistakeItemFooter', sourceIndex)
  assert.ok(titleIndex >= 0 && sourceIndex > titleIndex && footerIndex > sourceIndex, "列表必须按标题、来源、状态信息三行排列")
  assert.match(source, /className="mistakeFavoriteSlot"/)
  assert.match(source, /className="mistakeFavoriteText">已收藏/)
  const reviewIndex = source.indexOf('className={`mistakeReviewState', footerIndex)
  const favoriteIndex = source.indexOf('className="mistakeFavoriteSlot"', footerIndex)
  const tagsIndex = source.indexOf('className="mistakeItemTags"', footerIndex)
  assert.ok(reviewIndex > footerIndex && favoriteIndex > reviewIndex && tagsIndex > favoriteIndex, "第三行必须按剩余天数、收藏状态、自定义标签排列")
  assert.match(previewCss, /\.mistakeTitleRow[\s\S]*grid-template-columns: minmax\(0, 1fr\) 44px/)
  assert.match(previewCss, /\.mistakeItemFooter\.noTags \.mistakeReviewState \{ margin-left: 0/)
  assert.match(css, /\.mistakeItemTags > em/)
  assert.match(preview, /manualCategories: \["概念辨析", "需要重做"\]/)
})

test("批量导出保留次级样式；悬浮条控件免 chrome、选中走统一强调态", () => {
  const controls = readUiCss("controls")
  const mistakes = readUiCss("mistakes", "detail")
  assert.match(controls, /\.batchBar \.batchExport,[\s\S]*?background: var\(--preview-ui-button\);/)
  // beta.65 v5：悬浮条控件不带按钮 chrome（空隔排布），选中走统一强调态
  assert.match(mistakes, /\.detailActionBar > button \{[^}]*border: 0;[^}]*background: transparent;/)
  assert.match(mistakes, /\.detailActionBar > button\.active, \.detailBarDot\.active \{[^}]*background: var\(--rd-accent-tint/)
  assert.doesNotMatch(readUiCss("mistakes", "controls"), /\.detailActionBar/)
  assert.doesNotMatch(mistakes, /\.batchBar \.batchExport\s*\{[^}]*background:\s*var\(--preview-accent/)
})

test("v2.3.3 错题工作区贯通、两类悬浮条统一且大列表跳过离屏布局", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const mistakes = readUiCss("mistakes")
  const detail = readUiCss("detail")
  const shell = readUiCss("shell")
  const review = readUiCss("review")
  const entrance = readFileSync(path.join(process.cwd(), "src", "mnutils-entrance.ts"), "utf8")
  assert.match(shell, /body > #root > \.shell > main \{[\s\S]*?padding: 0;/)
  assert.match(shell, /\.locateHintBanner \{[\s\S]*?position: absolute;[\s\S]*?z-index: 260;/)
  assert.match(mistakes, /\.mistakeWorkspace \.mistakeSidebar \{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/)
  assert.match(mistakes, /\.mistakeWorkspace \.mistakeListBody \{[\s\S]*?height: auto;[\s\S]*?flex: 0 0 auto;[\s\S]*?padding: 4px 8px 10px;[\s\S]*?border: 0;/)
  assert.match(mistakes, /\.mistakeWorkspace \.mistakeDetailSurface::before \{[\s\S]*?top: 0;[\s\S]*?bottom: 0;/)
  assert.match(mistakes, /\.mistakeListHeader[\s\S]*?position: sticky;[\s\S]*?border-radius: 22px;[\s\S]*?backdrop-filter: blur\(18px\)/)
  assert.match(mistakes, /\.mistakeListHeader \.batchBar\.active \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/)
  assert.match(detail, /background: rgba\(250,251,253,\.50\);[\s\S]*?backdrop-filter: blur\(1px\)/)
  assert.match(source, /const MistakeListItem = React\.memo/)
  assert.match(source, /const deferredQuery = React\.useDeferredValue\(query\)/)
  assert.match(mistakes, /content-visibility: auto;/)
  assert.match(source, /function centerTarget\(\)[\s\S]*?maxScrollTop[\s\S]*?jumpHighlightedId/)
  assert.match(review, /\.dueReviewItem\.jumpHighlighted/)
  assert.match(entrance, /const EDGE_MARGIN = 18/)
  assert.doesNotMatch(entrance, /EDGE_PEEK/)
})

test("待复习队列包含真实原题、双重筛选和与预览一致的控件层级", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const css = readUiCss("controls", "review")
  const previewCss = readUiCss("review")
  const preview = readFileSync(path.join(process.cwd(), "web", "src", "lib", "previewBridge.js"), "utf8")
  const pinch = readFileSync(path.join(process.cwd(), "src", "pinch-zoom.ts"), "utf8")
  const questionIndex = source.indexOf('className="reviewQuestion"')
  const actionsIndex = source.indexOf('className="dueReviewActions"')
  const answerIndex = source.indexOf('className="dueAnswer"')
  const historyIndex = source.indexOf('className="reviewHistory"', actionsIndex)
  assert.ok(questionIndex >= 0 && actionsIndex > questionIndex)
  assert.ok(answerIndex >= 0 && historyIndex > actionsIndex)
  assert.match(source, /MNBridge\.send\("mistakeDetail", \{ recordId \}\)/)
  assert.match(source, /MNBridge\.send\("mistakeQuestion", \{ recordId \}\)/)
  assert.match(source, /questionErrorsById/)
  assert.match(source, /retryQuestion/)
  assert.doesNotMatch(source, /let cancelled = false[\s\S]*?const queue = visibleRecords/)
  assert.match(source, /setQuestionsById\(current => \(\{ \.\.\.current, \[recordId\]: question \}\)\)/)
  assert.doesNotMatch(source, /setQuestionsById\(current => retainReviewDetail/)
  const manager = readFileSync(path.join(process.cwd(), "src", "mistake-manager.ts"), "utf8")
  const lightQuestionStart = manager.indexOf("export function mistakeQuestionById")
  const lightQuestionEnd = manager.indexOf("function answerCandidatesForRecord", lightQuestionStart)
  assert.ok(lightQuestionStart >= 0 && lightQuestionEnd > lightQuestionStart)
  assert.doesNotMatch(manager.slice(lightQuestionStart, lightQuestionEnd), /answerCandidatesForRecord|findAnswersForQuestion/)
  assert.match(source, /html=\{detail\.questionHtml\}/)
  assert.match(source, /function ReviewAnswer/)
  assert.match(source, /createReviewDetailCache/)
  assert.match(source, /aria-label="题目分类"/)
  assert.match(source, /className="reviewOverdueTools"/)
  assert.match(source, /\[1, 3, 5\]\.map/)
  assert.match(source, /<DueReviewList[\s\S]*manualTodayIds=\{data\?\.manualTodayIds \|\| \[\]\}/)
  assert.match(source, /action\("addManualTodayOverdue", \{ count \}, false\)/)
  assert.doesNotMatch(source, /setManualTodayIds|readManualTodayIds|writeManualTodayIds/)
  assert.match(source, /function DueReviewList\(\{[^}]*\bfocusRecordId\b[^}]*\}\)/)
  assert.match(css, /\.reviewQuestion/)
  assert.match(css, /\.reviewResults/)
  assert.match(css, /\.reviewList \{[^}]*width: 100%;[^}]*border: 0;/)
  assert.match(css, /\.dueReviewItem \{[^}]*display: block;[^}]*width: 100%;/)
  assert.match(css, /\.dueReviewActions > button \{[^}]*min-height: 31px;/)
  assert.match(previewCss, /\.dueReviewActions \.reviewResults button \{[^}]*height: 31px;[^}]*min-height: 31px;/)
  assert.doesNotMatch(previewCss, /\.dueReviewActions \.reviewResults button \{[^}]*height: 42px;/)
  assert.match(source, /<CardPreview title=\{`\$\{item\.sourceTitle\}完整原题`\}/)
  assert.doesNotMatch(source, /fitReviewFrame|wireReviewAnswerFrame|applyReviewFrameScale/)
  const controller = readFileSync("src/card-preview.ts", "utf8")
  const previewComponent = readFileSync("web/src/CardPreview.jsx", "utf8")
  assert.match(controller, /touchAction = "pan-x pan-y"/)
  assert.match(source, /aria-label="答案缩放"/)
  assert.match(source, /setAnswerZoom\(value => Math\.min\(300, value \+ 10\)\)/)
  assert.match(previewComponent, /onZoom/)
  assert.match(previewComponent, /Math\.max\(300, Math\.min\(520, controller\.naturalHeight\(\)\)\)/)
  assert.match(source, /className="reviewAnswerViewport"/)
  assert.match(previewComponent, /controller\.setScale\(zoom \/ 100\)/)
  assert.match(previewCss, /\.reviewAnswerViewport \{[\s\S]*height: clamp\(340px, 48vh, 520px\)/)
  assert.match(previewCss, /\.reviewAnswerViewport iframe \{[\s\S]*height: 100%;[\s\S]*max-height: none;/)
  assert.match(source, /await MNBridge\.send\("mistakeDetail", \{ recordId \}\)/)
  assert.match(source, /data-level=\{level\}/)
  assert.match(previewCss, /\.reviewHistory ol[\s\S]*overflow: visible/)
  assert.match(previewCss, /\.reviewHistory ol[\s\S]*touch-action: pan-y/)
  assert.doesNotMatch(previewCss, /\.reviewHistory li \{[^}]*touch-action:/)
  // beta.65：pointer capture 守卫收窄到蛇形时间轴组件（悬浮操作条合法使用 setPointerCapture）
  const timelineStart = source.indexOf("function ReviewTimeline")
  const timelineEnd = source.indexOf("function DueReviewList")
  assert.ok(timelineStart >= 0 && timelineEnd > timelineStart)
  const timelineSource = source.slice(timelineStart, timelineEnd)
  assert.doesNotMatch(timelineSource, /TIMELINE_DRAG_THRESHOLD|setPointerCapture|scrollLeft = state\.startScrollLeft/)
  assert.match(source, /function buildSerpentineTimeline/)
  assert.match(source, /const reverse = row % 2 === 1/)
  assert.match(source, /C \$\{edgeX \+ bulge\}/)
  assert.match(source, /markerEnd=\{`url\(#\$\{markerId\}\)`\}/)
  assert.match(source, /aria-label="复测历史蛇形时间轴"/)
  assert.match(previewCss, /\.dueReviewActions \.reviewResults[\s\S]*grid-template-columns: repeat\(3/)
  assert.match(previewCss, /\.dueReviewActions \.reviewResults \{[\s\S]*grid-template-columns: repeat\(3, 86px\);[\s\S]*flex: 0 0 268px;/)
  assert.match(previewCss, /@container review-card \(max-width: 700px\)[\s\S]*\.reviewHistoryText \{ display: none;/)
  assert.match(previewCss, /@container review-card \(max-width: 590px\)[\s\S]*\.reviewAnswerText \{ display: none;/)
  assert.match(previewCss, /@container review-card \(max-width: 500px\)[\s\S]*\.reviewLocateText \{ display: none;/)
  assert.match(pinch, /event\.preventDefault\(\)/)
  assert.match(previewComponent, /wireFramePinchZoom/)
  const card = readFileSync(path.join(process.cwd(), "src", "card-html.ts"), "utf8")
  assert.match(card, /wireFramePinchZoom\.toString\(\)/)
  assert.doesNotMatch(css, /\.dueReviewSummary \{ grid-template-columns: auto minmax\(0,1fr\); \}/)
  assert.match(source, /className="reviewQueueTools"/)
  assert.match(source, /className="questionFoldButton"/)
  assert.match(source, /for \(const item of visibleRecords\) next\[item\.recordId\] = nextOpen/)
  assert.match(preview, /questionHtml: questionHtmlFor\(record\)/)
})

test("三档等级色由唯一 token 同步到图例、进度条和原生侧边卡片", () => {
  const tokens = readFileSync(path.join(process.cwd(), "src", "ui-tokens.ts"), "utf8")
  const controls = readUiCss("controls")
  const toolbar = readFileSync(path.join(process.cwd(), "src", "floating-toolbar.ts"), "utf8")
  assert.match(tokens, /level0: "#ff453a"/)
  assert.match(tokens, /level1: "#ff9f0a"/)
  assert.match(tokens, /level2: "#30d158"/)
  assert.match(controls, /\.previewProgressLegend i\.level0 \{\s*background: var\(--mn-level-0\);/)
  assert.match(controls, /\.previewProgressLegend i\.level1 \{\s*background: var\(--mn-level-1\);/)
  assert.match(controls, /\.previewProgressLegend i\.level2 \{\s*background: var\(--mn-level-2\);/)
  assert.match(controls, /\.previewProgressTrack > i\.level0 \{\s*background: var\(--mn-level-0\);/)
  assert.match(controls, /\.previewProgressTrack > i\.level1 \{\s*background: var\(--mn-level-1\);/)
  assert.match(controls, /\.previewProgressTrack > i\.level2 \{\s*background: var\(--mn-level-2\);/)
  assert.match(toolbar, /\["不会", UI_COLORS\.level0/)
  assert.match(toolbar, /\["不熟", UI_COLORS\.level1/)
  assert.match(toolbar, /\["掌握", UI_COLORS\.level2/)
})

test("收藏 Morphicons 使用 vanilla lucide IconNode，刷新与进度条遵循最新交互", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  assert.match(source, /import \{ Check, Star, X, [^}]+\} from "lucide"/)
  assert.match(source, /createMorph\(pathRef\.current, Star/)
  assert.match(source, /morph\?\.morphTo\(favorite \? X : Check/)
  assert.doesNotMatch(source, /favoriteStarPath|favoriteCheckPath|favoriteXPath/)
  assert.match(source, /async function refreshPanel\(\)[\s\S]*resetPanelFrame[\s\S]*await load\(\)/)
  assert.match(source, /filter\(item => item\.count > 0\)/)
  assert.match(source, /from="checkbox" to="checkboxChecked"/)
  assert.match(source, /className="reviewDaySummary"/)
  for (const retired of ["ui-redesign.js", "ui-alignment.js", "preview-bootstrap.js"]) {
    assert.equal(existsSync(path.join(process.cwd(), "web", "src", retired)), false)
    assert.doesNotMatch(source, new RegExp(retired.replace(".", "\\.")))
  }
})

test("待复习页签角标使用今日待复测数量", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const manager = readFileSync(path.join(process.cwd(), "src", "mistake-manager.ts"), "utf8")
  assert.match(source, /\["review", "待复习", data\?\.mistakes\?\.todayDueCount \|\| 0\]/)
  assert.match(manager, /todayDueCount:[\s\S]*dueAt >= startToday && dueAt < endToday/)
})

test("PDF 预览请求即时终账任务槽，不残留 rendering 幽灵任务", () => {
  const source = readFileSync(path.join(process.cwd(), "rails-native", "WebBridgeCommands.js"), "utf8")
  const resolveBody = source.match(/resolve: function \(value\) \{[\s\S]*?\n        \},/)?.[0] || ""
  assert.match(resolveBody, /if \(isPreview\) \{[\s\S]*?controller\.exportPdfTask = null;/)
  const rejectBody = source.match(/reject: function \(error\) \{[\s\S]*?\n        \}/)?.[0] || ""
  assert.match(rejectBody, /if \(isPreview\) controller\.exportPdfTask = null;/)
  // 预览与正式导出共用互斥：任何活动任务都拒绝新请求，旧版残留的预览幽灵任务直接丢弃
  assert.match(source, /active\.preview && \(active\.status === "rendering" \|\| active\.status === "saving"\)/)
  assert.match(source, /已有 PDF 导出任务进行中/)
})

test("PDF 初始化失败释放 WebView、定时器并终账任务", () => {
  const source = readFileSync(path.join(process.cwd(), "rails-native", "WebBridgeCommands.js"), "utf8")
  const render = source.match(/function renderPdf\([\s\S]*?\n  \}/)?.[0] || ""
  assert.match(render, /try \{[\s\S]*?new UIWebView[\s\S]*?stagePdfRenderPage[\s\S]*?\} catch \(error\) \{[\s\S]*?rejectPdfRequest\(controller, error\)/)
})

test("PDF 数据传输阶段有独立看门狗且分块前重置", () => {
  const source = readFileSync(path.join(process.cwd(), "rails-native", "WebBridgeCommands.js"), "utf8")
  assert.match(source, /function startPdfTransferTimer/)
  assert.match(source, /PDF 数据传输超时/)
  assert.match(source, /startPdfTransferTimer\(controller\);\s*webView\.evaluateJavaScript\("window\.__MN_PDF_EXPORT_TAKE_CHUNK__/)
  assert.match(source, /startPdfTransferTimer\(controller\);\s*webView\.evaluateJavaScript\("window\.__MN_PDF_EXPORT_TAKE_PREVIEW_CHUNK__/)
})

test("前端轮询容忍桥接瞬时错误，且不把预览任务当在途导出恢复", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  const poll = source.match(/function pollPdfTask\([\s\S]*?\n  \}/)?.[0] || ""
  assert.match(poll, /MNBridge\.send\("pdfTaskStatus"/)
  assert.match(poll, /failures \+= 1/)
  assert.doesNotMatch(poll, /await action\("pdfTaskStatus"/)
  const resume = source.match(/面板重开后恢复在途任务[\s\S]*?\}, \[\]\)/)?.[0] || ""
  assert.match(resume, /!status\.preview/)
})

test("所有定位原题入口使用 Morphicons map-pin→check 形变图标并延时还原", () => {
  const source = readFileSync(path.join(process.cwd(), "web", "src", "main.jsx"), "utf8")
  assert.doesNotMatch(source, /function TargetIcon/)
  assert.match(source, /import \{ createMorph \} from "morphicons\/dom"/)
  assert.match(source, /const locateMapPinIcon = \[/)
  assert.match(source, /M20 10c0 5-5\.5 11\.5-7\.4 13\.5/)
  assert.match(source, /const locateCheckIcon = \[\["path", \{ d: "M5 12l4 4L19 6" \}]]/)
  assert.match(source, /function LocateButton\(\{ locateKey, className = "", onLocate, onWaiting, children, settingsIcon = false, ariaLabel \}\)/)
  assert.match(source, /const morph = createMorph\(pathRef\.current, locateMapPinIcon, \{ reducedMotion: "user" \}\)/)
  assert.match(source, /morph\.morphTo\(locateCheckIcon, "snappy"\)/)
  assert.match(source, /morphRef\.current\.morphTo\(locateMapPinIcon, "smooth"\)/)
  assert.match(source, /setTimeout\(\(\) => \{ morphRef\.current\?\.morphTo\(locateMapPinIcon, "smooth"\); setActive\(false\) \}, LOCATE_REVERT_MS\)/)
  // 重挂载续期：还原窗口内重挂以对号状态起步，避免面板刷新导致对勾闪断
  assert.match(source, /const locateTimes = \(\(\) => \{/)
  assert.match(source, /sessionStorage\.setItem\(LOCATE_TIMES_KEY, JSON\.stringify\(Object\.fromEntries\(locateTimes\)\)\)/)
  assert.match(source, /if \(locatedAt && since >= 0 && since < LOCATE_REVERT_MS\) \{[\s\S]*?morph\.set\(locateCheckIcon\)/)
  assert.match(source, /<LocateButton className="reviewLocateAction" locateKey=\{`mistake:\$\{item\.recordId\}`\} onWaiting=[\s\S]*?onLocate=\{async \(\) => \{[\s\S]*?action\("openSource", \{ recordId: item\.recordId \}, false\)[\s\S]*?locateHint[\s\S]*?reviewLocateText">定位原题<\/span><\/LocateButton>/)
  // 设置页定位行已改静态 SF tile：不再存在 icon === "locate" 的 LocateButton 特例
  assert.doesNotMatch(source, /icon === "locate"/)
  assert.match(source, /<LocateButton locateKey=\{`mistake:\$\{detail\.record\.recordId\}`\} className="preview-locate-button" onWaiting=/)

  const css = readUiCss("controls", "review")
  assert.match(css, /\.dueReviewActions > button \.preview-target-icon \{[\s\S]*?width: 14px;[\s\S]*?height: 14px;[\s\S]*?flex-basis: 14px;/)
})
