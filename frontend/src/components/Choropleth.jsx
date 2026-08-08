import { useMemo, useRef, useState } from 'react'

/*
 * Hand-rolled SVG choropleth.
 *
 * No map library and no tile server: the boundary file is a static asset built
 * once by backend/scripts/build-boundaries.js, so the map costs nothing to
 * serve, needs no API key, and renders offline. At 2.3 degrees across, a plain
 * equirectangular projection with a cos(lat) width correction is accurate to
 * well under a pixel — a real projection would be ceremony.
 *
 * Colour is a SEQUENTIAL encoding (magnitude) by default: one hue, light to
 * dark, six bins. Bins are computed once across every year on screen so
 * switching year shows real change rather than a repainted scale. "No data" is
 * deliberately outside the ramp — absence is not a low value.
 *
 * Pass `fillOf` to opt out of that and colour by category instead. Risk level
 * is the case that needs it: it is an ordinal STATUS, not a magnitude, and it
 * wears the reserved green→red status scale. Quantile bins would be wrong
 * there twice over — they would invent gradations inside "severe" and force a
 * fixed share of regions into each level regardless of the actual levels.
 */

const RAMP = ['--seq-100', '--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600']

function project(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const w = (maxLng - minLng) * k
  const h = maxLat - minLat
  return {
    width: w,
    height: h,
    point: ([lng, lat]) => [(lng - minLng) * k, maxLat - lat],
  }
}

function pathFor(geometry, point) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let d = ''
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach((c, i) => {
        const [x, y] = point(c)
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(4)} ${y.toFixed(4)}`
      })
      d += 'Z'
    }
  }
  return d
}

/** Quantile edges over the non-null values, deduped and rounded for labels. */
export function makeBins(values, count = RAMP.length) {
  const xs = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v)).sort((a, b) => a - b)
  if (xs.length === 0) return []
  const edges = []
  for (let i = 1; i < count; i += 1) {
    const q = xs[Math.floor((i / count) * xs.length)]
    edges.push(q)
  }
  // A skewed distribution can repeat a quantile; collapse so no bin is empty.
  return [...new Set(edges)].sort((a, b) => a - b)
}

function binOf(value, edges) {
  if (value === null || value === undefined || !Number.isFinite(value)) return -1
  let i = 0
  while (i < edges.length && value >= edges[i]) i += 1
  return i
}

/*
 * A stable, unique identity per feature.
 *
 * This has to work across two boundary files with different property sets:
 * the national layer carries `slug`, the municipal one carries
 * `province` + `key` (and needs both — there are two Rosarios). Falling back
 * to the array index would be wrong for reconciliation but is still better
 * than a duplicate: an earlier version keyed on `province-key`, which for the
 * national layer evaluated to "undefined-undefined" for all 17 features, so
 * React could not tell them apart and 16 stale paths survived a scope switch.
 */
const featureKey = (f, i) => {
  const p = f.properties ?? {}
  if (p.slug) return `slug:${p.slug}`
  if (p.key) return `lgu:${p.province ?? ''}:${p.key}`
  return `idx:${i}`
}

export default function Choropleth({
  features,
  bbox,
  valueOf,
  bins,
  fillOf,            // (feature) => css colour; overrides the sequential ramp
  formatValue,
  renderTooltip,
  ariaLabel,
  height = 460,
}) {
  const wrapRef = useRef(null)
  const [hovered, setHovered] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })

  const proj = useMemo(() => project(bbox), [bbox])

  const paths = useMemo(
    () => features.map((f, i) => ({ feature: f, id: featureKey(f, i), d: pathFor(f.geometry, proj.point) })),
    [features, proj],
  )

  const show = (feature, id, e) => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (box) {
      const cx = e.clientX ?? (e.target.getBoundingClientRect().left + e.target.getBoundingClientRect().width / 2)
      const cy = e.clientY ?? e.target.getBoundingClientRect().top
      setTipPos({ x: cx - box.left, y: cy - box.top })
    }
    setHovered(feature)
    setHoveredId(id)
  }

  // CALABARZON is almost square, so a fixed height inside a wide card would
  // letterbox it. Cap the width at the shape's own aspect ratio and centre it.
  const aspect = proj.width / proj.height

  return (
    <div
      className="map-wrap"
      ref={wrapRef}
      style={{ maxWidth: Math.round(height * aspect), marginInline: 'auto' }}
    >
      <svg
        viewBox={`0 0 ${proj.width} ${proj.height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        <g>
          {paths.map(({ feature, id, d }) => {
            const value = valueOf(feature)
            const i = binOf(value, bins)
            const fill = fillOf
              ? fillOf(feature)
              : i === -1 ? 'var(--surface-3)' : `var(${RAMP[Math.min(i, RAMP.length - 1)]})`
            const active = hoveredId === id
            return (
              <path
                key={id}
                d={d}
                fill={fill}
                // A hairline in the surface colour separates neighbours; it is
                // spacing, not a stroke drawn to add weight.
                stroke={active ? 'var(--ink-1)' : 'var(--surface-1)'}
                strokeWidth={active ? proj.width / 420 : proj.width / 1400}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                tabIndex={0}
                role="button"
                // The two layers carry different secondary labels — province
                // for a municipality, slug for a region — so neither is assumed.
                aria-label={[feature.properties.name, feature.properties.province]
                  .filter(Boolean).join(', ') + `: ${formatValue(value)}`}
                onMouseMove={(e) => show(feature, id, e)}
                onMouseLeave={() => { setHovered(null); setHoveredId(null) }}
                onFocus={(e) => show(feature, id, e)}
                onBlur={() => { setHovered(null); setHoveredId(null) }}
                style={{ cursor: 'pointer', outline: 'none' }}
              />
            )
          })}
        </g>
      </svg>

      {hovered && (
        <div
          className="map-tip"
          style={{
            left: Math.min(Math.max(tipPos.x + 14, 8), (wrapRef.current?.clientWidth ?? 0) - 210),
            top: Math.max(tipPos.y - 8, 8),
          }}
        >
          {renderTooltip(hovered)}
        </div>
      )}
    </div>
  )
}

export function ChoroplethLegend({ bins, formatValue, label, hasNoData }) {
  if (!bins.length) return null
  const ranges = [
    `< ${formatValue(bins[0])}`,
    ...bins.slice(0, -1).map((b, i) => `${formatValue(b)} – ${formatValue(bins[i + 1])}`),
    `≥ ${formatValue(bins.at(-1))}`,
  ]

  return (
    <div className="map-legend">
      <span className="map-legend-label">{label}</span>
      <div className="map-legend-scale">
        {ranges.map((r, i) => (
          <span className="map-legend-step" key={r}>
            <span className="map-legend-swatch" style={{ background: `var(${RAMP[Math.min(i, RAMP.length - 1)]})` }} />
            <span className="map-legend-range">{r}</span>
          </span>
        ))}
        {hasNoData && (
          <span className="map-legend-step">
            <span className="map-legend-swatch" style={{ background: 'var(--surface-3)' }} />
            <span className="map-legend-range">No data</span>
          </span>
        )}
      </div>
    </div>
  )
}
