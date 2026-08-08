import { useEffect, useMemo, useState } from 'react'
import { useFetch } from '../hooks/useFetch.js'
import { alertsApi } from '../services/api.js'
import { Card, CardBody, CardFoot, CardHead } from '../components/Card.jsx'
import { PageHeader, Select } from '../components/Controls.jsx'
import { AsyncSection, EmptyState, SkeletonBlock, SkeletonRows } from '../components/States.jsx'
import DataTable from '../components/DataTable.jsx'
import RiskBadge from '../components/RiskBadge.jsx'
import Choropleth from '../components/Choropleth.jsx'
import Icon from '../components/Icon.jsx'
import {
  RISK_ORDER, formatDate, formatInt, formatNumber, formatRelative, riskRank, titleCase, toNumber,
} from '../lib/format.js'

/*
 * Alerts = map + table over the same 17 regions.
 *
 * The map is the existing hand-rolled SVG choropleth driven by
 * public/ph-regions.geojson, not Leaflet. Two reasons it has to be this one:
 * `regions.lat/lng` is NULL for every study region, so there are no markers to
 * place; and a tile layer would put a basemap's roads and labels underneath a
 * public-health signal, which is decoration competing with data.
 *
 * Colour here is the reserved STATUS scale (green → red), passed through
 * `fillOf` so the choropleth's sequential quantile ramp is bypassed entirely —
 * see the note in Choropleth.jsx. Every region also appears in the table with
 * a written level, so the level is never carried by colour alone.
 */

const LEVEL_OPTIONS = [
  { value: 'all', label: 'All levels' },
  { value: 'elevated', label: 'High and severe only' },
  ...RISK_ORDER.map((l) => ({ value: l, label: titleCase(l) })),
]

// The four status hues, plus an explicit slot for "no alert issued". A region
// nobody has assessed must not be painted the same green as one assessed and
// found safe — that would tell a health officer an unmonitored region is fine.
const RISK_FILL = {
  low: 'var(--status-good)',
  moderate: 'var(--status-warning)',
  high: 'var(--status-serious)',
  severe: 'var(--status-critical)',
}
const NO_ALERT_FILL = 'var(--surface-3)'

const REFERENCE_YEAR = 2019

