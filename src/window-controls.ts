export type WindowControlSide = "left" | "right"

export const PANEL_CLOSE_SIDE_KEY = "marginnote.extension.mn4-answer-matcher.rails.close-side.v1"

export function normalizeWindowControlSide(side: unknown): WindowControlSide {
  return side === "right" ? "right" : "left"
}

export function storedWindowControlSide(): WindowControlSide {
  return normalizeWindowControlSide(
    NSUserDefaults.standardUserDefaults().objectForKey(PANEL_CLOSE_SIDE_KEY)
  )
}

// 悬浮条几何单一来源：控件 40pt（贴近 HIG 44 最小触控目标，同时保留胶囊留白）、
// 上下内边距由 (条高 − 控件高) / 2 推导，三个控件共用同一尺寸与同一字号。
export const ANSWER_BAR_CONTROL_SIZE = 40
export const ANSWER_BAR_HEIGHT = 52
export const ANSWER_BAR_TOP_OFFSET = 5
export const ANSWER_BAR_SIDE_INSET = 6
// 顶部拖动热区必须完整覆盖悬浮条（TOP_OFFSET + BAR_HEIGHT = 57），统一取 60。
export const ANSWER_BAR_DRAG_STRIP_HEIGHT = 60
const ANSWER_BAR_PADDING = (ANSWER_BAR_HEIGHT - ANSWER_BAR_CONTROL_SIZE) / 2
const ANSWER_BAR_GAP = 4

/** 答案窗口的一体悬浮条：左右换边时整条移动，控件顺序同步镜像。 */
export function answerControlBarLayout(
  width: number,
  side: WindowControlSide,
  candidatesVisible: boolean
): {
  bar: { x: number; y: number; width: number; height: number }
  close: { x: number; y: number; width: number; height: number }
  refresh: { x: number; y: number; width: number; height: number }
  candidates: { x: number; y: number; width: number; height: number }
} {
  const normalized = normalizeWindowControlSide(side)
  const count = candidatesVisible ? 3 : 2
  const barWidth = ANSWER_BAR_PADDING * 2 + count * ANSWER_BAR_CONTROL_SIZE + (count - 1) * ANSWER_BAR_GAP
  const slot = (index: number) => ({
    x: ANSWER_BAR_PADDING + index * (ANSWER_BAR_CONTROL_SIZE + ANSWER_BAR_GAP),
    y: ANSWER_BAR_PADDING,
    width: ANSWER_BAR_CONTROL_SIZE,
    height: ANSWER_BAR_CONTROL_SIZE
  })
  const left = normalized === "left"
  return {
    bar: {
      x: left ? ANSWER_BAR_SIDE_INSET : Math.max(ANSWER_BAR_SIDE_INSET, width - barWidth - ANSWER_BAR_SIDE_INSET),
      y: ANSWER_BAR_TOP_OFFSET,
      width: barWidth,
      height: ANSWER_BAR_HEIGHT
    },
    close: slot(left ? 0 : count - 1),
    refresh: slot(left ? 1 : count - 2),
    candidates: slot(left ? 2 : 0)
  }
}

/** 答案悬浮条内的无独立底色按钮：三控件共用尺寸、圆角与默认字号，仅图形不同。 */
export function createWindowControlButton(title: string, action: string, selected = false): UIButton {
  const button = UIButton.buttonWithType(0)
  button.autoresizingMask = 0
  button.setTitleForState(title, 0)
  button.setTitleColorForState(selected ? UIColor.colorWithHexString("#0e8dfd") : UIColor.blackColor().colorWithAlphaComponent(0.82), 0)
  button.backgroundColor = selected ? UIColor.colorWithHexString("#0e8dfd").colorWithAlphaComponent(0.12) : UIColor.clearColor()
  // 三类按钮统一使用完整 40pt 点击面与零内缩；✕ 比 × 使用更完整的字面框。
  button.titleEdgeInsets = { top: 0, left: 0, bottom: 0, right: 0 }
  // 运行时不暴露 UIFont 全局（typings 有声明、运行时没有，真机已验证抛错）；
  // 三个控件同为 UIButton，默认系统字号天然一致，不得显式引用 UIFont。
  button.layer.cornerRadius = ANSWER_BAR_CONTROL_SIZE / 2
  button.layer.masksToBounds = true
  button.addTargetActionForControlEvents(self, action, 1 << 6)
  return button
}
