export type QuickFrame = { x: number; y: number; width: number; height: number }
export type QuickEdge = "left" | "right" | "top" | "bottom"

export interface QuickMenuGeometry {
  frame: QuickFrame
  expandLeft: boolean
  expandUp: boolean
  maxWidth: number
  maxHeight: number
}

const INSET = 12
const SCREEN_MARGIN = 6

/** The ball is a fixed anchor; the panel grows behind it until the screen edge. */
export function quickMenuGeometry(
  ball: QuickFrame,
  window: { width: number; height: number },
  desired: { width: number; height: number },
  edge: QuickEdge
): QuickMenuGeometry {
  const expandLeft = edge === "right" || (edge !== "left" && ball.x + ball.width / 2 > window.width / 2)
  const expandUp = edge === "bottom"
  const left = ball.x - INSET
  const right = ball.x + ball.width + INSET
  const top = ball.y - INSET
  const bottom = ball.y + ball.height + INSET
  const maxWidth = Math.max(ball.width + INSET, expandLeft ? right - SCREEN_MARGIN : window.width - SCREEN_MARGIN - left)
  const maxHeight = Math.max(ball.height + INSET, expandUp ? bottom - SCREEN_MARGIN : window.height - SCREEN_MARGIN - top)
  const width = Math.min(desired.width, maxWidth)
  const height = Math.min(desired.height, maxHeight)
  return {
    frame: { x: expandLeft ? right - width : left, y: expandUp ? bottom - height : top, width, height },
    expandLeft, expandUp, maxWidth, maxHeight
  }
}
