import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

function harness() {
  const state: any[] = [], refs: any[] = [], calls: any[] = [], effects: any[] = []
  let cursor = 0, refCursor = 0, first = true, finish: (value: any) => void, fail: (reason: any) => void, opened = false
  const react = {
    createElement(type: any, props: any, ...children: any[]) {
      if (type === "dialog") props.ref.current = { showModal() { opened = true }, close() { opened = false } }
      return { type, props, children: children.flat(Infinity) }
    },
    useState(initial: any) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value }] },
    useRef(initial: any) { const index = refCursor++; refs[index] ??= { current: initial }; return refs[index] },
    useEffect(callback: any) { if (first) effects.push(callback) }
  }
  const scope: any = { exports: {}, require(name: string) {
    if (name === "react") return { ...react, default: react }
    if (name.endsWith("mnBridge")) return { default: { send(command: string, payload: any) { calls.push({ command, payload }); return new Promise((resolve, reject) => { finish = resolve; fail = reject }) } } }
    return { default() {} }
  }, requestAnimationFrame: (callback: any) => callback(), setTimeout: (callback: any) => callback() }
  runInNewContext(transpileModule(readFileSync("web/src/LocalCacheSettings.jsx", "utf8"), { fileName: "cache.tsx", compilerOptions: { jsx: 2, module: 1, target: 7, esModuleInterop: false } }).outputText, scope)
  function render() {
    cursor = 0; refCursor = 0
    const tree = scope.exports.default()
    if (first) { first = false; effects.forEach(callback => callback()) }
    const nodes: any[] = []
    function visit(node: any) { if (!node || typeof node !== "object") return; nodes.push(node); node.children?.forEach(visit) }
    visit(tree)
    return nodes
  }
  const text = (node: any): string => typeof node === "string" || typeof node === "number" ? String(node) : node?.children?.map(text).join("") || ""
  const button = (label: string) => { const node = render().find(node => node.type === "button" && text(node) === label); assert.ok(node, label); return node.props }
  return { render, button, calls, text, finish: (value: any) => finish(value?.status ? value : { status: "done", operation: calls[calls.length - 1].command === "clearLocalCache" ? "clear" : "scan", result: Array.isArray(value) ? { groups: value } : value }), fail: (reason: any) => fail(reason), isOpen: () => opened }
}

const groups = [{ id: "pdf", title: "PDF", clearable: true, files: 2, bytes: 1200, knownBytes: 1200 }, { id: "saved", title: "手写", clearable: false, files: 1, bytes: 100, knownBytes: 100 }]

test("展开缓存页不扫描；手动扫描有等待状态且防止重复请求，清理需确认", async () => {
  const h = harness()
  h.render(); h.render()
  assert.equal(h.calls.length, 0)
  const scan = h.button("开始扫描").onClick()
  await Promise.resolve()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].command, "scanLocalCache")
  assert.equal(h.button("正在扫描…").disabled, true)
  assert.ok(h.render().some(node => node.props?.role === "status" && h.text(node).includes("正在扫描本地缓存")))
  await h.button("正在扫描…").onClick()
  assert.equal(h.calls.length, 1)
  h.finish(groups); await scan
  h.button("清除缓存 1.2 KB").onClick()
  assert.equal(h.isOpen(), true)
  assert.equal(h.calls.length, 1)
  h.button("取消").onClick()
  assert.equal(h.isOpen(), false)
  assert.equal(h.calls.length, 1)
  h.button("清除缓存 1.2 KB").onClick()
  h.button("确认清理").onClick()
  await Promise.resolve()
  assert.equal(h.calls[1].command, "clearLocalCache")
  assert.deepEqual(Array.from(h.calls[1].payload.ids), ["pdf"])
  h.finish({ groups, removed: 0, failed: 1 }); await new Promise(resolve => setImmediate(resolve))
  assert.ok(h.render().some(node => node.props?.role === "status" && h.text(node).includes("未能移入回收站")))
})

test("扫描失败恢复开始扫描入口并显示错误，不自动重试", async () => {
  const h = harness()
  const request = h.button("开始扫描").onClick()
  await Promise.resolve()
  h.fail(new Error("目录读取失败"))
  await request
  assert.equal(h.button("开始扫描").disabled, false)
  assert.equal(h.calls.length, 1)
  assert.ok(h.render().some(node => node.props?.role === "status" && h.text(node).includes("目录读取失败")))
})

