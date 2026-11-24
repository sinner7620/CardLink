import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import assert from "node:assert/strict"

/**
 * 桥协议 schema 测试（P4-1）：
 * 此前 web 端命令与 rails-core 原生处理的对应关系完全靠人工核对，
 * 本测试自动提取两端命令集合并断言一致，命令漂移（拼写错误、漏实现）会直接红灯。
 */

function extract(source: string, pattern: RegExp): Set<string> {
  return new Set(Array.from(source.matchAll(pattern), match => match[1]))
}

const panelController = readFileSync("rails-native/WebPanelController.js", "utf8")
const mock = readFileSync("web/src/lib/previewBridge.js", "utf8")

/**
 * web 侧发送点分散在面板入口、原生桥客户端、Harness 客户端和场景入口里，
 * 按整个 web 目录收集。独立手写脚本（plugin-ink.js、answer-ink.js）、预览 mock 和第三方源码
 * 不构成桥协议请求方，排除。
 */
const SEND_SCAN_EXCLUDES = new Set(["node_modules", "web-dist", "dist", "vendor", "plugin-ink.js", "answer-ink.js", "previewBridge.js"])

function sendSources(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SEND_SCAN_EXCLUDES.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) sendSources(absolute, collected)
    else if (/\.(js|jsx|ts|tsx|mjs)$/.test(entry.name)) collected.push(absolute)
  }
  return collected
}

function webSentCommands(): Set<string> {
  const sent = new Set<string>()
  for (const file of sendSources("web")) {
    for (const match of readFileSync(file, "utf8").matchAll(/(?<![\w$])(?:action|send|harnessSend)\(\s*["']([\w.]+)["']/g)) {
      if (!match[1].startsWith("__")) sent.add(match[1])
    }
  }
  return sent
}

/**
 * 原生命令有多处分发：rails-core（插件核心）、Harness 设备运行时、
 * OCR 与 FSRS 服务、卡片菜单，以及 WebBridgeCommands（面板窗口自身命令）。
 * 分发既用 `command === "x"`，也用枚举成员 `.includes(command)` 。
 */
const NATIVE_DISPATCH_SOURCES = [
  "src/rails-core.ts",
  "src/harness/runtime.ts",
  "src/ocr-service.ts",
  "src/ocr-settings.ts",
  "src/fsrs-service.ts",
  "src/card-menu.ts",
  "src/plugin.ts",
  "rails-native/WebBridgeCommands.js"
]

function nativeHandledCommands(): Set<string> {
  const handled = new Set<string>()
  for (const file of NATIVE_DISPATCH_SOURCES) {
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(/command\s*===\s*["']([\w.]+)["']/g)) handled.add(match[1])
    for (const match of source.matchAll(/\[([^\]]*?)\]\.includes\(command\)/g)) {
      for (const item of match[1].matchAll(/["'](\w+)["']/g)) handled.add(item[1])
    }
  }
  return handled
}

/** Harness 命令面（`harness.*`）由 cardlink-harness 桥处理，web 经 harnessCall 转发。 */
const HARNESS_DISPATCH = "cardlink-harness/src/adapters/bridge/commands.ts"
const harnessHandled = extract(readFileSync(HARNESS_DISPATCH, "utf8"), /\bcase\s+["']([\w.]+)["']\s*:/g)

const nativeHandled = nativeHandledCommands()
const handled = new Set([...nativeHandled, ...harnessHandled])
const sent = webSentCommands()

test("web 端发送的每个桥命令都有原生处理", () => {
  assert.ok(sent.size >= 30, `应能从 web 源码提取到足够命令，当前 ${sent.size}（提取逻辑可能失效）`)
  const unhandled = [...sent].filter(command => !handled.has(command))
  assert.deepEqual(unhandled, [], "web 发送了原生未处理的命令")
})

test("原生处理的命令与 web 侧差异仅限已知保留项", () => {
  const nativeOnly = [
    // 原生菜单、工具栏与卡片命令入口
    "answer", "mistakes", "findCurrentAnswer", "findAnswer", "legacyMenu", "reviewMistakes",
    "bindAnswerNotebook", "openCurrentMistakeSource", "cardMenuCommand", "uiConstants", "runtimeLog",
    // 原生面板维护与导出流程
    "scanLocalCache", "clearLocalCache", "localCacheTaskStatus", "chooseAnswerPreviewMode",
    "acceptMistakeRefreshConsent", "pdfExportStage", "mistakeExportPreparationStatus", "exportSceneTemplate",
    // 原生侧 OCR / FSRS 设置与维护
    "ocrDbImportBackup", "ocrDbCleanup", "ocrDbRetry", "ocrSetCredential", "ocrClearCredential",
    "fsrsPreview", "plugin.previewAnswer"
  ]
  const extra = [...nativeHandled].filter(command => !sent.has(command) && !nativeOnly.includes(command))
  assert.deepEqual(extra, [], "出现新的仅原生命令：请确认拼写并更新本白名单")
})

test("预览 mock 必须覆盖核心交互命令（防 mock 漂移）", () => {
  const mocked = extract(mock, /command === "([a-zA-Z]+)"/g)
  const coreCommands = [
    "dashboard",
    "mistakes",
    "mistakesPage",
    "mistakeDetail",
    "mistakeQuestion",
    "reviewMistake",
    "changeMistakeLevel",
    "changeMistakeLevels",
    "removeMistake",
    "removeMistakes",
    "setMistakeCategory",
    "deleteMistakeTag",
    "resumeMistakeReview"
  ]
  const missing = coreCommands.filter(command => !mocked.has(command))
  assert.deepEqual(missing, [], "预览 mock 缺少核心命令实现")
})

test("预览 mock 对未实现命令提供兜底响应", () => {
  assert.match(mock, /return \{ preview: true \}/)
})

test("桥接错误信封同时携带可选 code 与用户可读 message", () => {
  assert.match(panelController, /error:\s*error\s*\?\s*\{\s*code:[^}]+message:\s*error\.message/s)
  assert.match(panelController, /typeof error\.code === "string"/)
})
