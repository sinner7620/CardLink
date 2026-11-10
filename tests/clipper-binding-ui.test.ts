import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { createSourceFile, ScriptTarget, transpileModule } from "typescript"

function functionSource(path: string, name: string): string {
  const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.Latest, true)
  const node = source.statements.find((item: any) => item.name?.text === name)
  assert.ok(node, `Missing ${name}`)
  return node.getText(source)
}

function settingsHarness(mode: string) {
  const states: any[] = [], calls: any[] = []
  let cursor = 0
  const scope: any = { exports: {}, Icon() {}, SvgSwitch() {},
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children: children.flat() }) },
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], (value: any) => { states[index] = value }]
    } }
  runInNewContext(transpileModule(functionSource("web/src/main.jsx", "ClipperSettings") + "\nexports.component = ClipperSettings", {
    fileName: "clipper-settings.tsx", compilerOptions: { jsx: 2, module: 1, target: 7 }
  }).outputText, scope)
  const clipper: any = { toolBindingMode: mode }
  const render = () => {
    cursor = 0
    const tree = scope.exports.component({ clipper, action: async (...args: any[]) => {
      calls.push(args); return { tools: { title: "ToolTextExcerpt" } }
    } })
    return tree.children.find((child: any) => child.props?.className === "clipToolBindings").children
  }
  return { calls, clipper, render }
}

test("传统绑定先提示选笔，再确认记录；场景绑定一次点击打开选择，不残留确认状态", async () => {
  const classic = settingsHarness("classic")
  await classic.render()[0].props.onClick()
  assert.equal(classic.calls[0][0], "notify")
  assert.equal(classic.render()[0].props["aria-label"], "确认绑定标题工具")
  await classic.render()[0].props.onClick()
  assert.equal(classic.calls[1][0], "recordClipperTool")
  assert.equal(classic.calls[1][1].slot, "title")

  const scene = settingsHarness("scene")
  await scene.render()[0].props.onClick()
  assert.equal(scene.calls.length, 1)
  assert.equal(scene.calls[0][0], "recordClipperTool")
  assert.doesNotMatch(scene.render()[0].props["aria-label"], /确认/)
  scene.clipper.started = true
  assert.ok(scene.render().every((button: any) => button.props.disabled))

  const changed = settingsHarness("classic")
  await changed.render()[0].props.onClick()
  changed.clipper.toolBindingMode = "scene"
  assert.doesNotMatch(changed.render()[0].props["aria-label"], /确认/)
})

test("原生桥等待场景工具选择完成后再返回保存后的快照", async () => {
  let finish: () => void = () => {}, snapshots = 0, saved = false
  const owner = { window: {} }
  const scope: any = { exports: {}, isAICommand: () => false,
    recordClipperTool: (slot: string, target: any) => {
      assert.equal(slot, "title"); assert.equal(target, owner)
      return new Promise<void>(resolve => { finish = () => { saved = true; resolve() } })
    }, clipperSnapshot: (target: any) => { assert.equal(target, owner); snapshots++; return { saved } } }
  runInNewContext(transpileModule(functionSource("src/rails-core.ts", "bridgeInternal") + "\nexports.bridge = bridgeInternal", {
    compilerOptions: { module: 1, target: 7 }
  }).outputText, scope)
  const pending = scope.exports.bridge("recordClipperTool", { slot: "title" }, owner)
  await Promise.resolve()
  assert.equal(snapshots, 0)
  finish()
  const result = await pending
  assert.equal(result.saved, true)
  assert.equal(snapshots, 1)
})
