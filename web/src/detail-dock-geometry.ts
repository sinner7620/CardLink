interface Size { width: number; height: number }
export function nearestDockEdge(x: number, y: number, width: number, height: number): string {
  const distances = { top: y, bottom: height - y, left: x, right: width - x }
  return Object.keys(distances).reduce((a, b) => distances[a as keyof typeof distances] <= distances[b as keyof typeof distances] ? a : b)
}
export function dockPosition(stage: Size, bar: Size, edge: string, ratio: number, drag?: { x: number; y: number } | null) {
  const edgeGap = 14
  const clamp = (value: number, extent: number, size: number) => {
    const availableGap = Math.min(edgeGap, Math.max(0, (extent - size) / 2))
    return Math.max(availableGap, Math.min(value, Math.max(availableGap, extent - size - availableGap)))
  }
  const horizontal = edge === "top" || edge === "bottom"
  const x = drag ? drag.x - bar.width / 2 : horizontal ? stage.width * ratio - bar.width / 2 : edge === "left" ? edgeGap : stage.width - bar.width - edgeGap
  const y = drag ? drag.y - bar.height / 2 : !horizontal ? stage.height * ratio - bar.height / 2 : edge === "top" ? edgeGap : stage.height - bar.height - edgeGap
  return { left: clamp(x, stage.width, bar.width), top: clamp(y, stage.height, bar.height) }
}
