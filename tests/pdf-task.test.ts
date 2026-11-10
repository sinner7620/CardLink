import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function transferHarness(binary: string, override: Record<string, any> = {}, delayChunk = false) {
  const encoded = Buffer.from(binary, "latin1").toString("base64")
  const info = { chunks: Math.ceil(encoded.length / 65536), chunkSize: 65536, base64Length: encoded.length, byteLength: binary.length, pages: 1, ...override }
  const written: string[] = [], opened: string[] = [], errors: string[] = [], pending: Array<() => void> = []
  const task: any = { id: "task-1", status: "rendering", progress: 36 }
  const controller: any = { exportPdfTask: task, exportPdfRequest: {
    result: { filename: "task.pdf", count: 1 }, resolve() {}, reject: (error: Error) => errors.push(error.message)
  } }
  const view = { evaluateJavaScript(script: string, callback: (value?: string) => void) {
    if (script.includes("JSON.stringify")) callback(JSON.stringify(info))
    else if (script.includes("TAKE_CHUNK")) {
      const index = Number(script.match(/\((\d+)\)/)?.[1])
      const reply = () => callback(encoded.slice(index * 65536, (index + 1) * 65536))
      if (delayChunk) pending.push(reply); else reply()
    } else callback()
  } }
  controller.exportWebView = view
  const scope: any = {
    NSTimer: { scheduledTimerWithTimeInterval: () => ({ invalidate() {} }) },
    Application: { sharedInstance: () => ({ tempPath: "/tmp", saveFileWithUti: (path: string) => opened.push(path) }) },
    NSFileManager: { defaultManager: () => ({ fileExistsAtPath: () => true, removeItemAtPath() {} }) },
    NSData: { dataWithStringEncoding: (value: string, encoding: number) => {
      assert.equal(encoding, 5)
      return { length: () => value.length, writeToFileAtomically: () => { written.push(value); return true } }
    } },
    __MN_ANSWER_CORE_GLOBAL__: { bridge() {} }
  }
  runInNewContext(readFileSync("rails-native/WebBridgeCommands.js", "utf8"), scope)
  const api = scope.__MNAM_WEB_BRIDGE_GLOBAL__
  return { api, controller, view, task, info, written, opened, errors, pending }
}

test("PDF 分块逐块解码，验证真实字节后只打开一次保存面板", () => {
  const binary = "%PDF-1.7\n" + Array.from({ length: 130000 }, (_, i) => String.fromCharCode(i % 256)).join("") + "\n%%EOF\n"
  const h = transferHarness(binary)
  h.api.pdfDataReady(h.controller, h.view)
  assert.deepEqual(h.errors, [])
  assert.deepEqual(h.written, [binary])
  assert.equal(h.opened.length, 1)
  assert.equal(h.controller.exportWebView, null)
})

test("页数、字节数或文件尾无效时不保存", () => {
  for (const [binary, info] of [["%PDF-1.7\n%%EOF", { pages: 0 }], ["%PDF-1.7\n%%EOF", { byteLength: 999 }], ["%PDF-1.7\ntruncated", {}]] as const) {
    const h = transferHarness(binary, info)
    h.api.pdfDataReady(h.controller, h.view)
    assert.equal(h.opened.length, 0)
    assert.equal(h.written.length, 0)
    assert.equal(h.errors.length, 1)
  }
})

test("传输中取消结算请求，迟到的数据块不能保存文件", () => {
  const h = transferHarness("%PDF-1.7\n%%EOF", {}, true)
  h.api.pdfDataReady(h.controller, h.view)
  const response = h.api.dispatch({ controller: h.controller }, "pdfTaskCancel", { id: h.task.id })
  assert.equal(response.cancelled, true)
  h.pending.forEach(reply => reply())
  assert.deepEqual(h.errors, ["已取消导出"])
  assert.equal(h.written.length, 0)
  assert.equal(h.opened.length, 0)
})

test("页进度来自当前渲染器，旧 WebView 不得修改任务", () => {
  const h = transferHarness("%PDF-1.7\n%%EOF")
  h.api.pdfProgress(h.controller, {}, "mnaddon://pdf-progress?stage=rendering&completed=9&total=10&pages=9")
  assert.equal(h.task.progress, 36)
  h.api.pdfProgress(h.controller, h.view, "mnaddon://pdf-progress?stage=rendering&completed=3&total=10&pages=3")
  assert.equal(h.task.completed, 3)
  assert.equal(h.task.total, 10)
  assert.equal(h.task.pages, 3)
  assert.equal(h.task.progress, 53)
})
