export type ReviewToolbarMode = { purpose?: string; writingMode?: string }

/** Same nearest-edge rule used by the detail page: top/bottom are horizontal. */
export function reviewToolbarHorizontal(x: number, y: number, width: number, height: number, previous?: boolean): boolean {
  const verticalEdge = Math.min(y, height - y), horizontalEdge = Math.min(x, width - x)
  // A spatial dead band prevents repeated re-layout while the finger crosses
  // the diagonal between adjacent edges. No timer delays a deliberate crossing.
  const margin = Math.min(24, width * .08, height * .08)
  if (previous !== undefined && Math.abs(verticalEdge - horizontalEdge) < margin) return previous
  return verticalEdge <= horizontalEdge
}

export function reviewToolbarAction(mode: ReviewToolbarMode): { title: string; icon: string } {
  return { title: '下一题', icon: mode.writingMode === 'mindmap' || mode.purpose === 'practice' ? 'forward' : 'next' }
}

export function reviewToolbarLayout(horizontal: boolean, expanded: boolean, sourceWidth: number, limits: { width: number; height: number; coreWidth?: number }, count = 7) {
  // Reserve a usable scroll viewport even when the collapsed bar is near the
  // right edge. Main controls keep the same size in every expansion state.
  const reserve = Math.min(48, limits.width * .2)
  const baseWidth = horizontal ? (limits.coreWidth ?? Math.min(44 * count, Math.max(0, limits.width - reserve))) : Math.min(44, limits.width)
  const extra = horizontal && expanded ? Math.max(0, Math.min(sourceWidth + 8, limits.width - baseWidth)) : 0
  const width = baseWidth + extra
  const height = Math.min(horizontal ? 44 : 44 * count, limits.height)
  const cell = horizontal ? baseWidth / count : height / count
  return { width, height, mainWidth: baseWidth, cell, sourceX: horizontal ? Math.floor(baseWidth - cell) : baseWidth, sourceWidth: extra,
    buttons: Array.from({ length: count }, (_, index) => ({
      x: horizontal ? Math.floor(index * cell) + (index === count - 1 ? extra : 0) : 0,
      y: horizontal ? 0 : Math.floor(index * cell),
      width: horizontal ? Math.floor((index + 1) * cell) - Math.floor(index * cell) : width,
      height: horizontal ? height : Math.floor((index + 1) * cell) - Math.floor(index * cell)
    })) }
}

/** Constrain the main controls, never the changing classification width. */
export function clampReviewToolbarCore(frame: { x: number; y: number; width: number; height: number }, bounds: { width: number; height: number }, horizontal: boolean) {
  const reserve = horizontal ? Math.min(48, Math.max(0, bounds.width - frame.width - 12)) : 0
  return { ...frame,
    x: Math.max(6, Math.min(frame.x, bounds.width - frame.width - reserve - 6)),
    y: Math.max(6, Math.min(frame.y, bounds.height - frame.height - 6)) }
}

export function reviewToolbarCount(mode: ReviewToolbarMode): number {
  return 7 + (mode.writingMode === 'annotation' ? 1 : 0) + (mode.purpose === 'practice' && mode.writingMode !== 'annotation' ? 1 : 0)
}

/** Transpose the grabbed location with the toolbar, then clamp to the host. */
export function reviewToolbarTrackingFrame(previous: { x: number; y: number; width: number; height: number },
  next: { width: number; height: number }, point: { x: number; y: number }, bounds: { width: number; height: number }) {
  const u = Math.max(0, Math.min(1, (point.x - previous.x) / previous.width))
  const v = Math.max(0, Math.min(1, (point.y - previous.y) / previous.height))
  return { ...next,
    x: Math.max(0, Math.min(point.x - v * next.width, bounds.width - next.width)),
    y: Math.max(0, Math.min(point.y - u * next.height, bounds.height - next.height)) }
}


export type ReviewToolbarEdge = 'left' | 'right' | 'top' | 'bottom'

/** Spatial hysteresis keeps the compact preview stable around screen diagonals. */
export function reviewToolbarDragGeometry(point: { x: number; y: number }, bounds: { width: number; height: number }, previous?: ReviewToolbarEdge, previousNear?: boolean) {
  const x = Math.max(22, Math.min(point.x, bounds.width - 22))
  const y = Math.max(22, Math.min(point.y, bounds.height - 22))
  const distances = { left: x, right: bounds.width - x, top: y, bottom: bounds.height - y }
  let edge = (Object.keys(distances) as ReviewToolbarEdge[]).reduce((a, b) => distances[a] <= distances[b] ? a : b)
  if (previous && distances[previous] - distances[edge] < 24) edge = previous
  const horizontal = edge === 'top' || edge === 'bottom'
  const nearEdge = distances[edge] <= (previousNear === undefined ? 96 : previousNear ? 108 : 84)
  const width = nearEdge && horizontal ? 64 : 44, height = nearEdge && !horizontal ? 64 : 44
  const centerX = Math.max(width / 2, Math.min(x, bounds.width - width / 2))
  const centerY = Math.max(height / 2, Math.min(y, bounds.height - height / 2))
  return { point: { x: centerX, y: centerY }, edge, horizontal, nearEdge,
    container: { x: centerX - 36, y: centerY - 36, width: 72, height: 72 },
    preview: { x: 36 - width / 2, y: 36 - height / 2, width, height } }
}

/** Expand around the release point; only clamp when controls would leave the window. */
export function reviewToolbarDropFrame(point: { x: number; y: number }, bounds: { width: number; height: number }, count: number, edge?: ReviewToolbarEdge) {
  const dock = reviewToolbarDragGeometry(point, bounds, edge)
  const metrics = reviewToolbarLayout(dock.horizontal, false, 0, { width: Math.max(0, bounds.width - 20), height: Math.max(0, bounds.height - 20) }, count)
  const width = metrics.mainWidth + 8, height = metrics.height + 8
  const frame = { x: dock.point.x - width / 2, y: dock.point.y - height / 2, width, height }
  return { edge: dock.edge, horizontal: dock.horizontal, frame: clampReviewToolbarCore(frame, bounds, dock.horizontal) }
}
