import { useId } from 'react'
import { toNumber } from '../lib/format.js'

/*
 * A 12-point trend line for a stat tile. Decorative-adjacent: it carries no
 * value the tile doesn't already state, so it is aria-hidden and the last
 * point is the only one emphasised.
 */
export default function Sparkline({ values = [], width = 108, height = 26 }) {
  const clipId = useId()
  const points = values.map(toNumber).filter((v) => v !== null).slice(-12)
  if (points.length < 2) return null

  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const pad = 3
  const stepX = (width - pad * 2) / (points.length - 1)

  const coords = points.map((v, i) => [
    pad + i * stepX,
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ])

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${coords.at(-1)[0].toFixed(1)} ${height} L${coords[0][0].toFixed(1)} ${height} Z`
  const [lastX, lastY] = coords.at(-1)

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <clipPath id={clipId}>
        <rect x="0" y="0" width={width} height={height} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {/* ~10% wash, never a saturated block */}
        <path d={area} fill="var(--accent)" fillOpacity="0.10" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* 2px surface ring keeps the end dot legible over the line */}
        <circle cx={lastX} cy={lastY} r="3.5" fill="var(--accent)" stroke="var(--surface-1)" strokeWidth="2" />
      </g>
    </svg>
  )
}
