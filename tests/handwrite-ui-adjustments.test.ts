import test from "node:test"
import assert from "node:assert/strict"
import { defaultAnswerFrame } from "../src/answer-card-layout"
import { reviewResultHint } from "../src/mistake-domain"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"

test("答案窗口默认避开顶部软件工具栏，缩小后仍落在平板视区内", () => {
  for (const [width, height] of [[1024, 768], [1280, 894], [640, 768]]) {
    const frame = defaultAnswerFrame(width, height)
    assert.ok(frame.y >= 104)
    assert.ok(frame.width <= 560 && frame.height <= 620)
    assert.ok(frame.x + frame.width <= width)
    assert.ok(frame.y + frame.height <= height - 24)
  }
})

test("侧边按钮按当前记录进度和自定义曲线预告下次天数", () => {
  const curves = { 0: [2, 6, 12], 1: [4, 9, 15], 2: [20] }
  assert.equal(reviewResultHint({ level: 0, reviewCount: 0 }, 0, curves), "+6天")
  assert.equal(reviewResultHint({ level: 0, reviewCount: 1 }, 0, curves), "+12天")
  assert.equal(reviewResultHint({ level: 0, reviewCount: 9 }, 0, curves), "+12天")
  assert.equal(reviewResultHint({ level: 0, reviewCount: 1 }, 1, curves), "+4天")
  assert.equal(reviewResultHint(undefined, 2, curves), "+20天")
  assert.equal(reviewResultHint({ level: 2, reviewCount: 0 }, 2, curves), "结束")
})

test("天数显示保持原来的96点下拉区域及三个等宽88点按钮", () => {
  class View {
    layer: any = {}; subviews: any[] = []; frame: any
    constructor(frame: any) { this.frame = frame }
    addSubview(view: any) { this.subviews.push(view) }
  }
  const owner: any = {}
  const scope: any = {
    exports: {}, self: owner, UIView: View,
    UIButton: { buttonWithType: () => ({ title: "", layer: {}, titleLabel: {}, setTitleForState(title: string) { this.title = title }, setTitleColorForState() {}, addTargetActionForControlEvents() {}, addGestureRecognizer() {} }) },
    UIColor: { clearColor: () => "clear", whiteColor: () => "white", blackColor: () => "black", colorWithHexString: (color: string) => color },
    UIFont: { systemFontOfSize: (size: number) => size }, UILongPressGestureRecognizer: class {},
    require: (name: string) => name === "./mistake-domain" ? { reviewResultHint } : name === "./settings" ? { loadMatcherSettings: () => ({ mistakeReviewCurves: { 0: [1, 3, 7], 1: [2, 5, 10], 2: [14] } }) } : name === "./ui-tokens" ? { UI_COLORS: {} } : { MN: {} }
  }
  runInNewContext(transpileModule(readFileSync("src/floating-toolbar.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  scope.exports.createAnswerToolbar()
  scope.exports.updateMistakeToolbarTitle(true, { level: 0, reviewCount: 0 })
  assert.equal(owner.mistakeLevelDropdown.frame.width, 96)
  assert.deepEqual(Array.from(owner.mistakeLevelButtons, (button: any) => button.frame.width), [88, 88, 88])
  assert.equal(owner.mistakeLevelButtons[0].title, "不会  +3天")
})
