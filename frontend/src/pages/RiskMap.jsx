import { useEffect, useMemo, useState } from 'react'
import { useFetch } from '../hooks/useFetch.js'
import { surveillanceApi } from '../services/api.js'
import { Card, CardBody, CardFoot, CardHead } from '../components/Card.jsx'
import { PageHeader, Select, ViewToggle } from '../components/Controls.jsx'
import { AsyncSection, EmptyState, SkeletonBlock } from '../components/States.jsx'
import Choropleth, { ChoroplethLegend, makeBins } from '../components/Choropleth.jsx'
import DataTable from '../components/DataTable.jsx'
import StatCard from '../components/StatCard.jsx'
import { formatInt, formatNumber, toNumber } from '../lib/format.js'

const METRICS = {
  cases: {
    label: 'Confirmed cases',
    short: 'cases',
    legend: 'Confirmed cases',
    format: (v) => (v === null ? '—' : formatInt(v)),
    of: (row) => toNumber(row.confirmed_cases),
  },
  incidence: {
    label: 'Cases per 100,000',
    short: 'per 100k',
    legend: 'Cases per 100,000 (2020 census)',
    format: (v) => (v === null ? '—' : formatNumber(v, { decimals: 1 })),
    of: (row) => {
      const cases = toNumber(row.confirmed_cases)
      const pop = toNumber(row.population)
      return cases === null || !pop ? null : (cases / pop) * 1e5
    },
  },
}

/** The boundary file is a committed static asset — no tile server, no API key. */
function useBoundaries() {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}calabarzon-lgus.geojson`)
      .then((r) => {
        if (!r.ok) throw new Error(`Boundary file returned HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }))
    return () => { alive = false }
  }, [])
  return state
}