test("本地数据只统计占用，临时文件整组选择，备份仍可逐项选择", async () => {
  const h = harness()
  const samples = [
    ...groups,
    { id: "logs", clearable: true, files: 1, bytes: 100 },
    { id: "indexes", clearable: false, files: 1, bytes: 200 },
    { id: "ocrDatabase", clearable: false, files: 1, bytes: 300 },
    { id: "ocrBackups", clearable: false, files: 1, bytes: 500 },
    { id: "dataBackups", clearable: false, files: 1, bytes: 200 }
  ]
  const scan = h.button("开始扫描").onClick()
  await Promise.resolve(); h.finish(samples); await scan
  const local = h.render().find(node => node.props?.className === "cacheCategory cacheReadOnly")
  assert.match(h.text(local), /本地数据.*保留.*600 B/)
  assert.equal(h.render().find(node => node.type === "input" && node.props?.["aria-label"] === "本地数据")?.props.disabled, true)
  assert.equal(h.render().filter(node => node.type === "details").length, 1)
  const input = (name: string) => h.render().find(node => node.type === "input" && node.props?.["aria-label"] === name).props
  assert.equal(input("临时文件").checked, true)
  input("临时文件").onChange()
  assert.equal(input("临时文件").checked, false)
  input("OCR 数据库备份").onChange()
  assert.equal(input("插件数据备份").checked, false)
  h.button("清除所选 500 B").onClick()
  h.button("确认清理").onClick()
  await Promise.resolve()
  assert.equal(h.calls[1].payload.allowRetained, true)
  assert.deepEqual(Array.from(h.calls[1].payload.ids), ["ocrBackups"])
  h.finish({ groups: [], removed: 1, failed: 0 }); await new Promise(resolve => setImmediate(resolve))
})

test("原生受理任务后持续显示进度，查询到结果才解除等待", async () => {
  const h = harness()
  const scan = h.button("开始扫描").onClick()
  await Promise.resolve()
  h.finish({ status: "running", taskId: "task-1", operation: "scan", progress: { phase: "scan", directories: 8, visited: 6015, processed: 10, total: 0 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls[1].command, "localCacheTaskStatus")
  const waiting = h.render().find(node => node.props?.className === "cacheTaskOverlay")
  assert.ok(waiting)
  assert.ok(h.text(waiting).includes("6015"))
  assert.equal(h.button("正在扫描…").disabled, true)
  h.finish({ status: "done", operation: "scan", result: { groups } })
  await scan
  assert.equal(h.render().some(node => node.props?.className === "cacheTaskOverlay"), false)
  assert.equal(h.button("重新扫描").disabled, false)
})


test("移入回收站后显示路径和手动删除提示，仍统计占用且不可再次选中", async () => {
  const h = harness()
  const scan = h.button("开始扫描").onClick()
  await Promise.resolve(); h.finish(groups); await scan
  h.button("清除缓存 1.2 KB").onClick()
  h.button("确认清理").onClick()
  await Promise.resolve()
  h.finish({ groups: [{ id: "recycle", files: 2, bytes: 1200, knownBytes: 1200, clearable: false, recyclePath: "/docs/CardLink/回收站" }], removed: 2, failed: 0, skipped: 0 })
  await new Promise(resolve => setImmediate(resolve))
  const status = h.render().find(node => node.props?.role === "status")
  assert.match(h.text(status), /已移入回收站 2 个文件/)
  assert.match(h.text(status), /尚未释放空间/)
  h.button("回收站1.2 KB").onClick()
  assert.equal(h.isOpen(), true)
  assert.equal(h.calls.length, 2)
  assert.ok(h.render().some(node => node.props?.className === "cacheLocalTotal" && h.text(node).includes("1.2 KB")))
  assert.ok(h.render().some(node => node.props?.["aria-labelledby"] === "cache-recycle-title" && h.text(node).includes("手动删除")))
  assert.equal(h.render().filter(node => node.type === "input" && node.props.type === "checkbox").length, 0)
  assert.doesNotMatch(h.text(status), /已删除/)
})
