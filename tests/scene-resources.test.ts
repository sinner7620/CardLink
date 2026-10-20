import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

function moduleAt(path: string, globals: any = {}) {
  const exports: any = {}
  runInNewContext(transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, { exports, ...globals })
  return exports
}
test("窗口宽度不受screen或1400限制，高度沿用宿主上限；尺寸可持久保存", () => {
  const mod = moduleAt("web/src/lib/sceneWindow.js")
  const calls: any[] = [], saved: any[] = []
  const win = { screen: { width: 768, height: 1024 }, mn: { size: (...args: any[]) => calls.push(args) }, localStorage: { setItem: (...args: any[]) => saved.push(args) } }
  mod.setSceneWindowSize(2000, 2000, win)
  assert.deepEqual(calls[0], [2000, 1000])
  assert.equal(JSON.parse(saved[0][1]).width, 2000)
  mod.setSceneWindowSize(-20, 20, win)
  assert.deepEqual(calls[1], [360, 360])
  mod.setSceneWindowSize(640, 620, win)
  assert.deepEqual(calls[2], [640, 620])
  mod.setSceneWindowSize(Infinity, NaN, win)
  assert.deepEqual(calls[3], [640, 620])
  mod.setSceneWindowSize(900, 720, { ...win, screen: { width: 640, height: 620 } })
  assert.deepEqual(calls[4], [900, 720])
})
test("预览样式保留嵌套媒体查询、引号与数据选择器，不以分号切断规则", () => {
  const mod = moduleAt("web/src/lib/sceneResources.js")
  const css = '@charset "UTF-8"; .x{content:"};";color:red} @media(print){.y{color:blue}} [data-v="{"]{display:none}'
  const rules = mod.splitCssRules(css)
  assert.equal(rules.length, 3)
  assert.ok(rules[1].startsWith("@media"))
  assert.throws(() => mod.splitCssRules(".x{color:red"), /不完整/)
})
test("重复底图只传递一次，失败释放已分配媒体；失败不返回伪资源地址", async () => {
  const released: any[] = []
  const mod = moduleAt("web/src/lib/sceneResources.js", { window: { mn: { call: async (_name: any, body: any) => released.push(body) } } })
  let count = 0
  const src = "data:image/png;base64,YQ=="
  const result = await mod.prepareSceneHtml(`<img src="${src}"><img src="${src}">`, async () => { count++; return { key: "one", url: "/media/one" } })
  assert.equal(count, 1)
  assert.equal(result.html, '<img src="/media/one"><img src="/media/one">')
  await assert.rejects(mod.prepareSceneHtml(`<img src="${src}"><img src="data:image/jpeg;base64,Yg==">`, async () => {
    if (++count === 3) throw new Error("图片传递失败")
    return { key: "two", url: "/media/two" }
  }), /传递失败/)
  assert.equal(released[0].keys[0], "two")
  await assert.rejects(mod.publishSceneImage(src, { api: async () => ({ state: { immersive: true } }), call: async () => ({ error: { message: "拒绝" } }) }), /拒绝/)
  let mediaRequests = 0
  await assert.rejects(mod.publishSceneImage(src, { api: async () => ({ state: { immersive: false } }), call: async (name: string) => { if (name === "sceneMedia") mediaRequests++; return {} } }), /已离开/)
  assert.equal(mediaRequests, 0)
})
test("原生媒体只接收图片及私有 PDF 预览页，释放不能删除他人资源", () => {
  const stored: any[] = []
  const scope: any = {
    __MNAM_WEB_BRIDGE_GLOBAL__: { decodeMediaBase64: (value: string) => ({ base64: value }) },
    Application: { sharedInstance: () => ({ tempPath: "/tmp" }) },
    NSData: { dataWithContentsOfFile: (path: string) => ({ path }) }
  }
  runInNewContext(readFileSync("rails-native/SceneMedia.js", "utf8"), scope)
  const media = scope.__MNAM_SCENE_MEDIA_GLOBAL__.create({ putMedia: (...args: any[]) => stored.push(args) })
  const image = media.dataUri("data:image/png;base64,YQ==")
  assert.equal(image.url, "/media/cardlink-1")
  assert.equal(stored[0][2], "image/png")
  const page = media.previewFile("file:///tmp/CardLink/temp/pdf-cache/preview-page-2.jpg?t=2")
  assert.equal(page.url, "/media/cardlink-2")
  assert.throws(() => media.previewFile("file:///tmp/CardLink/temp/pdf-cache/../secret.jpg"), /路径无效/)
  assert.throws(() => media.previewFile("file:///etc/passwd"), /路径无效/)
  assert.throws(() => media.dataUri("data:text/html;base64,YQ=="), /格式/)
  media.release(["other", image.key])
  assert.equal(stored.length, 3)
  assert.equal(stored[2][1], null)
})
