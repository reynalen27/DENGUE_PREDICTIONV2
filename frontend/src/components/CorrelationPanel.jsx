import { useMemo, useState } from 'react'
import { Card, CardBody, CardFoot, CardHead } from './Card.jsx'
import { Select, ViewToggle } from './Controls.jsx'
import { AsyncSection, EmptyState, SkeletonBlock } from './States.jsx'
import Scatter, { pearson } from './Scatter.jsx'
import DataTable from './DataTable.jsx'
import Icon from './Icon.jsx'
import { useChartTheme } from '../lib/useChartTheme.js'
import { formatInt, formatNumber, toNumber } from '../lib/format.js'

/*
 * Correlation view for the Forecast page.
 *
 * The four variables the brief names do not live on the same scale of
 * variation, and putting them on one chart would be wrong:
 *
 *   population density  varies BETWEEN regions, constant within one
 *   poverty rate        varies BETWEEN regions, constant within one
 *   relative humidity   varies month to month
 *   recorded cases      varies month to month
 *
 * Scoped to a single region — which is what the Forecast page's selector does
 * — density and poverty have zero variance, so their correlation with cases is
 * undefined, not weak. Splitting the view is the only honest presentation:
 *
 *   BETWEEN regions   one point per region (n = 17), selected region
 *                     highlighted. This is where density and poverty can be
 *                     read at all.
 *   WITHIN a region   one point per month (n = 60) for the selected region.
 *                     Only the time-varying predictors appear.
 */

/*
 * `log: true` where the predictor spans orders of magnitude. Density runs from
 * ~130/km² in MIMAROPA to 22,235 in NCR — on a linear axis NCR sits alone at
 * the right edge and the other sixteen regions collapse into one vertical
 * stripe, which is unreadable rather than merely ugly.
 */
const BETWEEN_VARS = {
  population_density: { label: 'Population density', unit: 'per km²', log: true, fmt: (v) => formatInt(v) },
  poverty_rate: { label: 'Poverty incidence', unit: '% of families', fmt: (v) => formatNumber(v, { decimals: 1 }) },
  humidity: { label: 'Mean relative humidity', unit: '%', fmt: (v) => formatNumber(v, { decimals: 1 }) },
  urban_pct: { label: 'Urban population', unit: '%', fmt: (v) => formatNumber(v, { decimals: 1 }) },
}

/*
 * `bestLag` is the offset at which the pooled within-region signal is
 * strongest across all 17 regions (see markdown/REVISION_PLAN.md 2c). It is
 * only the OPENING lag — every offset stays one click away, with its own r on
 * the chip — but opening on the wrong one would show the reader the weakest
 * version of a real relationship and invite them to conclude there is none.
 */
const WITHIN_VARS = {
  humidity: { label: 'Mean relative humidity', unit: '%', bestLag: 1, fmt: (v) => formatNumber(v, { decimals: 1 }) },
  temperature: { label: 'Mean temperature', unit: '°C', bestLag: 3, fmt: (v) => formatNumber(v, { decimals: 1 }) },
  rainfall: { label: 'Mean precipitation', unit: 'mm', bestLag: 1, fmt: (v) => formatInt(v) },
  hot_days: { label: 'Hot days (>35 °C)', unit: 'days', bestLag: 3, fmt: (v) => formatNumber(v, { decimals: 1 }) },
}

const LAGS = [0, 1, 2, 3]

// Why each predictor leads cases by the offset it does — the chart shows the
// number, this says what mechanism the number is standing in for.
const WITHIN_NOTE = {
  humidity: 'Humidity leads by about a month: damp air lengthens adult mosquito survival, so the biting population builds shortly before cases are reported.',
  temperature: 'Temperature usually peaks around three months out — warmth speeds larval development and viral replication well before cases appear.',
  rainfall: 'Rain leads by about a month: standing water becomes breeding habitat, and one mosquito generation separates the rain from the bite.',
  hot_days: 'Extreme heat acts on a longer horizon and cuts both ways — it can accelerate development but also dry out the containers larvae need.',
}

