import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"

test("交付预览运行时包含原版缩放与惯性库", async () => {
  const result = await build({ entryPoints: ['src/card-preview-webview.ts'], bundle: true, write: false, metafile: true })
  const inputs = Object.keys(result.metafile!.inputs)
  assert.ok(inputs.some(name => name.includes('@panzoom/panzoom')))
  assert.ok(inputs.some(name => name.endsWith('panzoom/lib/kinetic.js')))
  const script = result.outputFiles[0].text
  assert.match(script, /requestAnimationFrame/)
})
