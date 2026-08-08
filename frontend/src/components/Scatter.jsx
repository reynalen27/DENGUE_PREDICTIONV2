import { useMemo, useRef, useState } from 'react'
import { toNumber } from '../lib/format.js'

/*
 * A small SVG scatter with an optional least-squares fit.
 *
 * Hand-rolled rather than Recharts because it needs two things Recharts makes
 * awkward: one point highlighted as "the selected region" while the rest stay
 * legible, and a fit line whose r is reported honestly beside it.
 *
 * Pearson r is computed here and shown with n, because r alone is
 * uninterpretable — r = 0.5 at n = 17 is a different claim from r = 0.5 at
 * n = 60, and this app draws both.
 */

export function pearson(xs, ys) {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? null : num / den
}

const PAD = { top: 14, right: 16, bottom: 34, left: 52 }

export default function Scatter({
  points,            // [{ x, y, label, sublabel, highlight }]
  xLabel,
  yLabel,
  formatX = (v) => v,
  formatY = (v) => v,
  height = 260,
  logX = false,      // plot x on log10 — for predictors spanning orders of magnitude
  clampX0 = false,   // never pad the x axis below zero (counts, rates, densities)
  t,
}) {
  const wrapRef = useRef(null)
  const [hovered, setHovered] = useState(null)

  /*
   * On a log axis every position, tick and fit is computed in log space, but
   * the reader must still see real units — so `x` carries the plotting value
   * and `raw` the value we print. Non-positive x cannot be logged and is
   * dropped; `n` in the footer counts what is actually drawn, so the reader is
   * never told 17 points when 16 are on screen.
   */
  const clean = useMemo(
    () => points
      .filter((p) => Number.isFinite(toNumber(p.x)) && Number.isFinite(toNumber(p.y)))
      .filter((p) => !logX || toNumber(p.x) > 0)
      .map((p) => ({
        ...p,
        raw: toNumber(p.x),
        x: logX ? Math.log10(toNumber(p.x)) : toNumber(p.x),
        y: toNumber(p.y),
      })),
    [points, logX],
  )

  const stats = useMemo(() => {
    if (clean.length < 3) return null
    const xs = clean.map((p) => p.x)
    const ys = clean.map((p) => p.y)
    const r = pearson(xs, ys)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    // least squares, for the trend line only
    const n = xs.length
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = ys.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i += 1) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
    const slope = den === 0 ? 0 : num / den
    return { r, minX, maxX, minY, maxY, slope, intercept: my - slope * mx, n }
  }, [clean])

  if (!stats) {
    return <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Not enough points to plot.</p>
  }

  const W = 520
  const H = height
  const padX = (stats.maxX - stats.minX) * 0.06 || 1
  const padY = (stats.maxY - stats.minY) * 0.08 || 1
  // Padding a density axis into negative numbers prints "-1,166 per km²" under
  // the chart, which is not a quantity that exists.
  const x0 = clampX0 && !logX ? Math.max(0, stats.minX - padX) : stats.minX - padX
  const x1 = stats.maxX + padX
  const y0 = Math.max(0, stats.minY - padY)
  const y1 = stats.maxY + padY

  const sx = (v) => PAD.left + ((v - x0) / (x1 - x0)) * (W - PAD.left - PAD.right)
  const sy = (v) => H - PAD.bottom - ((v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom)

  const ticksX = [x0, (x0 + x1) / 2, x1]
  const ticksY = [y0, (y0 + y1) / 2, y1]

  const fitFrom = { x: x0, y: stats.intercept + stats.slope * x0 }
  const fitTo = { x: x1, y: stats.intercept + stats.slope * x1 }

  return (
    <div className="scatter" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img" aria-label={`${yLabel} against ${xLabel}${logX ? ', x on a log scale' : ''}. Pearson r ${stats.r?.toFixed(2)} over ${stats.n} points. Values are listed in the table view.`}>
        {/* gridlines: hairline, one step off surface, never dashed */}
        {ticksY.map((v) => (
          <line key={`gy${v}`} x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)}
            stroke={t.grid} strokeWidth="1" />
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom}
          stroke={t.axis} strokeWidth="1" />

        {ticksX.map((v) => (
          <text key={`tx${v}`} x={sx(v)} y={H - PAD.bottom + 15} fill={t.ink3} fontSize="10"
            textAnchor="middle">{formatX(logX ? 10 ** v : v)}</text>
        ))}
        {ticksY.map((v) => (
          <text key={`ty${v}`} x={PAD.left - 8} y={sy(v) + 3.5} fill={t.ink3} fontSize="10"
            textAnchor="end">{formatY(v)}</text>
        ))}

        {/* The fit is a reference, not a series — thin and recessive, so it
            never outweighs the points it summarises. */}
        <line x1={sx(fitFrom.x)} y1={sy(fitFrom.y)} x2={sx(fitTo.x)} y2={sy(fitTo.y)}
          stroke={t.axis} strokeWidth="1.5" />

        {clean.map((p) => {
          const on = hovered === p.label
          return (
            <circle
              key={p.label}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={p.highlight ? 7 : on ? 6.5 : 5}
              fill={p.highlight ? t.series2 : t.series1}
              stroke={t.surface}
              strokeWidth="2"
              tabIndex={0}
              role="button"
              aria-label={`${p.label}: ${xLabel} ${formatX(p.raw)}, ${yLabel} ${formatY(p.y)}`}
              onMouseEnter={() => setHovered(p.label)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(p.label)}
              onBlur={() => setHovered(null)}
              style={{ cursor: 'pointer', outline: 'none' }}
            />
          )
        })}

        <text x={W / 2} y={H - 4} fill={t.ink3} fontSize="10" textAnchor="middle">{xLabel}</text>
        <text x={12} y={H / 2} fill={t.ink3} fontSize="10" textAnchor="middle"
          transform={`rotate(-90 12 ${H / 2})`}>{yLabel}</text>
      </svg>

      <div className="scatter-foot">
        <span className={`scatter-r ${Math.abs(stats.r) >= 0.5 ? 'is-strong' : ''}`}>
          r = {stats.r === null ? '—' : stats.r.toFixed(2)}
        </span>
        <span className="scatter-n">n = {stats.n}</span>
        {logX && <span className="scatter-n">log scale</span>}
        {hovered && <span className="scatter-hover">{hovered}</span>}
      </div>
    </div>
  )
}
