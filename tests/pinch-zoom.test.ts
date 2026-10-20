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
