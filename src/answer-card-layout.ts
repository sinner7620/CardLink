export interface AnswerFrame {
  x: number
  y: number
  width: number
  height: number
}

export function defaultAnswerFrame(width: number, height: number): AnswerFrame {
  const top = Math.min(104, Math.max(20, height - 260))
  const available = Math.max(240, height - top - 24)
  const frameWidth = Math.max(280, Math.min(560, width - 24))
  const frameHeight = Math.min(620, available)
  return { x: Math.max(12, (width - frameWidth) / 2), y: top + Math.max(0, (available - frameHeight) / 2), width: frameWidth, height: frameHeight }
}

export function freePositionFrame(frame: AnswerFrame): AnswerFrame {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(280, frame.width),
    height: Math.max(240, frame.height)
  }
}

export function isFrameFullyOutside(frame: AnswerFrame, bounds: AnswerFrame): boolean {
  return frame.x + frame.width <= 0 ||
    frame.y + frame.height <= 0 ||
    frame.x >= bounds.width ||
    frame.y >= bounds.height
}
