import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

function presets() {
  const data = new Map<string, string>(), exports: any = {}
  const win = { localStorage: { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) } }
  runInNewContext(transpileModule(readFileSync("web/src/lib/sceneWindow.js", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, { exports })
  return { api: exports, win, data }
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

test("所有引入的上游源码逐字节匹配固定提交的Git blob，不修改玻璃控件", () => {
  const base = "web/vendor/liquid-glass-webgl/"
  const info = JSON.parse(readFileSync(base + "UPSTREAM.json", "utf8"))
  assert.equal(info.revision, "0b90f9fc1cea8c7e59825f9aff1cbb96674b5b80")
  assert.ok(info.files.length > 100)
  for (const name of info.files) {
    const content = readFileSync(base + name)
    const blob = createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex")
    assert.equal(blob, info.gitBlobs[name], `上游文件已被修改：${name}`)
  }
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
