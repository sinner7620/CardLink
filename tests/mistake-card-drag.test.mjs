import assert from "node:assert/strict"
import test from "node:test"
import { installMistakeCardDrag } from "../web/src/lib/mistakeCardDrag.js"

test("错题长按达到 340 ms 时发起拖拽，提前松手不会发起", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const window = Object.assign(new EventTarget(), {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    innerWidth: 360,
    innerHeight: 280,
  })
  const document = Object.assign(new EventTarget(), { defaultView: window })
  const row = { isConnected: true, dataset: { mistakeDragRecord: "record" } }
  const list = Object.assign(new EventTarget(), {
    ownerDocument: document,
    closest: () => row,
    contains: element => element === row,
  })
  const replies = []
  const uninstall = installMistakeCardDrag(list, { onLift: payload => replies.push(payload), onDrop() {}, onCancel() {} })
  context.after(uninstall)

  const point = { identifier: 1, clientX: 60, clientY: 80 }
  const touch = (target, type) => target.dispatchEvent(Object.assign(new Event(type), {
    touches: type === "touchstart" ? [point] : [],
    changedTouches: [point],
  }))

  touch(list, "touchstart")
  context.mock.timers.tick(339)
  touch(document, "touchend")
  context.mock.timers.tick(1)
  assert.equal(replies.length, 0)

  touch(list, "touchstart")
  context.mock.timers.tick(339)
  assert.equal(replies.length, 0)
  context.mock.timers.tick(1)
  assert.equal(replies.length, 1)
  assert.equal(replies[0].recordId, "record")
})
