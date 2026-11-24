/**
 * Vendored from dsh-context (Apache-2.0)
 * https://github.com/bowenliang123/dsh-context/tree/459e2369a4ff6caee912cf8b6dfc35cfac8c77c1
 *   src/client/components/currentComposition.tsx
 *
 * CardLink 修改（最小适配）：
 *  - `IconGauge` 来自上游私有 primitives 包，改为 lucide-react 的 `GaugeIcon`（同形同尺寸 14）；
 *  - `Headline` 类型指向本地 vendor 文件；`ViewKit` 改为 `LcKit`；
 *  - 结构、类名（lc-card / lc-overview-* / lc-stacked / lc-legend）、文案键与布局未改。
 */
import { type ReactElement } from 'react'
import { GaugeIcon } from 'lucide-react'
import type { Headline } from './headline'
import type { LcKit } from './kit'
import type { LegendProps, StackedBarProps } from './stackedBar'

type LegendFn = (props: LegendProps) => ReactElement

export interface CurrentCompositionProps {
  head: Headline
  subtitle?: string
  hoverKey?: string | null
  onHoverKey?: (key: string | null) => void
}

export function makeCurrentComposition(
  kit: LcKit,
  StackedBar: (props: StackedBarProps) => ReactElement,
  Legend: LegendFn,
): (props: CurrentCompositionProps) => ReactElement {
  const { t, fmt } = kit
  return function CurrentComposition(props: CurrentCompositionProps): ReactElement {
    const head = props.head
    return (
      <div className="lc-card" data-lc-current>
        <div className="lc-card-title">
          <span className="lc-card-title-text">
            <GaugeIcon size={14} />
            {t('overview.title')}
          </span>
          {props.subtitle !== undefined && props.subtitle !== ''
            ? <span className="lc-card-sub">{props.subtitle}</span>
            : null}
        </div>
        <div className="lc-overview-num">
          <b>{fmt(head.tokens)}</b>
          <span>
            {head.window
              ? ' / ' + fmt(head.window) + ' tokens'
              : ' ' + t('overview.estimate')}
          </span>
          {head.pct !== null ? (
            <span className="lc-overview-pct">
              <b>{`${head.pct.toFixed(1)}%`}</b>
              {t('overview.used')}
            </span>
          ) : null}
        </div>
        <StackedBar
          parts={head.parts}
          height={16}
          max={head.window}
          hoverKey={props.hoverKey}
          onHoverKey={props.onHoverKey}
          reserve={head.reserve}
        />
        <Legend parts={head.parts} hoverKey={props.hoverKey} onHoverKey={props.onHoverKey} />
      </div>
    )
  }
}
