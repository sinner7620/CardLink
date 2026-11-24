/**
 * Vendored from dsh-context (Apache-2.0)
 * https://github.com/bowenliang123/dsh-context/tree/459e2369a4ff6caee912cf8b6dfc35cfac8c77c1
 *   src/client/components/trendChart.tsx   （图形与标记：拆离后移植）
 *   src/client/components/trendModel.ts    （TURN_FILLS）
 *
 * CardLink 修改（说明为什么不是整文件照搬）：
 *  dsh-context 的趋势图与宿主强耦合：RequestRecord 带 turn/step/stepCount/activeMs、
 *  分类来自 DNA 条带（dna/dnaAt）、纤程级虚拟滚动（trendWindow）、耗时曲线
 *  （trendDurationCurve）、增量模式与自适应缩放。H1 遥测只有"每次 Assistant 请求"的
 *  六项分项与压缩标记，没有步骤/轮次分类、DNA 条带、耗时或增量基线。因此按上游同一份
 *  渲染结构拆出可用部分，逐项对应如下（类名与样式全部来自上游 CSS，未新造视觉）：
 *
 *   保留：lc-chartrow / lc-axis(5 档刻度) / lc-chart-wrap / lc-chart-scroll / lc-chart /
 *         lc-grid(顶/3/4/中/1/4/零线) / lc-bar(role=button, tabIndex, aria-pressed,
 *         Enter·Space 选中) / lc-bar-stack + lc-cat-seg(按分项堆叠) / lc-bar-marker(✂ 压缩标记) /
 *         lc-trend-flag(每 5 根序号) / lc-turns + lc-turn(轮次行) / lc-chart-tip(悬停读数)
 *   拆离：lc-bar-up / lc-bar-dna / lc-dna-hl / lc-duration / lc-chart-fit / lc-chart-dim
 *         （依赖 DNA、耗时与轮次选择，H1 无对应数据）
 *   替换：虚拟滚动 → 直接渲染（H1 单会话最多 60 条，见 use-harness-chat 的有界分页）；
 *         turn/step 文案 → H1 的"第 N 轮 / 第 M 次请求"。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import type { PartsPart } from './categories'
import type { LcKit } from './kit'
import { clampTipLeft } from './tip'

/** 与上游 trendWindow.ts 的常量一致（同时也是 trendChart.css 里 .lc-bar 宽度与 gap）。 */
export const BAR_W = 14
export const BAR_GAP = 2
/** 上游趋势图绘图区高度（.lc-chart 高 130 - 顶部 18）。 */
export const CHART_H = 112
const STEP_FLAG_EVERY = 5

/** 上游 trendModel.ts 的 TURN_FILLS（原样）。 */
export const TURN_FILLS = [
  'color-mix(in srgb, var(--color-neutral-500) 12%, transparent)',
  'color-mix(in srgb, var(--color-neutral-500) 26%, transparent)',
]

export type TrendPoint = {
  /** 会话内全局序号（1 起），用于柱位与 aria。 */
  seq: number
  total: number
  parts: PartsPart[]
  /** 该请求是否新建了压缩记录（上游用 ✂ 标记压缩事件）。 */
  compaction: boolean
  /** 轮次键（H1 用 runId）与轮次序号（1 起），用于 lc-turns 行。 */
  runKey: string
  runIndex: number
  runStep: number
  /** 悬停读数的首行（"第 N 轮 · 第 M 次请求"）与次行（时间/模型）。 */
  headText: string
  metaText: string
}

export interface TrendChartProps {
  points: TrendPoint[]
  selectedSeq: number | null
  hoveredSeq: number | null
  onSelect: (seq: number | null) => void
  onHover: (seq: number | null) => void
  /** 悬停/选中的分项键：与构成条联动（上游 data-catdim 行为）。 */
  focusCat?: string | null
}

type TurnGroup = { runKey: string; runIndex: number; count: number; width: number; offset: number }

