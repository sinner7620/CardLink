import React, { useLayoutEffect, useRef } from 'react'
import { progressiveAcrylic } from './vendor/progressive-acrylic'

export function AcrylicSurface() {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const engine = progressiveAcrylic(ref.current, {
      blur: { direction: 'top', position: 'bottom', height: '100%', layers: 6, maxBlur: 110, startOpacity: 0, endOpacity: 1 },
    })
    return () => engine.destroy()
  }, [])
  return <div ref={ref} className="mistakeAcrylic" aria-hidden="true" />
}
