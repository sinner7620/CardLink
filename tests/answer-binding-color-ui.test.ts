import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { createSourceFile, ScriptKind, ScriptTarget, transpileModule } from "typescript"

function bindingRow(key: string, action: (...args: any[]) => Promise<any>) {
  const source = createSourceFile("main.jsx", readFileSync("web/src/main.jsx", "utf8"), ScriptTarget.Latest, true, ScriptKind.JSX)
  const component = source.statements.find((node: any) => node.name?.text === "AnswerBindingRow")
  assert.ok(component)
  const states: any[] = []
  let cursor = 0
  const scope: any = {
    exports: {},
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children: children.flat() }) },
    useState(initial: any) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value }]
    },
    useEffect() {},
    DetailMorphIcon() {}, Icon() {},
    ListFilter: {}, ChevronUp: {}, RefreshCw: {}, Trash2: {}, Check: {}, Plus: {}
  }
  runInNewContext(transpileModule(component.getText(source) + "\nexports.render = AnswerBindingRow", {
    fileName: "binding-row.tsx", compilerOptions: { jsx: 2, module: 1, target: 7 }
  }).outputText, scope)
  const row = { key, selectionMode: "designated", designatedAnswer: "subcard", questionColors: [] }
  return (label: string) => {
    cursor = 0
    const tree = scope.exports.render({ row, action })
    function find(node: any): any {
      if (!node || typeof node !== "object") return undefined
      if (node.props?.["aria-label"] === label) return node
      return node.children?.map(find).find(Boolean)
    }
    const button = find(tree)
    assert.ok(button, `Missing button: ${label}`)
    return button.props
  }
}

for (const key of ["questions::root::main", "questions::root::child"]) {
  test(`颜色确认将绑定 key 放在第二个参数并在成功后结束添加：${key}`, async () => {
    const calls: any[][] = []
    let finish!: (value: any) => void
    const button = bindingRow(key, (...args) => {
      calls.push(args)
      return new Promise(resolve => { finish = resolve })
    })
    await button("筛选题目").onClick()
    await button("添加颜色").onClick()
    assert.equal(calls.length, 0)
    const pending = button("确认添加所选卡片颜色").onClick()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].length, 2)
    assert.equal(calls[0][0], "addManagedAnswerBindingColor")
    assert.equal(calls[0][1].key, key)
    assert.equal(button("确认添加所选卡片颜色").disabled, true)
    finish({ color: 4 })
    await pending
    assert.equal(button("添加颜色").disabled, false)
  })
}

test("颜色保存未成功时保留确认入口并允许重试", async () => {
  const button = bindingRow("questions::root::child", async () => false)
  await button("筛选题目").onClick()
  await button("添加颜色").onClick()
  await button("确认添加所选卡片颜色").onClick()
  assert.equal(button("确认添加所选卡片颜色").disabled, false)
})