export default function CorrelationPanel({ panel, loading, error, refetch, activeSlug, regionName }) {
  const t = useChartTheme()
  const [view, setView] = useState('chart')
  const [betweenVar, setBetweenVar] = useState('population_density')
  const [withinVar, setWithinVar] = useState('humidity')
  const [lag, setLag] = useState(WITHIN_VARS.humidity.bestLag)

  // Switching predictor re-opens on that predictor's strongest lag.
  const pickVar = (v) => { setWithinVar(v); setLag(WITHIN_VARS[v].bestLag) }

  const rows = panel ?? []

  /* ---- BETWEEN regions: collapse each region to one point ---------------- */
  const between = useMemo(() => {
    const byRegion = new Map()
    for (const r of rows) {
      const k = r.region_slug
      if (!byRegion.has(k)) {
        byRegion.set(k, {
          slug: k, name: r.region_name, cases: 0, months: 0,
          population: toNumber(r.population),
          population_density: toNumber(r.population_density),
          poverty_rate: toNumber(r.poverty_rate),
          urban_pct: toNumber(r.urban_pct),
          humiditySum: 0,
        })
      }
      const g = byRegion.get(k)
      g.cases += toNumber(r.confirmed_cases) ?? 0
      g.humiditySum += toNumber(r.humidity) ?? 0
      g.months += 1
    }
    return [...byRegion.values()].map((g) => ({
      ...g,
      humidity: g.months ? g.humiditySum / g.months : null,
      // Incidence, not raw counts: a region with 14 M people will always have
      // more cases, which would make every scatter a plot of population.
      incidence: g.population ? (g.cases / g.population) * 1e5 : null,
    }))
  }, [rows])

  /* ---- WITHIN one region: one point per month, predictor lagged ---------- */
  const within = useMemo(() => {
    const mine = rows.filter((r) => r.region_slug === activeSlug)
      .sort((a, b) => a.period.localeCompare(b.period))
    return mine.map((r, i) => {
      const src = mine[i - lag]
      return {
        period: r.period,
        cases: toNumber(r.confirmed_cases),
        predictor: src ? toNumber(src[withinVar]) : null,
      }
    }).filter((r) => r.predictor !== null)
  }, [rows, activeSlug, withinVar, lag])

  /* r at each lag, so the reader can see WHERE the signal is rather than
     trusting the default. */
  const lagProfile = useMemo(() => {
    const mine = rows.filter((r) => r.region_slug === activeSlug)
      .sort((a, b) => a.period.localeCompare(b.period))
    return LAGS.map((L) => {
      const xs = []
      const ys = []
      mine.forEach((r, i) => {
        const src = mine[i - L]
        const p = src ? toNumber(src[withinVar]) : null
        const c = toNumber(r.confirmed_cases)
        if (p !== null && c !== null) { xs.push(p); ys.push(Math.log1p(c)) }
      })
      return { lag: L, r: pearson(xs, ys) }
    })
  }, [rows, activeSlug, withinVar])

  const bSpec = BETWEEN_VARS[betweenVar]
  const wSpec = WITHIN_VARS[withinVar]
  const ready = between.length > 0

  return (
    <>
      <div className="notice notice-info" style={{ marginBottom: 'var(--sp-4)' }}>
        <Icon name="info" size={15} />
        <span>
          Density and poverty are <strong>constant within a region</strong> — they
          vary only between regions — so their relationship with cases cannot be
          read from one region's 60 months. The two panels below separate the two
          kinds of variation rather than mixing them into one misleading chart.
        </span>
      </div>

      <AsyncSection
        loading={loading}
        error={error}
        hasData={ready}
        isEmpty={Boolean(panel) && !ready}
        onRetry={refetch}
        errorTitle="Could not load the panel"
        skeleton={<Card><SkeletonBlock height={300} /></Card>}
        empty={(
          <Card>
            <EmptyState
              icon="chart"
              title="No panel data"
              body="Run npm run etl:revised in the backend to load the 17-region monthly panel."
            />
          </Card>
        )}
      >
        <div className="grid grid-2">
          {/* ---------------- BETWEEN ---------------- */}
          <Card>
            <CardHead
              title="Between regions"
              description="One point per region, 2016–2020 pooled. This is the only place a static predictor can be read."
              actions={(
                <Select
                  label="Predictor" hideLabel value={betweenVar} onChange={setBetweenVar}
                  options={Object.entries(BETWEEN_VARS).map(([k, v]) => ({ value: k, label: v.label }))}
                />
              )}
            />
            <CardBody>
              {view === 'chart' ? (
                <Scatter
                  t={t}
                  points={between.map((g) => ({
                    x: g[betweenVar],
                    y: g.incidence,
                    label: g.name,
                    highlight: g.slug === activeSlug,
                  }))}
                  xLabel={`${bSpec.label} (${bSpec.unit})`}
                  yLabel="Cases per 100,000"
                  formatX={bSpec.fmt}
                  formatY={(v) => formatInt(v)}
                  logX={Boolean(bSpec.log)}
                  clampX0
                />
              ) : (
                <DataTable
                  caption="Regions by predictor and incidence"
                  rows={[...between].sort((a, b) => (b.incidence ?? 0) - (a.incidence ?? 0))}
                  getRowKey={(r) => r.slug}
                  columns={[
                    { key: 'name', header: 'Region', className: 'cell-strong' },
                    { key: 'v', header: bSpec.label, align: 'right', render: (r) => bSpec.fmt(r[betweenVar]) },
                    { key: 'cases', header: 'Cases', align: 'right', render: (r) => formatInt(r.cases) },
                    { key: 'inc', header: 'Per 100k', align: 'right', className: 'cell-strong', render: (r) => formatInt(r.incidence) },
                  ]}
                />
              )}
            </CardBody>
            <CardFoot>
              Incidence, not raw counts — a 14-million-person region always has more
              cases, so a count scatter would just be a plot of population. With 17
              regions, treat any r here as suggestive at best.
            </CardFoot>
          </Card>

          {/* ---------------- WITHIN ---------------- */}
          <Card>
            <CardHead
              title={`Within ${regionName}`}
              description="One point per month. Only predictors that actually vary over time appear here."
              actions={(
                <Select
                  label="Predictor" hideLabel value={withinVar} onChange={pickVar}
                  options={Object.entries(WITHIN_VARS).map(([k, v]) => ({ value: k, label: v.label }))}
                />
              )}
            />
            <CardBody>
              <div className="lag-picker">
                <span className="filter-bar-label">Lag</span>
                {lagProfile.map((p) => (
                  <button
                    key={p.lag}
                    type="button"
                    className={`lag-chip ${p.lag === lag ? 'is-on' : ''}`}
                    onClick={() => setLag(p.lag)}
                    aria-pressed={p.lag === lag}
                  >
                    {p.lag}m
                    <span className="lag-chip-r">{p.r === null ? '—' : p.r.toFixed(2)}</span>
                  </button>
                ))}
                <span className="lag-note">r against log cases</span>
              </div>

              {view === 'chart' ? (
                <Scatter
                  t={t}
                  points={within.map((r) => ({ x: r.predictor, y: r.cases, label: r.period }))}
                  xLabel={`${wSpec.label} (${wSpec.unit})${lag ? `, ${lag} month${lag > 1 ? 's' : ''} earlier` : ''}`}
                  yLabel="Confirmed cases"
                  formatX={wSpec.fmt}
                  formatY={(v) => formatInt(v)}
                  clampX0
                />
              ) : (
                <DataTable
                  caption={`Monthly cases against ${wSpec.label} at lag ${lag}`}
                  rows={within}
                  getRowKey={(r) => r.period}
                  columns={[
                    { key: 'period', header: 'Month', className: 'cell-strong' },
                    { key: 'p', header: `${wSpec.label} (lag ${lag})`, align: 'right', render: (r) => wSpec.fmt(r.predictor) },
                    { key: 'cases', header: 'Cases', align: 'right', className: 'cell-strong', render: (r) => formatInt(r.cases) },
                  ]}
                />
              )}
            </CardBody>
            <CardFoot>
              The lag chips show r at each offset, so the strongest relationship is
              visible rather than assumed. {WITHIN_NOTE[withinVar]} One region gives
              at most 60 months, so a weak r here is weak evidence either way.
            </CardFoot>
          </Card>
        </div>

        <div className="filter-bar section-gap">
          <span className="filter-bar-label">Recorded cases only</span>
          <span className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
            Both panels use observed surveillance counts, never model predictions.
          </span>
          <span className="filter-bar-spacer" />
          <ViewToggle view={view} onChange={setView} label="Correlation view" />
        </div>
      </AsyncSection>
    </>
  )
}