export function makeTrendChart(kit: LcKit): (props: TrendChartProps) => ReactElement {
  const { fmt } = kit

  return function TrendChart(props: TrendChartProps): ReactElement {
    const points = props.points
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const tipRef = useRef<HTMLDivElement | null>(null)
    const [scrollLeft, setScrollLeft] = useState(0)
    const [tipWidth, setTipWidth] = useState(0)

    const maxTotal = useMemo(() => {
      let max = 1
      for (const p of points) if (p.total > max) max = p.total
      return max
    }, [points])

    const groups = useMemo<TurnGroup[]>(() => {
      const out: TurnGroup[] = []
      let offset = 0
      for (const point of points) {
        const last = out.length > 0 ? out[out.length - 1] : null
        if (last === null || last.runKey !== point.runKey) {
          const group: TurnGroup = { runKey: point.runKey, runIndex: point.runIndex, count: 0, width: BAR_W, offset }
          out.push(group)
        }
        const group = out[out.length - 1]
        group.count += 1
        group.width = group.count * (BAR_W + BAR_GAP) - BAR_GAP
        offset = group.offset + group.width + BAR_GAP
      }
      return out
    }, [points])

    const hoveredIndex = props.hoveredSeq === null ? -1 : points.findIndex((p) => p.seq === props.hoveredSeq)
    const hovered = hoveredIndex >= 0 ? points[hoveredIndex] : null

    const handleScroll = useCallback((event: { currentTarget: HTMLDivElement }) => {
      setScrollLeft(event.currentTarget.scrollLeft)
    }, [])

    // 新建柱时保持贴右（上游行为：首次与新增后滚到最新）。
    const lastSeq = points.length > 0 ? points[points.length - 1].seq : 0
    const prevSeq = useRef(0)
    useEffect(() => {
      const el = scrollRef.current
      if (el === null) return
      if (prevSeq.current !== lastSeq) {
        prevSeq.current = lastSeq
        el.scrollLeft = el.scrollWidth
        setScrollLeft(el.scrollLeft)
      }
    }, [lastSeq])

    useEffect(() => {
      setTipWidth(tipRef.current?.getBoundingClientRect().width ?? 0)
    }, [hoveredIndex, props.hoveredSeq])

    const clientWidth = scrollRef.current?.clientWidth ?? 0
    const tipLeft = hoveredIndex >= 0
      ? clampTipLeft(hoveredIndex * (BAR_W + BAR_GAP) + BAR_W / 2 - scrollLeft, tipWidth, clientWidth || tipWidth)
      : 0

    return (
      <div className="lc-chartrow">
        <div className="lc-axis">
          <span className="lc-axis-top">{fmt(maxTotal)}</span>
          <span className="lc-axis-q3">{fmt(Math.round(maxTotal * 3 / 4))}</span>
          <span className="lc-axis-mid">{fmt(Math.round(maxTotal / 2))}</span>
          <span className="lc-axis-q1">{fmt(Math.round(maxTotal / 4))}</span>
          <span className="lc-axis-bot">{'0'}</span>
        </div>
        <div className="lc-chart-wrap" ref={wrapRef}>
          <div
            className="lc-chart-scroll"
            onScroll={handleScroll}
            ref={scrollRef}
          >
            <div className="lc-chart" data-lc-bars={points.length} data-catdim={props.focusCat ?? undefined}>
              <div className="lc-grid lc-grid-top" />
              <div className="lc-grid lc-grid-q3" />
              <div className="lc-grid lc-grid-q1" />
              <div className="lc-grid lc-grid-mid" />
              <div className="lc-grid lc-grid-zero" />
              {points.map((point, index) => {
                const selected = props.selectedSeq === point.seq
                const flag = (index + 1) % STEP_FLAG_EVERY === 0 ? index + 1 : null
                return (
                  <div
                    key={point.seq}
                    className={'lc-bar' + (selected ? ' lc-bar-selected' : '') + (props.hoveredSeq === point.seq ? ' lc-bar-hovered' : '')}
                    data-seq={point.seq}
                    style={{ width: `${BAR_W}px` }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${point.headText} · ${point.metaText} · 合计 ≈ ${fmt(point.total)}`}
                    aria-pressed={selected}
                    onClick={() => { props.onSelect(selected ? null : point.seq) }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      props.onSelect(selected ? null : point.seq)
                    }}
                    onMouseEnter={() => { props.onHover(point.seq) }}
                  >
                    {flag !== null ? (
                      <span className="lc-trend-flag" aria-hidden="true"><span className="lc-trend-flag-label">{flag}</span></span>
                    ) : null}
                    {point.compaction ? (
                      <span className="lc-bar-marker" title={point.headText}>✂</span>
                    ) : null}
                    <div className="lc-bar-stack" style={{ '--lc-i': Math.min(index, 8) } as CSSProperties}>
                      {point.parts.map((part) => {
                        if (!part.value) return null
                        return (
                          <div
                            key={part.key}
                            data-cat={part.key}
                            className="lc-cat-seg"
                            style={{ height: `${Math.max(1, Math.round(part.value / maxTotal * CHART_H))}px`, background: part.color }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="lc-turns" onMouseLeave={() => { props.onHover(null) }}>
              {groups.map((group, index) => (
                <span
                  key={group.runKey}
                  className="lc-turn"
                  style={{ width: `${group.width}px`, background: TURN_FILLS[index % TURN_FILLS.length] }}
                  title={`第 ${group.runIndex} 轮`}
                >
                  <span className="lc-turn-label">{group.runIndex}</span>
                </span>
              ))}
            </div>
          </div>
          {hovered !== null ? (
            <div
              className="lc-chart-tip"
              ref={tipRef}
              style={{ left: `${hoveredIndex * (BAR_W + BAR_GAP) + BAR_W / 2}px`, transform: `translate(${tipLeft}px, 0)` }}
            >
              <span>{hovered.headText}</span>
              <span>{hovered.metaText}</span>
              <span>{`合计 ≈ ${fmt(hovered.total)}`}</span>
            </div>
          ) : null}
        </div>
      </div>
    )
  }
}
