import { useEffect, useState } from 'react'
import { useTheme } from '../theme/ThemeContext.jsx'

/*
 * Recharts writes colours into SVG attributes, and a few of its internals
 * (gradient stops, the tooltip cursor) don't accept var(). Resolving the
 * tokens to concrete values once per theme keeps the chart honest about the
 * active mode while leaving the tokens as the single source of truth.
 */

const ROLES = {
  surface: '--surface-1',
  grid: '--line-grid',
  axis: '--line-strong',
  ink1: '--ink-1',
  ink2: '--ink-2',
  ink3: '--ink-3',
  series1: '--series-1',
  series2: '--series-2',
  series3: '--series-3',
  series4: '--series-4',
  series5: '--series-5',
  accent: '--accent',
  divNeg: '--div-neg',
  divPos: '--div-pos',
  divMid: '--div-mid',
  good: '--status-good',
  warning: '--status-warning',
  serious: '--status-serious',
  critical: '--status-critical',
}

function read() {
  const cs = getComputedStyle(document.documentElement)
  const out = {}
  for (const [key, prop] of Object.entries(ROLES)) {
    out[key] = cs.getPropertyValue(prop).trim()
  }
  return out
}

export function useChartTheme() {
  const { resolved } = useTheme()
  const [tokens, setTokens] = useState(read)

  useEffect(() => {
    // The data-theme attribute lands in the same commit; read on the next
    // frame so the resolved values belong to the new mode.
    const id = requestAnimationFrame(() => setTokens(read()))
    return () => cancelAnimationFrame(id)
  }, [resolved])

  return tokens
}

/** Ordered categorical slots — assigned in sequence, never cycled. */
export function seriesSlots(t) {
  return [t.series1, t.series2, t.series3, t.series4, t.series5]
}

export const STATUS_ROLE = {
  low: 'good',
  moderate: 'warning',
  high: 'serious',
  severe: 'critical',
}
