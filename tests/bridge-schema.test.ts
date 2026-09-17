import { readFileSync } from "node:fs"
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

const webMain = readFileSync("web/src/main.jsx", "utf8")
const bridge = readFileSync("web/src/lib/mnBridge.js", "utf8")
const core = readFileSync("src/rails-core.ts", "utf8")
// 原生命令有两层分发：rails-core（插件核心）与 WebBridgeCommands（面板窗口自身命令）。
const panelCommands = readFileSync("rails-native/WebBridgeCommands.js", "utf8")
const panelController = readFileSync("rails-native/WebPanelController.js", "utf8")
const mock = readFileSync("web/src/lib/previewBridge.js", "utf8")

function webSentCommands(): Set<string> {
  const sent = new Set<string>()
  for (const source of [webMain, bridge]) {
    for (const match of source.matchAll(/(?:action|send)\("([a-zA-Z]+)"/g)) {
      sent.add(match[1])
    }
  }
  return sent
}

const handled = new Set([
  ...extract(core, /command === "([a-zA-Z]+)"/g),
  ...extract(panelCommands, /command === "([a-zA-Z]+)"/g)
])
const sent = webSentCommands()

test("web 端发送的每个桥命令都有原生处理", () => {
  assert.ok(sent.size >= 30, `应能从 web 源码提取到足够命令，当前 ${sent.size}（提取逻辑可能失效）`)
  const unhandled = [...sent].filter(command => !handled.has(command))
  assert.deepEqual(unhandled, [], "web 发送了原生未处理的命令")
})

test("原生处理的命令与 web 侧差异仅限已知保留项", () => {
    const nativeOnly = ["answer", "mistakes", "findCurrentAnswer", "legacyMenu", "reviewMistakes", "runtimeLog"]
  const extra = [...handled].filter(command => !sent.has(command) && !nativeOnly.includes(command))
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