export default function Alerts() {
  const [level, setLevel] = useState('all')
  const [geo, setGeo] = useState(null)
  const [geoError, setGeoError] = useState(null)

  const { data: alerts, loading, error, refetch } = useFetch(() => alertsApi.list(), [])
  const {
    data: regionRisk, loading: riskLoading, error: riskError, refetch: refetchRisk,
  } = useFetch(() => alertsApi.regions(REFERENCE_YEAR), [])

  // The boundary file is a static asset, so it is fetched directly rather than
  // through the API client — it never touches the backend.
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}ph-regions.geojson`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (alive) setGeo(j) })
      .catch((e) => { if (alive) setGeoError(e) })
    return () => { alive = false }
  }, [])

  const list = alerts ?? []
  const risk = useMemo(() => regionRisk ?? [], [regionRisk])

  /* Slug → context row, so a map feature can find its numbers in O(1). */
  const bySlug = useMemo(() => new Map(risk.map((r) => [r.region_slug, r])), [risk])

  const counts = useMemo(() => {
    const out = Object.fromEntries(RISK_ORDER.map((l) => [l, 0]))
    let none = 0
    for (const r of risk) {
      const key = String(r.risk_level ?? '').toLowerCase()
      if (key in out) out[key] += 1
      else none += 1
    }
    return { ...out, none }
  }, [risk])

  const filtered = useMemo(() => {
    if (level === 'all') return list
    if (level === 'elevated') return list.filter((a) => riskRank(a.risk_level) >= riskRank('high'))
    return list.filter((a) => String(a.risk_level).toLowerCase() === level)
  }, [list, level])

  const mapReady = Boolean(geo?.features?.length) && risk.length > 0

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Current risk level for each of the 17 study regions, on the map and in the table. Hover a region to see the numbers behind its level."
      />

      <div className="filter-bar">
        <span className="filter-bar-label">Risk level</span>
        <Select label="Risk level" hideLabel value={level} onChange={setLevel} options={LEVEL_OPTIONS} />
        <span className="filter-bar-spacer" />
        {RISK_ORDER.map((l) => (
          <span key={l} className="legend-item">
            <RiskBadge level={l} />
            <span className="tnum" style={{ fontWeight: 600, color: 'var(--ink-1)' }}>{counts[l]}</span>
          </span>
        ))}
      </div>

      {/* ---------------------------- MAP ---------------------------- */}
      <Card className="section-gap">
        <CardHead
          title="Risk by region"
          description={`Colour is the current risk level, not a magnitude. Context figures are for ${REFERENCE_YEAR}.`}
          actions={(
            <button type="button" className="btn btn-secondary btn-sm" onClick={refetchRisk} disabled={riskLoading}>
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          )}
        />
        <CardBody>
          <AsyncSection
            loading={riskLoading || (!geo && !geoError)}
            error={riskError ?? geoError}
            hasData={mapReady}
            isEmpty={Boolean(regionRisk) && risk.length === 0}
            onRetry={refetchRisk}
            errorTitle="Could not load the risk map"
            skeleton={<SkeletonBlock height={420} />}
            empty={(
              <EmptyState
                icon="map"
                title="No regional risk data"
                body="Run npm run seed:fixtures in the backend to load demo alerts, or wait for a model run to write real ones."
              />
            )}
          >
            <div className="risk-map-layout">
              <Choropleth
                features={geo?.features ?? []}
                bbox={geo?.bbox ?? [116, 4, 127, 21]}
                /* The archipelago is taller than it is wide (aspect ~0.73), and
                   Choropleth caps width at height x aspect — so height is what
                   actually sizes this map. 480 left it stranded in a wide card. */
                height={640}
                valueOf={(f) => riskRank(bySlug.get(f.properties.slug)?.risk_level)}
                bins={[]}
                fillOf={(f) => {
                  const lvl = String(bySlug.get(f.properties.slug)?.risk_level ?? '').toLowerCase()
                  return RISK_FILL[lvl] ?? NO_ALERT_FILL
                }}
                formatValue={(v) => (v < 0 ? 'no alert' : `${titleCase(RISK_ORDER[v])} risk`)}
                ariaLabel={`Risk level by region. ${risk
                  .filter((r) => r.risk_level)
                  .map((r) => `${r.region_name}: ${r.risk_level}`)
                  .join('. ')}. Every value is also listed in the table below.`}
                renderTooltip={(f) => <RiskTip row={bySlug.get(f.properties.slug)} name={f.properties.name} />}
              />

              <div className="risk-map-side">
                <RiskLegend counts={counts} />
                <p className="risk-map-hint">
                  <Icon name="info" size={14} />
                  Hover or tab to a region for its density, poverty, humidity and
                  recorded cases.
                </p>
              </div>
            </div>
          </AsyncSection>
        </CardBody>
        <CardFoot>
          Risk level is an ordinal status, so it uses the reserved green-to-red
          scale rather than the sequential ramp the other maps use. Regions with no
          alert are grey, never green — an unassessed region is not a safe one.
        </CardFoot>
      </Card>

      {/* --------------------------- TABLE --------------------------- */}
      <Card>
        <CardHead
          title={level === 'all' ? 'All alerts' : 'Filtered alerts'}
          description={`${filtered.length} of ${list.length} alert${list.length === 1 ? '' : 's'} shown, newest first.`}
          actions={(
            <button type="button" className="btn btn-secondary btn-sm" onClick={refetch} disabled={loading}>
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          )}
        />

        <AsyncSection
          loading={loading}
          error={error}
          hasData={list.length > 0}
          isEmpty={filtered.length === 0}
          onRetry={refetch}
          errorTitle="Could not load alerts"
          skeleton={<SkeletonRows rows={5} />}
          empty={list.length === 0 ? (
            <EmptyState
              icon="shield"
              title="No alerts have been triggered"
              body="Alerts appear here once a model run writes a risk level for a region."
            />
          ) : (
            <EmptyState
              icon="inbox"
              title="No alerts at this level"
              body="Nothing matches the current filter. Widen it to see the rest."
            />
          )}
        >
          <DataTable
            caption="Region alerts"
            rows={filtered}
            getRowKey={(row) => row.id}
            columns={[
              { key: 'region_name', header: 'Region', className: 'cell-strong' },
              { key: 'risk_level', header: 'Risk level', render: (r) => <RiskBadge level={r.risk_level} /> },
              {
                key: 'cases',
                header: `Cases ${REFERENCE_YEAR}`,
                align: 'right',
                render: (r) => {
                  const c = bySlug.get(r.region_slug)?.confirmed_cases
                  return c === undefined || c === null
                    ? <span className="cell-quiet">—</span>
                    : <span className="tnum">{formatInt(c)}</span>
                },
              },
              {
                key: 'inc',
                header: 'Per 100k',
                align: 'right',
                render: (r) => {
                  const v = bySlug.get(r.region_slug)?.incidence_per_100k
                  return v === undefined || v === null
                    ? <span className="cell-quiet">—</span>
                    : <span className="tnum">{formatInt(v)}</span>
                },
              },
              {
                key: 'date',
                header: 'Raised',
                render: (r) => {
                  // Past 60 days formatRelative falls back to the absolute date,
                  // which would print "Dec 1, 2019 · Dec 1, 2019".
                  const abs = formatDate(r.date)
                  const rel = formatRelative(r.date)
                  return (
                    <>
                      {abs}
                      {rel !== abs && <span className="cell-quiet"> · {rel}</span>}
                    </>
                  )
                },
              },
              {
                key: 'triggered_by_model_run_id',
                header: 'Model run',
                align: 'right',
                render: (r) => (r.triggered_by_model_run_id
                  ? <span className="mono">#{r.triggered_by_model_run_id}</span>
                  : <span className="cell-quiet">—</span>),
              },
            ]}
          />
        </AsyncSection>

        <CardFoot>
          Every badge pairs its colour with an icon and a written label, so the level
          is never carried by colour alone — the same values the map encodes are
          readable here without seeing the map.
        </CardFoot>
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */

function RiskTip({ row, name }) {
  if (!row) {
    return (
      <>
        <div className="map-tip-name">{name}</div>
        <div className="map-tip-sub">Not one of the 17 study regions</div>
      </>
    )
  }

  const dens = toNumber(row.population_density)
  const pov = toNumber(row.poverty_rate)
  const rh = toNumber(row.humidity)
  const cases = toNumber(row.confirmed_cases)
  const inc = toNumber(row.incidence_per_100k)
  const dash = <span className="cell-quiet">—</span>

  return (
    <>
      <div className="map-tip-name">{row.region_name}</div>
      <div className="map-tip-sub">
        {row.risk_level
          ? <RiskBadge level={row.risk_level} />
          : <span className="badge badge-neutral"><span className="badge-dot" />No alert</span>}
      </div>

      <div className="map-tip-row">
        <span>Population density</span>
        <span className="map-tip-value">{dens === null ? dash : `${formatInt(dens)}/km²`}</span>
      </div>
      <div className="map-tip-row">
        <span>Poverty incidence</span>
        <span className="map-tip-value">{pov === null ? dash : `${formatNumber(pov, { decimals: 1 })}%`}</span>
      </div>
      <div className="map-tip-row">
        <span>Mean humidity</span>
        <span className="map-tip-value">{rh === null ? dash : `${formatNumber(rh, { decimals: 1 })}%`}</span>
      </div>
      <div className="map-tip-row">
        <span>Recorded cases {REFERENCE_YEAR}</span>
        <span className="map-tip-value">{cases === null ? dash : formatInt(cases)}</span>
      </div>
      {inc !== null && (
        <div className="map-tip-row">
          <span>Per 100,000</span>
          <span className="map-tip-value">{formatInt(inc)}</span>
        </div>
      )}
    </>
  )
}

function RiskLegend({ counts }) {
  return (
    <div className="risk-legend">
      <span className="map-legend-label">Risk level</span>
      {/* Severe first: the legend reads in the order a reader scans for trouble. */}
      {[...RISK_ORDER].reverse().map((l) => (
        <div className="risk-legend-step" key={l}>
          <span className="risk-legend-swatch" style={{ background: RISK_FILL[l] }} />
          <span className="risk-legend-name">{titleCase(l)}</span>
          <span className="risk-legend-count tnum">{counts[l]}</span>
        </div>
      ))}
      {counts.none > 0 && (
        <div className="risk-legend-step">
          <span className="risk-legend-swatch" style={{ background: NO_ALERT_FILL }} />
          <span className="risk-legend-name">No alert</span>
          <span className="risk-legend-count tnum">{counts.none}</span>
        </div>
      )}
    </div>
  )
}
