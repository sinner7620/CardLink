import { test } from "node:test"
import assert from "node:assert/strict"
import { createHtml2CanvasLoader } from "../web/src/lib/html2canvas-loader.mjs"

function fixture(baseUrl = "file:///plugin/web-dist/app.js") {
  const scripts = []
  const target = { document: {
    createElement() { return { remove() { this.removed = true } } },
    head: { appendChild(script) { scripts.push(script) } }
  } }
  return { target, scripts, load: createHtml2CanvasLoader(target, baseUrl) }
}

test("first and concurrent screenshots share one local library load", async () => {
  const { target, scripts, load } = fixture()
  const first = load()
  assert.equal(load(), first)
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0].src, "file:///plugin/web-dist/vendor/html2canvas.min.js")
  const calls = []
  target.html2canvas = async (...args) => { calls.push(args); return "canvas" }
  scripts[0].onload()
  const capture = await first
  const node = {}, options = { scale: 1.5, useCORS: true }
  assert.equal(await capture(node, options), "canvas")
  assert.deepEqual(calls, [[node, options]])
  assert.equal(await load(), capture)
  assert.equal(scripts.length, 1)
})

for (const failure of ["network", "missing-global"]) {
  test(`${failure} rejects and permits another load`, async () => {
    const { target, scripts, load } = fixture()
    const first = load()
    const rejected = assert.rejects(first, /截图库加载失败/)
    if (failure === "network") scripts[0].onerror()
    else scripts[0].onload()
    await rejected
    assert.equal(scripts[0].removed, true)
    const retry = load()
    assert.equal(scripts.length, 2)
    target.html2canvas = () => {}
    scripts[1].onload()
    assert.equal(await retry, target.html2canvas)
  })
}

test("an already loaded library needs no extra script", async () => {
  const { target, scripts, load } = fixture()
  target.html2canvas = () => {}
  assert.equal(await load(), target.html2canvas)
  assert.equal(scripts.length, 0)
})

test("preview bundle and development document resolve their own vendor paths", () => {
  for (const [base, expected] of [
    ["file:///project/web-dist/app.js", "file:///project/web-dist/vendor/html2canvas.min.js"],
    ["http://localhost:5173/", "http://localhost:5173/vendor/html2canvas.min.js"]
  ]) {
    const { scripts, load } = fixture(base)
    load()
    assert.equal(scripts[0].src, expected)
  }
})
