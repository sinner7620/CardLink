import type { AnswerFrame } from './answer-card-layout'

/** Keep the editor inside the study view, including narrow split-screen views. */
export function pluginInkFrame(bounds: { width: number; height: number }, requested?: Partial<AnswerFrame>): AnswerFrame {
  const margin = 12, top = Math.min(48, Math.max(0, bounds.height - 340))
  const maxWidth = Math.max(1, bounds.width - margin * 2), maxHeight = Math.max(1, bounds.height - top - margin)
  const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const width = Math.round(Math.min(maxWidth, Math.max(Math.min(360, maxWidth), finite(requested?.width, Math.min(840, maxWidth)))))
  const height = Math.round(Math.min(maxHeight, Math.max(Math.min(340, maxHeight), finite(requested?.height, Math.min(660, maxHeight)))))
  return { width, height,
    x: Math.round(Math.max(margin, Math.min(bounds.width - margin - width, finite(requested?.x, (bounds.width - width) / 2)))),
    y: Math.round(Math.max(top, Math.min(bounds.height - margin - height, finite(requested?.y, top)))) }
}
