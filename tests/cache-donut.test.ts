import test from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"
import { createRequire } from "node:module"
import { join } from "node:path"
import { runInNewContext } from "node:vm"

async function load() {
  const result = await build({ entryPoints: ["web/src/CacheDonut.jsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false })
  const module = { exports: {} as any }, require = createRequire(join(process.cwd(), "package.json"))
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require })
  return { api: module.exports, React: require("react"), render: require("react-dom/server").renderToStaticMarkup }
}

test("小扇区最少1%，总和保持1；圆环内外边缘保持2px间距", async () => {
  const { api } = await load()
  const shares = Array.from(api.cacheChartShares([{ value: 1, selected: true }, { value: 999, selected: true }, { value: 50, selected: false }])) as number[]
  assert.ok(Math.abs(shares[0] - .01) < 1e-12)
  assert.ok(Math.abs(shares[1] - .99) < 1e-12)
  assert.equal(shares[2], 0)
  assert.equal(api.cacheSectorPath(0, 0), "")
  const path = api.cacheSectorPath(0, Math.PI / 2)
  assert.ok(path.includes("A100,100"))
  assert.ok(path.includes("A50,50"))
  assert.ok(!path.includes("NaN"))
})

test("系统不可调用时使用Telegram源码的回退曲线，清空布局为102/90直径和上移54", async () => {
  const { api, React, render } = await load()
  assert.equal(api.telegramChartProgress(0), 0)
  assert.equal(api.telegramChartProgress(1), 1)
  assert.ok(api.telegramChartProgress(.5) > .9)
  const html = render(React.createElement(api.default, { segments: [], hasScanned: true, cleared: true, formatValue: String }))
  assert.match(html, /A51,51/)
  assert.match(html, /A45,45/)
  assert.match(html, /translate\(0 -54\) rotate\(180 100 100\)/)
  assert.match(html, /缓存已清理/)
})
test("导出、临时文件与备份同时选中时都直接绘制分类颜色", async () => {
  const { api, React, render } = await load()
  const segments = [
    { id: "exports", title: "导出文件", value: 518.7, selected: true, color: "#ff9500" },
    { id: "temporary", title: "临时文件", value: 408.3, selected: true, color: "#2fbe62" },
    { id: "backups", title: "备份", value: 165.2, selected: true, color: "#a64bd1" }
  ]
  const html = render(React.createElement(api.default, { segments, formatValue: String }))
  for (const [index, rgb] of ["255,149,0", "47,190,98", "166,75,209"].entries()) {
    assert.match(html, new RegExp('<path d="M[^"]+" fill="rgb\\(' + rgb + '\\)" data-segment-id="' + segments[index].id + '"'))
  }
})