export default function RiskMap() {
  const [metricKey, setMetricKey] = useState('incidence')
  const [year, setYear] = useState(null)
  const [view, setView] = useState('chart')

  const { data: rows, loading, error, refetch } = useFetch(() => surveillanceApi.annual(), [])
  const { data: geo, error: geoError, loading: geoLoading } = useBoundaries()

  const metric = METRICS[metricKey]
  const records = rows ?? []

  const years = useMemo(
    () => [...new Set(records.map((r) => r.year))].sort((a, b) => b - a),
    [records],
  )
  const activeYear = year ?? years[0] ?? null

  /*
   * Bins are computed across EVERY year, not just the one on screen, so the
   * scale holds still while the reader steps through years. Recomputing per
   * year would repaint the whole map on every change and hide the growth
   * that is the entire point of stepping through it.
   */
  const bins = useMemo(() => makeBins(records.map(metric.of)), [records, metric])

  const byKey = useMemo(() => {
    const m = new Map()
    for (const r of records) {
      if (r.year !== activeYear) continue
      m.set(`${r.region_name}::${r.province}`, r)
    }
    return m
  }, [records, activeYear])

  const lookup = (feature) => byKey.get(`${feature.properties.name}::${feature.properties.province.toUpperCase()}`) ?? null
  const valueOf = (feature) => {
    const row = lookup(feature)
    return row ? metric.of(row) : null
  }

  const yearRows = records.filter((r) => r.year === activeYear)
  const total = yearRows.reduce((s, r) => s + (toNumber(r.confirmed_cases) ?? 0), 0)
  const deaths = yearRows.reduce((s, r) => s + (toNumber(r.deaths) ?? 0), 0)
  const worst = yearRows.reduce((best, r) => {
    const v = metric.of(r)
    if (v === null) return best
    return !best || v > metric.of(best) ? r : best
  }, null)
  const noData = geo ? geo.features.some((f) => valueOf(f) === null) : false

  const tableRows = useMemo(
    () => [...yearRows].sort((a, b) => (metric.of(b) ?? -1) - (metric.of(a) ?? -1)),
    [yearRows, metric],
  )

  const ready = Boolean(geo && records.length)

  return (
    <>
      <PageHeader
        title="Risk map"
        description="Confirmed dengue cases by city and municipality across CALABARZON, from the DOH annual surveillance tables."
      />

      <div className="filter-bar">
        <span className="filter-bar-label">Year</span>
        <Select
          label="Year"
          hideLabel
          value={activeYear ?? ''}
          onChange={(v) => setYear(Number(v))}
          options={years.map((y) => ({ value: y, label: String(y) }))}
          disabled={!years.length}
        />
        <span className="filter-bar-label" style={{ marginLeft: 'var(--sp-2)' }}>Metric</span>
        <Select
          label="Metric"
          hideLabel
          value={metricKey}
          onChange={setMetricKey}
          options={Object.entries(METRICS).map(([k, m]) => ({ value: k, label: m.label }))}
        />
        <span className="filter-bar-spacer" />
        <ViewToggle view={view} onChange={setView} label="Map view" />
      </div>

      <div className="grid grid-4">
        <StatCard
          label={`Confirmed cases, ${activeYear ?? '—'}`}
          value={formatInt(total)}
          sublabel="Across all 142 cities and municipalities"
          loading={loading && !records.length}
        />
        <StatCard
          label="Reported deaths"
          value={formatInt(deaths)}
          sublabel={total ? `${((deaths / total) * 100).toFixed(2)}% case fatality` : '—'}
          loading={loading && !records.length}
        />
        <StatCard
          label={`Highest ${metric.short}`}
          value={worst ? metric.format(metric.of(worst)) : '—'}
          sublabel={worst ? `${worst.region_name}, ${worst.province}` : '—'}
          loading={loading && !records.length}
        />
        <StatCard
          label="Municipalities mapped"
          value={geo ? formatInt(geo.features.length) : '—'}
          sublabel="Boundaries matched to the PSA gazetteer"
          loading={geoLoading}
        />
      </div>

      <div className={view === 'chart' ? 'grid grid-map section-gap' : 'section-gap'}>
      <Card>
        <CardHead
          title={`${metric.label} — ${activeYear ?? ''}`}
          // The ramp anchors to the surface, so "darker = higher" is only true
          // in light mode. This wording holds in both.
          description="Low values sit closest to the background, high values stand furthest from it. Bins are fixed across all five years, so stepping through them shows real change."
        />

        <AsyncSection
          loading={loading || geoLoading}
          error={error ?? geoError}
          hasData={ready}
          isEmpty={Boolean(rows) && records.length === 0}
          onRetry={refetch}
          errorTitle="Could not load the map"
          skeleton={<SkeletonBlock height={420} />}
          empty={(
            <EmptyState
              icon="data"
              title="No surveillance data loaded"
              body="Run npm run etl in the backend to import the CALABARZON research dataset."
            />
          )}
        >
          {view === 'chart' ? (
            <CardBody>
              <ChoroplethLegend
                bins={bins}
                formatValue={metric.format}
                label={metric.legend}
                hasNoData={noData}
              />
              {ready && (
                <Choropleth
                  features={geo.features}
                  bbox={geo.bbox}
                  bins={bins}
                  valueOf={valueOf}
                  formatValue={metric.format}
                  height={520}
                  ariaLabel={`Choropleth of ${metric.label} by municipality in CALABARZON, ${activeYear}. Values are listed in the table view.`}
                  renderTooltip={(feature) => {
                    const row = lookup(feature)
                    return (
                      <>
                        <p className="map-tip-name">{feature.properties.name}</p>
                        <p className="map-tip-sub">{feature.properties.province}</p>
                        <div className="map-tip-row">
                          <span>Cases</span>
                          <span className="map-tip-value">{row ? formatInt(row.confirmed_cases) : 'No data'}</span>
                        </div>
                        <div className="map-tip-row">
                          <span>Per 100k</span>
                          <span className="map-tip-value">
                            {row ? METRICS.incidence.format(METRICS.incidence.of(row)) : '—'}
                          </span>
                        </div>
                        <div className="map-tip-row">
                          <span>Deaths</span>
                          <span className="map-tip-value">{row ? formatInt(row.deaths) : '—'}</span>
                        </div>
                      </>
                    )
                  }}
                />
              )}
            </CardBody>
          ) : (
            <DataTable
              caption={`${metric.label} by municipality, ${activeYear}`}
              rows={tableRows}
              getRowKey={(r) => `${r.region_id}-${r.year}`}
              columns={[
                { key: 'region_name', header: 'Municipality', className: 'cell-strong' },
                { key: 'province', header: 'Province', render: (r) => <span className="cell-quiet">{r.province}</span> },
                { key: 'confirmed_cases', header: 'Cases', align: 'right', render: (r) => formatInt(r.confirmed_cases) },
                { key: 'deaths', header: 'Deaths', align: 'right', render: (r) => (toNumber(r.deaths) ? formatInt(r.deaths) : <span className="cell-quiet">0</span>) },
                { key: 'population', header: 'Population 2020', align: 'right', render: (r) => formatInt(r.population) },
                {
                  key: 'incidence',
                  header: 'Per 100k',
                  align: 'right',
                  className: 'cell-strong',
                  render: (r) => METRICS.incidence.format(METRICS.incidence.of(r)),
                },
              ]}
            />
          )}
        </AsyncSection>

        <CardFoot>
          Cases: DOH Center for Health Development – CALABARZON annual surveillance tables, 2020–2024.
          Population: PSA 2020 Census. Boundaries:{' '}
          <a href="https://www.geoboundaries.org/" target="_blank" rel="noreferrer">geoBoundaries</a>{' '}
          gbOpen PHL ADM3 (2020), CC-BY 4.0 — bundled as a static file, so this map makes no
          external requests. These are <strong>annual</strong> totals, not a forecast; see
          DATA_ASSESSMENT.md for why weekly counts are needed before the model can run.
        </CardFoot>
      </Card>

      {view === 'chart' && (
        <Card>
          <CardHead
            title={`Highest ${metric.short}`}
            description={`Top 12 of 142 municipalities, ${activeYear ?? ''}.`}
          />
          <AsyncSection
            loading={loading}
            hasData={tableRows.length > 0}
            isEmpty={tableRows.length === 0}
            skeleton={<SkeletonBlock height={360} />}
            empty={<EmptyState icon="inbox" title="No data for this year" />}
          >
            <div className="rank-list">
              {tableRows.slice(0, 12).map((r, i) => {
                const v = metric.of(r)
                const top = metric.of(tableRows[0]) || 1
                return (
                  <div className="rank-row" key={`${r.region_id}-${r.year}`}>
                    <span className="rank-index">{i + 1}</span>
                    <span className="rank-body">
                      <span className="rank-head">
                        <span className="rank-name">{r.region_name}</span>
                        <span className="rank-value">{metric.format(v)}</span>
                      </span>
                      <span className="bar-track" style={{ height: 6 }}>
                        <span
                          className="bar-fill"
                          style={{ height: 6, width: `${Math.max(((v ?? 0) / top) * 100, 2)}%`, background: 'var(--seq-500)' }}
                        />
                      </span>
                      <span className="rank-meta">{r.province}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </AsyncSection>
          <CardFoot>
            Ranked on the selected metric. Small municipalities dominate the per-100k view —
            that is real, not an artefact: a low denominator makes incidence volatile.
          </CardFoot>
        </Card>
      )}
      </div>
    </>
  )
}
