import assert from "node:assert/strict"
import test from "node:test"
import { wireFramePinchZoom } from "../src/pinch-zoom"

function harness() {
  const handlers = new Map<string, (event: any) => void>()
  let scale = 1, ends = 0
  const applied: number[] = []
  const cleanup = wireFramePinchZoom({ addEventListener: (n: string, h: any) => handlers.set(n, h), removeEventListener: (n: string) => handlers.delete(n) }, {
    getScale: () => scale, applyScale: (s: number) => { scale = s; applied.push(s) }, onPinchEnd: () => ends++
  })
  return { fire: (name: string, values: any = {}) => handlers.get(name)?.({ preventDefault() {}, ...values }),
    applied, scale: () => scale, ends: () => ends, cleanup }
}
const touches = (distance: number) => [{ clientX: 0, clientY: 0 }, { clientX: distance, clientY: 0 }]

test("touch先开始时晚到的gesture累计比例不重复放大或回跳", () => {
  const h = harness()
  h.fire("touchstart", { touches: touches(100) })
  h.fire("touchmove", { touches: touches(150) })
  h.fire("gesturestart", { scale: 1 })
  h.fire("gesturechange", { scale: 1.5 })
  assert.equal(h.scale(), 1.5)
  h.fire("touchmove", { touches: touches(160) })
  h.fire("gesturechange", { scale: 1.6 })
  assert.deepEqual(h.applied, [1.5, 1.6])
  h.fire("gestureend"); h.fire("touchend", { touches: [] })
  assert.equal(h.ends(), 1)
  h.cleanup()
})

test("gesture先开始时touchstart不能覆盖原始比例", () => {
  const h = harness()
  h.fire("gesturestart")
  h.fire("gesturechange", { scale: 1.5 })
  h.fire("touchstart", { touches: touches(150) })
  h.fire("touchend", { touches: touches(150) })
  h.fire("gesturechange", { scale: 1.6 })
  h.fire("touchmove", { touches: touches(180) })
  assert.deepEqual(h.applied, [1.5, 1.6])
  h.fire("gestureend")
  assert.equal(h.ends(), 1)
  h.fire("touchstart", { touches: touches(100) })
  h.fire("touchmove", { touches: touches(50) })
  assert.equal(h.scale(), .8)
  h.cleanup()
})

test("第三指离开时比例和内容锚点一起重建，下一次移动不跳位", () => {
  const handlers = new Map<string, any>()
  let scale = 1, anchor = 0, starts = 0
  wireFramePinchZoom({ addEventListener: (name: string, handler: any) => handlers.set(name, handler), removeEventListener() {} }, {
    getScale: () => scale,
    onPinchStart: (point: any) => { anchor = point.x; starts++ },
    applyScale: (value: number, point: any) => { scale = value; assert.equal(point.x, anchor) }
  })
  const fire = (name: string, points: any[]) => handlers.get(name)({ touches: points, preventDefault() {} })
  fire("touchstart", touches(100))
  fire("touchstart", [...touches(100), { clientX: 300, clientY: 0 }])
  fire("touchend", [{ clientX: 100, clientY: 0 }, { clientX: 200, clientY: 0 }])
  fire("touchmove", [{ clientX: 100, clientY: 0 }, { clientX: 200, clientY: 0 }])
  assert.equal(scale, 1)
  assert.equal(starts, 2)
  assert.equal(anchor, 150)
})

test("双指起始即拦截默认行为，单指保持原生滚动；gesture坐标0不替换为中心", () => {
  const handlers = new Map<string, any>()
  let prevented = 0, point: any
  wireFramePinchZoom({ addEventListener: (name: string, handler: any, config: any) => { handlers.set(name, handler); if (name === "touchstart") assert.equal(config.passive, false) }, removeEventListener() {} }, {
    getScale: () => 1, applyScale() {}, onGestureStart: (value: any) => point = value, clientWidth: () => 200, clientHeight: () => 250
  })
  const fire = (name: string, values: any) => handlers.get(name)({ preventDefault: () => prevented++, ...values })
  fire("touchstart", { touches: touches(100).slice(0, 1) })
  assert.equal(prevented, 0)
  fire("touchstart", { touches: touches(100) })
  assert.equal(prevented, 1)
  fire("touchend", { touches: [] })
  fire("gesturestart", { clientX: 0, clientY: 0 })
  assert.deepEqual(point, { x: 0, y: 0 })
})
