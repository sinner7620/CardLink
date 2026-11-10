import test from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"
import { runInNewContext } from "node:vm"
import { createRequire } from "node:module"
import { join } from "node:path"

test("总览与缓存共用的环图按真实值计算比例，零占用显示空环", async () => {
  const result = await build({ entryPoints: ["web/src/DistributionDonut.jsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false })
  const module = { exports: {} as any }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(join(process.cwd(), "package.json")) })
  const gradient = module.exports.distributionGradient
  assert.equal(gradient([{ value: 1, color: "red" }, { value: 3, color: "blue" }], 4), "red 0% 25%,blue 25% 100%")
  assert.equal(gradient([{ value: 0, color: "red" }], 0), "#e9edf5 0 100%")
  assert.equal(gradient([{ value: 0, color: "red" }, { value: 5, color: "blue" }], 5), "blue 0% 100%")
})


test("发光分层仅标记选中饼块，各块独立保留原有角度与颜色", async () => {
  const result = await build({ entryPoints: ["web/src/DistributionDonut.jsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false })
  const module = { exports: {} as any }, require = createRequire(join(process.cwd(), "package.json"))
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require })
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server")
  const html = renderToStaticMarkup(React.createElement(module.exports.default, { highlightSegments: true, total: 4,
    segments: [{ id: "a", value: 1, color: "red", selected: true, glowRgb: "255, 0, 0" }, { id: "b", value: 3, color: "blue", selected: false, glowRgb: "0, 0, 255" }] }))
  assert.match(html, /class="distributionSegment isSelected" data-segment-id="a"/)
  assert.match(html, /class="distributionSegment" data-segment-id="b"/)
  assert.match(html, /red 0% 25%,transparent 25% 100%/)
  assert.match(html, /transparent 0% 25%,blue 25% 100%/)
})


test("联动环图仅以勾选容量分配圆环，全部取消时显示零且不留饼块", async () => {
  const result = await build({ entryPoints: ["web/src/DistributionDonut.jsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false })
  const module = { exports: {} as any }, require = createRequire(join(process.cwd(), "package.json"))
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require })
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server")
  const props = { highlightSegments: true, animateSelection: true, total: 12, formatValue: (value: number) => `${value} MB`,
    segments: [{ id: "a", title: "图片", value: 3, color: "red", selected: true }, { id: "b", title: "日志", value: 9, color: "blue", selected: false }] }
  const html = renderToStaticMarkup(React.createElement(module.exports.default, props))
  assert.match(html, /distributionValue">3 MB</)
  assert.match(html, />100%</)
  assert.doesNotMatch(html, /data-segment-id="b"/)
  const empty = renderToStaticMarkup(React.createElement(module.exports.default, { ...props, segments: props.segments.map(segment => ({ ...segment, selected: false })) }))
  assert.match(empty, /distributionValue">0 MB</)
  assert.doesNotMatch(empty, /data-segment-id=/)
})
