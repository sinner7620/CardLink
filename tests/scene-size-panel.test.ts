import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { createRequire } from "node:module"
import { join } from "node:path"
import { transpileModule } from "typescript"

function presets() {
  const data = new Map<string, string>(), exports: any = {}
  const win = { localStorage: { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) } }
  runInNewContext(transpileModule(readFileSync("web/src/lib/sceneWindow.js", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, { exports })
  return { api: exports, win, data }
}

// 弹窗是普通 JSX 组件；按 cache-donut 的方式在 Node 里打成 CJS 再渲染。
async function panel() {
  const { build } = await import("esbuild")
  const result = await build({ entryPoints: ["web/src/SceneSizePanel.jsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false })
  const module = { exports: {} as any }, require = createRequire(join(process.cwd(), "package.json"))
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require })
  return { api: module.exports, React: require("react"), render: require("react-dom/server").renderToStaticMarkup }
}

test("保存尺寸预设可跨读取恢复、去重和删除，宽度不增加人为上限", () => {
  const { api, win } = presets()
  api.saveSceneSizePreset(2000, 720, win)
  api.saveSceneSizePreset(2000, 720, win)
  api.saveSceneSizePreset(480, 540, win)
  assert.deepEqual(JSON.parse(JSON.stringify(api.readSceneSizePresets(win))), [{ width: 2000, height: 720 }, { width: 480, height: 540 }])
  api.removeSceneSizePreset(2000, 720, win)
  assert.deepEqual(JSON.parse(JSON.stringify(api.readSceneSizePresets(win))), [{ width: 480, height: 540 }])
})

test("预设读取忽略损坏与越界条目，存储失败不伪装成功", () => {
  const { api, win, data } = presets()
  data.set("cardlink.scene.sizePresets", "invalid")
  assert.equal(api.readSceneSizePresets(win).length, 0)
  data.set("cardlink.scene.sizePresets", JSON.stringify([{ width: 10, height: 500 }, { width: 640, height: 2000 }, { width: 640, height: 620 }, { width: 640, height: 620 }]))
  assert.equal(api.readSceneSizePresets(win).length, 1)
  assert.throws(() => api.saveSceneSizePreset(640, 620, { localStorage: { getItem: () => null, setItem: () => { throw new Error("storage unavailable") } } }), /storage unavailable/)
})

test("默认预设可选择内置或自定义，临时调窗不改变默认，删除所选项回退预设2", () => {
  const { api, win, data } = presets()
  const calls: any[] = []
  const host = { ...win, mn: { size: (w: number, h: number) => calls.push([w, h]) } }
  api.resetSceneWindowSize(host)
  assert.deepEqual(calls.pop(), [720, 520])
  api.saveDefaultSceneSize(480, 540, host)
  api.setSceneWindowSize(1000, 800, host)
  api.resetSceneWindowSize(host)
  assert.deepEqual(calls.pop(), [480, 540])
  api.saveSceneSizePreset(1800, 650, host)
  api.saveDefaultSceneSize(1800, 650, host)
  api.resetSceneWindowSize(host)
  assert.deepEqual(calls.pop(), [1800, 650])
  assert.equal(JSON.parse(data.get("cardlink.scene.defaultSizePreset")!).width, 1800)
  api.removeSceneSizePreset(1800, 650, host)
  api.resetSceneWindowSize(host)
  assert.deepEqual(calls.pop(), [720, 520])
  assert.throws(() => api.saveDefaultSceneSize(777, 666, host), /已有预设/)
  data.set("cardlink.scene.defaultSizePreset", "invalid")
  api.resetSceneWindowSize(host)
  assert.deepEqual(calls.pop(), [720, 520])
})

test("底部「恢复默认」「完成」是可见的普通按钮，分别执行重置与关闭", async () => {
  const { api, React, render } = await panel()
  const html = render(React.createElement(api.SceneSizePanel, {
    size: { width: 640, height: 620 }, presets: [], defaultSize: { width: 720, height: 520 },
    onDefault: () => {}, onReset: () => {}, onResize: () => {}, onSave: () => {}, onRemove: () => {}, onClose: () => {}
  }))
  assert.match(html, /<button type="button">恢复默认<\/button>/)
  assert.match(html, /<button type="button">完成<\/button>/)
  assert.doesNotMatch(html, /<canvas|sceneGlassFooterAction|sceneSizeBackdrop/)
  // 页脚组件无 hooks，直接取元素树即可验证标签与回调的绑定。
  const calls: string[] = []
  const footer = api.SceneSizeFooter({ onReset: () => calls.push("reset"), onClose: () => calls.push("close") })
  const [reset, done] = footer.props.children
  reset.props.onClick(); done.props.onClick()
  assert.deepEqual(calls, ["reset", "close"])
})
