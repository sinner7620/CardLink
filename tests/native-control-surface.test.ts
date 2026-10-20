import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

function harness() {
  const scope: any = { exports: {}, JSB: { defineClass: (_name: string, methods: any) => ({ new: () => ({ ...methods }) }) } }
  runInNewContext(transpileModule(readFileSync("src/native-control-surface.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const applied: unknown[] = [], callbacks: Array<() => void> = []
  let ready = false, active = true, onReady = 0, deferScript = false
  const webContext: any = { window: {}, document: { getElementById: () => ready ? {} : null } }
  const view: any = {
    loading: false, loads: [] as string[], delegate: null,
    loadHTMLStringBaseURL(html: string) { this.loads.push(html); this.loading = true; ready = false; webContext.window = {} },
    evaluateJavaScript(script: string, callback: (value: unknown) => void) {
      const result = runInNewContext(script, webContext)
      if (deferScript) callbacks.push(() => callback(result)); else callback(result)
    }
  }
  function finish() {
    ready = true; view.loading = false
    webContext.window.setState = (...args: unknown[]) => applied.push(args)
    view.delegate.webViewDidFinishLoad(view)
  }
  function sync(value: number) {
    scope.exports.syncControlSurface(view, { html: () => "html-" + value, method: "setState", rootId: "root", args: [value], active: () => active, onReady: () => { onReady++ } })
  }
  return { api: scope.exports, view, applied, callbacks, sync, finish,
    get onReady() { return onReady },
    blank() { ready = false; webContext.window = {} },
    setActive(value: boolean) { active = value },
    defer() { deferScript = true }
  }
}

test("加载完成前保留最新状态，完成后应用一次，不重载文档", () => {
  const h = harness()
  h.sync(1); h.sync(2); h.sync(3)
  assert.equal(h.view.loads.length, 1)
  assert.equal(h.applied.length, 0)
  h.finish()
  assert.deepEqual(JSON.parse(JSON.stringify(h.applied)), [[3]])
  assert.equal(h.onReady, 1)
})

test("绘制页被清空后重挂载恢复最新 HTML 与状态；健康页面更新不重新加载", () => {
  const h = harness()
  h.sync(1); h.finish()
  h.sync(2)
  assert.equal(h.view.loads.length, 1)
  h.api.pauseControlSurface(h.view)
  h.blank(); h.sync(3)
  assert.deepEqual(h.view.loads, ["html-1", "html-3"])
  h.finish()
  assert.deepEqual(JSON.parse(JSON.stringify(h.applied)), [[1], [2], [3]])
})

test("隐藏或关闭时的晚到完成回调不再更新，重新显示后补发最新状态", () => {
  const h = harness()
  h.sync(1); h.api.pauseControlSurface(h.view); h.setActive(false); h.finish()
  assert.equal(h.applied.length, 0)
  h.setActive(true); h.sync(2)
  assert.deepEqual(JSON.parse(JSON.stringify(h.applied)), [[2]])
  assert.equal(h.view.loads.length, 1)
})

test("原生加载失败只恢复一次，连续失败不循环重载", () => {
  const h = harness()
  h.sync(1)
  h.view.loading = false; h.view.delegate.webViewDidFailLoadWithError(h.view, {})
  assert.equal(h.view.loads.length, 2)
  h.view.loading = false; h.view.delegate.webViewDidFailLoadWithError(h.view, {})
  assert.equal(h.view.loads.length, 2)
  h.sync(2); h.finish()
  assert.deepEqual(JSON.parse(JSON.stringify(h.applied)), [[2]])
})

test("旧脚本的缺失结果晚到时，不覆盖新状态或触发多余重载", () => {
  const h = harness()
  h.sync(1); h.finish(); h.defer()
  h.blank(); h.sync(2)
  h.finish(); h.sync(3)
  const before = h.view.loads.length
  for (const complete of h.callbacks) complete()
  assert.equal(h.view.loads.length, before)
  assert.equal((h.applied[h.applied.length - 1] as unknown[])[0], 3)
})
