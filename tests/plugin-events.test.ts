import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

test("关闭侧边按钮只持久化设置并隐藏当前工具栏，重新开启不创建第二套 UI", () => {
  const source = readFileSync("src/card-toolbar-state.ts", "utf8")
  const fn = source.match(/export function setCardToolbarEnabled[\s\S]*?\n\}/)?.[0]
  assert.ok(fn)
  const writes: boolean[] = [], hides: string[] = []
  const context: any = {
    exports: {},
    saveMatcherSettings: (value: any) => writes.push(value.cardToolbarEnabled),
    hideAnswerToolbar: () => hides.push("toolbar")
  }
  runInNewContext(transpileModule(fn, { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  const addon = { answerToolbar: {} }
  assert.equal(context.exports.setCardToolbarEnabled(false, addon).enabled, false)
  assert.equal(context.exports.setCardToolbarEnabled(true, addon).enabled, true)
  assert.deepEqual(writes, [false, true])
  assert.deepEqual(hides, ["toolbar"])
})

test("选择卡片触发相同布局时，不重复赋面板 frame 或重置根滚动", () => {
  const source = readFileSync("rails-native/WebPanelController.js", "utf8")
  const body = source.match(/function ensureLayout\(controller\) \{([\s\S]*?)\n  \}/)?.[1]
  assert.ok(body)
  let assignments = 0
  let frame = { x: 16, y: 16, width: 720, height: 560 }
  const controller = { sessionFrame: { ...frame }, view: {
    hidden: false,
    get frame() { return frame },
    set frame(value) { assignments++; frame = value }
  } }
  const host = { bounds: { width: 1024, height: 768 } }
  const layout = new Function("controller", "savedFrame", "layoutCloseButton", "panelCloseButtonSide", "lockWebViewRootScroll", "panelHost", body!)
  const run = () => layout(controller, () => controller.sessionFrame, () => {}, () => "left", () => {}, () => host)
  run(); run()
  assert.equal(assignments, 0)
  controller.sessionFrame = { ...frame, width: 680 }
  run()
  assert.equal(assignments, 0, "宿主未变，不响应选卡期间临时尺寸")
  host.bounds.width = 800
  run()
  assert.equal(assignments, 1)
})

test("转正式版后首次启动明确提醒不能与 Beta 版共存", () => {
  const source = readFileSync("src/plugin.ts", "utf8")
  const build = readFileSync("build.mjs", "utf8")
  assert.match(source, /async function remindFormalBetaConflict/)
  // 渠道与版本号解耦：正式项目内 2.3.3-beta.N 版本号仍触发共存提醒
  assert.match(source, /if \(__MN_CHANNEL__ !== "stable"\) return/)
  assert.match(source, /__MN_CHANNEL__ === "beta" \? "cardlink-beta" : "cardlink"/)
  assert.match(build, /const betaChannel = pkg\.mnChannel === "beta"/)
  assert.match(source, /正式版不能与 Beta 版同时启用/)
  assert.match(source, /关闭或卸载.*Beta/)
  assert.match(source, /FORMAL_BETA_CONFLICT_NOTICE_KEY/)
  assert.match(source, /void remindFormalBetaConflict\(\)/)
})

test("切换卡片时旧 close 事件不会隐藏新卡片工具栏", () => {
  const source = readFileSync("src/plugin.ts", "utf8")
  assert.match(source, /const shownAt = self\.answerToolbarShownAt/)
  assert.match(source, /await delay\(0\.15\)/)
  assert.match(source, /if \(shownAt !== self\.answerToolbarShownAt\) return/)
  assert.match(source, /PopupMenu\.currentMenu\(\)/)
  assert.match(source, /menu\?\.visible/)
  assert.match(source, /samePopupTarget\(expectedTarget, menu\.targetWinRect\)/)
  assert.match(source, /if \(isCurrentNotePopupStillVisible\(\)\) return/)
  assert.match(source, /hideAnswerToolbar\(\)/)
})

test("标签恢复已迁移为手动触发：生命周期不再自动调度，仅随刷新错题分类索引执行", () => {
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const manager = readFileSync("src/mistake-manager.ts", "utf8")
  // 生命周期与调度器全部退役
  assert.doesNotMatch(plugin, /scheduleMistakeTagRecovery/)
  assert.doesNotMatch(manager, /scheduleMistakeTagRecovery|FULL_TAG_RECOVERY_INTERVAL|scheduledRecoveryTokens/)
  // 手动入口：repair 内全量强制恢复（串行队列保留）
  assert.match(manager, /const tagScan = await recoverMistakesFromTags\(\)/)
  assert.match(manager, /let tagRecoveryQueue: Promise<void> = Promise\.resolve\(\)/)
  // HUD 收录标签收编数
  assert.match(manager, /新收编 \$\{tagScan\.added\} 道/)
})

test("卡片弹窗关闭后不再用残留选中节点阻止侧边工具栏隐藏", () => {
  const source = readFileSync("src/plugin.ts", "utf8")
  const start = source.indexOf("async onClosePopupMenuOnNote()")
  const end = source.indexOf("export function queryAddonCommandStatus", start)
  const handler = source.slice(start, end)
  assert.doesNotMatch(handler, /NodeNote\.getSelectedNodes\(\)/)
  assert.doesNotMatch(handler, /selectedNodes\?\.length/)
  assert.match(handler, /hideAnswerToolbar\(\)/)
})

test("错题迁移 Web 弹窗接受后跨版本不再提示，取消后重新倒计时", () => {
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const manager = readFileSync("src/mistake-manager.ts", "utf8")
  const webAddon = readFileSync("rails-native/WebAddon.js", "utf8")
  const core = readFileSync("src/rails-core.ts", "utf8")
  const web = readFileSync("web/src/main.jsx", "utf8")
  const sceneStart = plugin.indexOf("sceneWillConnect()")
  const sceneEnd = plugin.indexOf("notebookWillOpen", sceneStart)
  assert.doesNotMatch(plugin.slice(sceneStart, sceneEnd), /legacyMistakeTagMigrationCount|prepareMistakeMigrationForPanelOpen/)
  assert.doesNotMatch(webAddon, /toggleWebPanel[\s\S]{0,500}prepareMistakeMigrationForPanelOpen/)
  assert.match(core, /mistakeRefreshConsentRequired: !legacyMistakeTagMigrationCompleted\(\)/)
  assert.match(core, /acceptMistakeRefreshConsent[\s\S]*repairAndOrganizeMistakes\(\)[\s\S]*rememberLegacyMistakeTagMigration\(\)/)
  assert.match(web, /function MistakeRefreshConsent/)
  assert.match(web, /useState\(10\)/)
  assert.match(manager, /mistake-level-refresh\.accepted\.v1/)
  assert.match(web, /接受刷新（\$\{seconds\} 秒）/)
  assert.match(web, /disabled=\{seconds > 0 \|\| accepting\}/)
  assert.match(web, /key=\{consentAttempt\}/)
  assert.match(web, /setConsentAttempt\(value => value \+ 1\)/)
  assert.match(web, />迁移提示</)
  assert.match(web, /0–1级[\s\S]*level level0[\s\S]*不会/)
  assert.match(manager, /legacyMistakeTagMigrationCompleted/)
  assert.match(manager, /rememberLegacyMistakeTagMigration\(\)/)
})

test("侧边错题按钮使用原生三级下拉而不是直接打开等级弹窗", () => {
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const toolbar = readFileSync("src/floating-toolbar.ts", "utf8")
  assert.match(plugin, /onMistakeToolbarClick[\s\S]*toggleMistakeLevelDropdown\(\)/)
  assert.match(toolbar, /onMistakeLevel0Click:/)
  assert.match(toolbar, /onMistakeLevel1Click:/)
  assert.match(toolbar, /onMistakeLevel2Click:/)
})

test("错题标记排除同学习集另一脑图残留选中的答案卡片", () => {
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const manager = readFileSync("src/mistake-manager.ts", "utf8")
  assert.match(plugin, /selectedMistakeQuestions\(notebookId: string\)/)
  assert.match(plugin, /filterSelectionToAnchorGroup\(/)
  assert.match(plugin, /findAnswerByReference\(answerTarget, noteId, nodeIdentifier\(node\)\)/)
  assert.match(plugin, /const questions = notebookId \? selectedMistakeQuestions\(notebookId\) : \[\]/)
  assert.match(manager, /answerOnlyBindingScopes\(loadBindings\(\)\)/)
  assert.doesNotMatch(manager, /scanBoundAnswerRecordKeys/)
  assert.doesNotMatch(manager, /recoverBeta12ReversedMistakes/)
  assert.match(manager, /archiveMistakeRecords\(archived\)/)
  assert.match(plugin, /answerOnlyScopes\.has\(notebookId\)/)
})

test("面板可见性变化的三条路径都必须调用 refreshAddonCommands（图标选中态同步）", () => {
  const commands = readFileSync("rails-native/WebBridgeCommands.js", "utf8")
  const addon = readFileSync("rails-native/WebAddon.js", "utf8")
  const closeBody = commands.slice(commands.indexOf('command === "closePanel"'), commands.indexOf("closed: true"))
  assert.match(closeBody, /refreshAddonCommands\(\)/)
  // notebookWillOpen 恢复面板 / notebookWillClose 隐藏面板
  const openBody = addon.slice(addon.indexOf("notebookWillOpen"), addon.indexOf("notebookWillClose"))
  assert.match(openBody, /refreshAddonCommands\(\)/)
  const closeAddonBody = addon.slice(addon.indexOf("notebookWillClose"), addon.indexOf("sceneDidDisconnect"))
  assert.match(closeAddonBody, /refreshAddonCommands\(\)/)
  // toggleWebPanel 原有刷新保留
  assert.match(addon, /toggleWebPanel[\s\S]*refreshAddonCommands\(\)/)
})

test("MN Utils 可用时使用 MNButton 创建带插件图标的第二入口", () => {
  const entrance = readFileSync("src/mnutils-entrance.ts", "utf8")
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const core = readFileSync("src/rails-core.ts", "utf8")
  const addon = readFileSync("rails-native/WebAddon.js", "utf8")
  const panel = readFileSync("rails-native/WebPanelController.js", "utf8")
  const colors = readFileSync("src/ui-tokens.ts", "utf8")
  assert.match(entrance, /typeof MNButton !== "undefined"/)
  assert.match(entrance, /MNButton\.new\(/)
  assert.match(entrance, /button\.setImage\(`\$\{self\.mainPath\}\/logo\.png`, 2\)/)
  assert.match(entrance, /button\.addClickAction\(self, "onMnutilsEntranceClick:"\)/)
  assert.match(entrance, /button\.addPanGesture\(self, "onMnutilsEntrancePan:"\)/)
  assert.match(entrance, /MNButton\.addLongPressGesture\(button\.button \?\? button, self, "onMnutilsEntranceLongPress:", 1\)/)
  assert.match(entrance, /color: UI_COLORS\.grayFill[\s\S]*?alpha: 0\.72/)
  assert.match(colors, /accent: "#0e8dfd"/)
  assert.match(colors, /grayFill: "#d8d8dd"/)
  assert.doesNotMatch(entrance, /if \(!MNUtil\.mindmapView\) return/)
  assert.match(entrance, /button\.button\.alpha = 0\.72/)
  assert.match(entrance, /resetAnswerCardPosition\(\)/)
  // beta.69：删除单击专属的自绘菜单，直接复用稳定的面板显隐入口。
  assert.match(entrance, /panel\.isVisible\?\.\(controller\)/)
  assert.match(entrance, /panel\.hidePanel\(controller, true\)/)
  assert.match(entrance, /panel\.showPanel\(controller\)/)
  // v64 长按复位缺陷修复：面板不可见不再阻断答案窗口复位（两个窗口分别判断）
  assert.doesNotMatch(entrance, /isVisible\(controller\)\)\s*\{\s*\n\s*return/)
  assert.match(entrance, /controller && controller\.webView/)
  assert.match(entrance, /__MNAM_WEB_PANEL_GLOBAL__\.resetFrame\(controller\)/)
  assert.doesNotMatch(entrance, /resetAndShowPanel\(controller\)/)
  assert.doesNotMatch(entrance, /controller\.addon\.window =/)
  assert.doesNotMatch(entrance, /layer\.shadowColor/)
  assert.match(entrance, /studyController\(self\.window\)/)
  assert.match(entrance, /self\.answerCardView && !self\.answerCardView\.hidden && self\.answerCardView\.superview/)
  assert.match(entrance, /sender\.locationInView/)
  assert.match(entrance, /function nearestDock/)
  assert.match(entrance, /MNUtil\.animate\(update\)/)
  assert.match(plugin, /notebookWillOpen[\s\S]*ensureMnutilsEntrance\(\)/)
  assert.match(plugin, /sceneDidDisconnect[\s\S]*removeMnutilsEntrance\(\)/)
  assert.match(core, /onMnutilsEntranceClick[\s\S]*onMnutilsEntranceLongPress[\s\S]*onMnutilsEntrancePan/)
  assert.match(plugin, /export \{ ensureMnutilsEntrance, onMnutilsEntranceClick, onMnutilsEntranceLongPress, onMnutilsEntrancePan \}/)
  assert.match(addon, /controllerWillLayoutSubviews[\s\S]*call\(core\.instanceMethods, "ensureMnutilsEntrance"\)/)
})

test("答案窗口刷新按钮同时复位位置尺寸并重新载入当前答案", () => {
  const view = readFileSync("src/answer-card-view.ts", "utf8")
  const controls = readFileSync("src/window-controls.ts", "utf8")
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const main = readFileSync("src/main.ts", "utf8")
  assert.match(view, /onRefreshAnswerCard:/)
  assert.match(view, /createWindowControlButton\("↻", "onRefreshAnswerCard:"\)/)
  assert.match(controls, /export function answerControlBarLayout/)
  assert.match(controls, /export function createWindowControlButton/)
  assert.match(view, /self\.answerCardHtml = html/)
  assert.match(view, /export function refreshAnswerCard\(\)[\s\S]*resetAnswerCardPosition\(\)[\s\S]*loadHTMLStringBaseURL\(self\.answerCardHtml, null\)/)
  assert.match(plugin, /export function onRefreshAnswerCard/)
  assert.match(main, /onRefreshAnswerCard/)
})

test("答案窗口关闭、刷新与候选按钮共用连续胶囊规格", () => {
  const view = readFileSync("src/answer-card-view.ts", "utf8")
  const controls = readFileSync("src/window-controls.ts", "utf8")
  assert.match(view, /createWindowControlButton\("✕", "onCloseAnswerCard:"\)/)
  assert.match(view, /createWindowControlButton\("↻", "onRefreshAnswerCard:"\)/)
  assert.match(view, /createWindowControlButton\("", "onChooseAnswerCandidate:", true\)/)
  assert.match(controls, /ANSWER_BAR_CONTROL_WIDTH = 44/)
  assert.match(controls, /ANSWER_BAR_HEIGHT = 36/)
  assert.match(controls, /const barWidth = count \* ANSWER_BAR_CONTROL_WIDTH/)
  assert.match(controls, /button\.layer\.cornerRadius = 0/)
  assert.match(controls, /onAnswerControlPress:/)
  assert.match(controls, /onAnswerControlRelease:/)
  assert.match(controls, /titleEdgeInsets = \{ top: 0, left: 0, bottom: 0, right: 0 \}/)
})

test("答案窗口三控件合并为可左右换边的悬浮条，候选复用原生弹窗", () => {
  const view = readFileSync("src/answer-card-view.ts", "utf8")
  const controls = readFileSync("src/window-controls.ts", "utf8")
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const core = readFileSync("src/rails-core.ts", "utf8")
  const matcher = readFileSync("src/matcher.ts", "utf8")
  const domain = readFileSync("src/domain.ts", "utf8")
  // 三个控件位于共享半透明悬浮条内，候选仅在多答案时显示。
  assert.match(view, /createWindowControlButton\("", "onChooseAnswerCandidate:", true\)/)
  assert.match(controls, /button\.addTargetActionForControlEvents\(self, action, 1 << 6\)/)
  assert.match(view, /const controlBar = new UIView/)
  assert.match(view, /controlBar\.backgroundColor = UIColor\.colorWithHexString\("#fcfcfd"\)\.colorWithAlphaComponent\(0\.96\)/)
  assert.match(view, /controlBar\.addSubview\(closeButton\)[\s\S]*controlBar\.addSubview\(refreshButton\)[\s\S]*controlBar\.addSubview\(candidatesButton\)/)
  assert.match(view, /self\.answerCardControlBar = controlBar/)
  assert.match(view, /self\.answerCandidatesButton = candidatesButton/)
  assert.match(view, /export function syncAnswerCandidatesControl/)
  assert.match(view, /if \(count < 2\) \{[\s\S]*?answerCandidatesButton\.hidden = true/)
  // 悬浮条整体跟随关闭按钮位置设置；右侧时控件顺序镜像。
  assert.match(view, /answerControlBarLayout\(width, side, candidatesVisible\)/)
  assert.match(controls, /close: slot\(left \? 0 : count - 1\)/)
  assert.match(controls, /candidates: slot\(left \? 2 : 0\)/)
  assert.match(view, /setTitleForState\(String\(safeIndex \+ 1\), 0\)/)
  // 选择器与切换逻辑：路径、标准答案标记、正文摘要和弹窗文案沿用 beta.61。
  assert.match(plugin, /export async function onChooseAnswerCandidate/)
  assert.match(plugin, /\[\.\.\.candidate\.pathTitles\]\.reverse\(\)\.join\(" \/ "\)/)
  assert.match(plugin, /answerText\(candidate\)\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 42\)/)
  assert.match(plugin, /`找到 \$\{candidates\.length\} 个答案`/)
  assert.match(plugin, /"请选择要展示的答案卡片"/)
  assert.match(core, /instanceMethods:[\s\S]*onChooseAnswerCandidate/)
  assert.match(plugin, /showAnswerCard\(answerCardHtml\(answer, questionTitle\)\)/)
  // 候选数按答案卡去重；路径唯一胜出或唯一标准答案时不再显示候选。
  assert.match(domain, /export function distinctAnswers[\s\S]*answer\.noteId \|\| answer\.id/)
  assert.match(domain, /topScore > 0 && tiedTop\.length === 1/)
  assert.match(domain, /standardTop\.length === 1 \? \[\] : distinct/)
  assert.match(plugin, /answerCandidatesForDisplay\(matches, resolved\.path\)/)
  // 自绘下拉和卡片内 HTML 候选条均已退役。
  assert.doesNotMatch(view, /answerCandidatesDropdown|answerCardCandidateButtons|CANDIDATE_ROW_HEIGHT/)
  assert.doesNotMatch(matcher, /candidateBarHtml|AnswerCandidateOption/)
  assert.doesNotMatch(core, /switchAnswerCandidate/)
})

test("答案窗口胶囊按压驱动整体果冻回弹并尊重减弱动态", () => {
  const view = readFileSync("src/answer-card-view.ts", "utf8")
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const core = readFileSync("src/rails-core.ts", "utf8")
  assert.match(view, /export function onAnswerControlPress/)
  assert.match(view, /animateAnswerControlJelly\(0\.94, 1\.08\)/)
  assert.match(view, /animateAnswerControlJelly\(1\.04, 0\.96\)/)
  assert.match(view, /animateAnswerControlJelly\(0\.985, 1\.02\)/)
  assert.match(view, /isReduceMotionEnabled/)
  assert.match(plugin, /onAnswerControlPress, onAnswerControlRelease/)
  assert.match(core, /onAnswerControlPress[\s\S]*onAnswerControlRelease/)
})

test("关闭按钮位置设置即时同步答案窗口且不会创建、显示或复位窗口", () => {
  const view = readFileSync("src/answer-card-view.ts", "utf8")
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const core = readFileSync("src/rails-core.ts", "utf8")
  const panel = readFileSync("rails-native/WebPanelController.js", "utf8")
  assert.match(view, /export function syncAnswerCardWindowControlSide[\s\S]*if \(!self\.answerCardView\) return[\s\S]*layoutAnswerCardWindowControls/)
  assert.doesNotMatch(view.match(/export function syncAnswerCardWindowControlSide[\s\S]*?\n\}/)?.[0] || "", /hidden = false|addSubview|resetAnswerCardPosition/)
  assert.match(plugin, /export function onPanelCloseButtonSideChanged[\s\S]*syncAnswerCardWindowControlSide/)
  assert.match(core, /instanceMethods:[\s\S]*onPanelCloseButtonSideChanged/)
  assert.match(panel, /setCloseButtonSide[\s\S]*onPanelCloseButtonSideChanged\(normalized\)/)
})

test("原题跳转：以真实焦点为成功判据，官方聚焦失败后才恢复 UI 状态", () => {
  const navigation = readFileSync("src/note-navigation.ts", "utf8")
  const manager = readFileSync("src/mistake-manager.ts", "utf8")
  const web = readFileSync("web/src/main.jsx", "utf8")
  assert.match(navigation, /function focusNoteInMindmapByOfficialApi\(noteId: string\)/)
  assert.match(navigation, /MN\.studyController\.focusNoteInMindMapById\(noteId\)/)
  assert.match(navigation, /function bookToMindMapSyncState\(\): SyncStateProbe/)
  assert.match(navigation, /MNCommand\.canSyncBookToMindMap\(\)/)
  assert.match(navigation, /if \(result === "focused"\) \{[\s\S]*?clearPendingNavigation/)
  assert.match(navigation, /result === "sync-off" \? LOCATE_SYNC_OFF_HINT : LOCATE_TIMEOUT_HINT/)
  assert.match(navigation, /跳转失败，请检查脑图文档同步模式/)
  assert.match(navigation, /const hint = await locateJumpInCurrentStudySet\(target\.noteId, target\.runId\)[\s\S]*?mn4PendingLocateHint = hint/)
  assert.match(navigation, /openNoteInMindMap\(noteId: string, notebookId\?: string\): Promise<string \| undefined>/)
  assert.match(manager, /openSourceByMistakeId\(recordId: string\): Promise<\{ locateHint\?: string \}>/)
  assert.match(web, /<MistakeBrowser[\s\S]*showLocateHint=\{showLocateHint\}/)
  assert.match(web, /<DueReviewList[\s\S]*showLocateHint=\{showLocateHint\}/)
  assert.match(web, /function DueReviewList\(\{ records, reviewCurves, action, manualTodayIds, setManualTodayIds, showLocateHint, focusRecordId \}\)/)
  assert.match(navigation, /setUIStatusByConfigAsync/)
  assert.match(navigation, /selectNotesInMindmap/)
  assert.doesNotMatch(navigation, /retryPendingNavigation|focusPendingNote/)
})

test("跨学习集只派发官方链接，前台等待与 notebookWillOpen 接力共用同一聚焦入口", () => {
  const navigation = readFileSync("src/note-navigation.ts", "utf8")
  assert.match(navigation, /跨学习集，派发唯一官方 openURL=/)
  assert.match(navigation, /已确认切换到目标学习集/)
  assert.match(navigation, /PENDING_NAVIGATION_MAX_AGE_MS = 30_000/)
  assert.match(navigation, /从跨学习集接力记录恢复定位/)
  assert.match(navigation, /忽略非目标学习集/)
  assert.match(navigation, /const hint = await locateJumpInCurrentStudySet\(target\.noteId, target\.runId\)/)
})

test("卡片侧边按钮开关持久化且不再关闭全局后台服务", () => {
  const addon = readFileSync("rails-native/WebAddon.js", "utf8")
  const core = readFileSync("src/rails-core.ts", "utf8")
  const state = readFileSync("src/card-toolbar-state.ts", "utf8")
  const bridge = readFileSync("rails-native/WebBridgeCommands.js", "utf8")
  const panel = readFileSync("rails-native/WebPanelController.js", "utf8")
  const entrance = readFileSync("src/mnutils-entrance.ts", "utf8")
  const navigation = readFileSync("src/note-navigation.ts", "utf8")
  const settings = readFileSync("src/settings.ts", "utf8")
  assert.match(settings, /cardToolbarEnabled: value\?\.cardToolbarEnabled !== false/)
  assert.doesNotMatch(addon, /GLOBAL_ENABLED_KEY|mnAnswerMatcherPluginEnabled|runtimeControl/)
  // 状态由普通 JS 服务拥有，不暴露 JSExtension 自定义 boolean selector。
  assert.doesNotMatch(addon, /methods\.(?:set|is)PluginEnabled = function/)
  assert.match(core, /cardToolbar: \{ isEnabled: isCardToolbarEnabled, setEnabled: setCardToolbarEnabled \}/)
  assert.match(state, /saveMatcherSettings\(\{ cardToolbarEnabled: next \}\)/)
  assert.match(bridge, /cardToolbar\.setEnabled\([\s\S]*context\.addon\)/)
  assert.doesNotMatch(core, /export const runtimeControl/)
  // Bridge：dashboard 附加 pluginEnabled；设置页经 setPluginEnabled 命令改状态
  assert.match(bridge, /command === "setPluginEnabled"/)
  assert.match(bridge, /value\.matching\.pluginEnabled = context\.pluginEnabled\(\)/)
  // PanelController 仍给设置页提供同一套持久化和布局函数。
  assert.match(panel, /panelCloseButtonSide: panelCloseButtonSide/)
  assert.match(panel, /setPanelCloseButtonSide: setCloseButtonSide/)
  // 跨学习集定位跳转：跳过面板恢复时的自动刷新（跳转不改变错题数据）
  assert.match(navigation, /self\.mn4LocateJumpStartedAtMs = Date\.now\(\)/)
  assert.match(addon, /methods\.shouldSuppressPanelReload = function/)
  assert.match(panel, /window\.__onPanelShow&&window\.__onPanelShow\(" \+ \(skipReload \? "true" : "false"\)/)
  assert.doesNotMatch(entrance, /CardLink 快捷设置|addEntranceMenuRow|onEntranceQuickMenu/)
  assert.match(entrance, /if \(panel\.isVisible\?\.\(controller\)\) panel\.hidePanel\(controller, true\)/)
})
