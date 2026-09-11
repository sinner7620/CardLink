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

// 与插件顶栏选中页签同高：双键态固定为 88×36pt 的连续胶囊；每个键占 44×36pt，
// 中间没有描边、间距或独立底色。候选答案出现时按同一 44pt 槽位自然延长。
export const ANSWER_BAR_CONTROL_WIDTH = 44
export const ANSWER_BAR_HEIGHT = 36
export const ANSWER_BAR_TOP_OFFSET = 6
export const ANSWER_BAR_SIDE_INSET = 6
// 顶部拖动热区与插件页 48pt 顶栏同高。
export const ANSWER_BAR_DRAG_STRIP_HEIGHT = 48

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
  const barWidth = count * ANSWER_BAR_CONTROL_WIDTH
  const slot = (index: number) => ({
    x: index * ANSWER_BAR_CONTROL_WIDTH,
    y: 0,
    width: ANSWER_BAR_CONTROL_WIDTH,
    height: ANSWER_BAR_HEIGHT
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

/** 答案悬浮条内的无独立底色按钮：相邻点击面连续，不绘制中缝。 */
export function createWindowControlButton(title: string, action: string, selected = false): UIButton {
  const button = UIButton.buttonWithType(0)
  button.autoresizingMask = 0
  button.setTitleForState(title, 0)
  button.setTitleColorForState(selected ? UIColor.colorWithHexString("#0e8dfd") : UIColor.blackColor().colorWithAlphaComponent(0.82), 0)
  button.backgroundColor = UIColor.clearColor()
  // 三类按钮统一使用完整点击面与零内缩；✕ 比 × 使用更完整的字面框。
  button.titleEdgeInsets = { top: 0, left: 0, bottom: 0, right: 0 }
  // 运行时不暴露 UIFont 全局（typings 有声明、运行时没有，真机已验证抛错）；
  // 三个控件同为 UIButton，默认系统字号天然一致，不得显式引用 UIFont。
  button.layer.cornerRadius = 0
  button.layer.masksToBounds = false
  button.addTargetActionForControlEvents(self, "onAnswerControlPress:", 1 << 0)
  button.addTargetActionForControlEvents(self, "onAnswerControlRelease:", (1 << 6) | (1 << 7) | (1 << 8))
  button.addTargetActionForControlEvents(self, action, 1 << 6)
  return button
}
