import { useMemo, useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useFetch } from '../hooks/useFetch.js'
import { alertsApi, casesApi, panelApi, predictionsApi, regionsApi } from '../services/api.js'
import { Card, CardBody, CardHead } from '../components/Card.jsx'
import { LegendItem, PageHeader, Select, ViewToggle } from '../components/Controls.jsx'
import { AsyncSection, EmptyState, SkeletonBlock } from '../components/States.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import DataTable from '../components/DataTable.jsx'
import StatCard from '../components/StatCard.jsx'
import CorrelationPanel from '../components/CorrelationPanel.jsx'
import Icon from '../components/Icon.jsx'
import { useChartTheme } from '../lib/useChartTheme.js'
import { dayKey, formatDate, formatInt, formatNumber, riskRank, toNumber } from '../lib/format.js'

/*
 * Observed history and the model's forecast are two series on ONE axis (both
 * are weekly case counts), plus the Bayesian credible interval drawn as a
 * range band -- Recharts renders a band when the dataKey resolves to a
 * [lo, hi] pair. That replaces the previous trick of painting a
 * background-coloured area over the lower bound, which only ever worked while
 * the page behind the chart was one opaque colour.
 */
function mergeSeries(cases, predictions) {
  const byDay = new Map()

  const touch = (date) => {
    const key = dayKey(date)
    if (!byDay.has(key)) {
      byDay.set(key, { key, date, observed: null, forecast: null, lower: null, upper: null, band: null })
    }
    return byDay.get(key)
  }

  for (const row of cases ?? []) {
    touch(row.date).observed = toNumber(row.confirmed_cases)
  }

  for (const row of predictions ?? []) {
    const point = touch(row.date)
    point.forecast = toNumber(row.predicted_cases)
    point.lower = toNumber(row.ci_lower)
    point.upper = toNumber(row.ci_upper)
    // Only a complete pair can be drawn as a band.
    point.band = point.lower !== null && point.upper !== null ? [point.lower, point.upper] : null
  }

  return [...byDay.values()].sort((a, b) => new Date(a.date) - new Date(b.date))
}

export default function Forecast() {
  const t = useChartTheme()
  const [regionId, setRegionId] = useState(null)
  const [view, setView] = useState('chart')
  const [tab, setTab] = useState('forecast')

  const { data: regions, loading: regionsLoading } = useFetch(() => regionsApi.list('region'), [])
  const { data: alerts } = useFetch(() => alertsApi.list(), [])

  /*
   * Land on the region that most needs looking at rather than whichever name
   * sorts first -- which on the seeded data is a region with no forecast at
   * all, so the page opened on an empty state.
   */
  const defaultRegionId = useMemo(() => {
    if (!regions?.length) return null
    const worst = (alerts ?? []).reduce(
      (acc, a) => (riskRank(a.risk_level) > riskRank(acc?.risk_level) ? a : acc),
      null,
    )
    const match = worst && regions.find((r) => r.name === worst.region_name)
    return (match ?? regions[0]).id
  }, [regions, alerts])

  const activeRegionId = regionId ?? defaultRegionId

  const {
    data: predictions, loading: predLoading, error: predError, refetch: refetchPred,
  } = useFetch(
    () => (activeRegionId ? predictionsApi.forRegion(activeRegionId) : Promise.resolve([])),
    [activeRegionId],
  )

  const { data: cases } = useFetch(
    () => (activeRegionId ? casesApi.list(activeRegionId) : Promise.resolve([])),
    [activeRegionId],
  )

  // The whole 17-region panel: the correlation tab needs every region for its
  // between-region view, not just the selected one.
  const { data: panel, loading: panelLoading, error: panelError, refetch: refetchPanel } =
    useFetch(() => panelApi.get(), [])

  const series = useMemo(() => mergeSeries(cases, predictions), [cases, predictions])
  const forecastPoints = series.filter((d) => d.forecast !== null)
  const observedPoints = series.filter((d) => d.observed !== null)
  const hasForecast = forecastPoints.length > 0

  const peak = forecastPoints.reduce((best, d) => (best && best.forecast >= d.forecast ? best : d), null)
  const forecastStart = forecastPoints[0]
  const lastObserved = observedPoints.at(-1)

  const meanWidth = forecastPoints.length
    ? forecastPoints.reduce((sum, d) => sum + ((d.upper ?? 0) - (d.lower ?? 0)), 0) / forecastPoints.length
    : null

  const activeRegion = regions?.find((r) => String(r.id) === String(activeRegionId))
  const regionName = activeRegion?.name ?? 'Region'
  const activeSlug = activeRegion?.slug ?? null

  return (
    <>
      <PageHeader
        title="Forecast"
        description={tab === 'forecast'
          ? "Monthly predicted cases from the Bayesian-neural hybrid model, shown with the credible interval the model reports alongside each point."
          : "How the recorded case burden relates to each region's climate and socioeconomic profile. Observed surveillance only — no model output on this tab."}
      />

      {/* One selector, shared by both tabs — the brief's requirement, and it
          only works because the whole app now runs on the same 17 regions. */}
      <div className="filter-bar">
        <span className="filter-bar-label">Region</span>
        <Select
          label="Region"
          hideLabel
          value={activeRegionId ?? ''}
          disabled={regionsLoading || !regions?.length}
          onChange={(v) => setRegionId(v)}
          options={(regions ?? []).map((r) => ({ value: r.id, label: `${r.name} · ${r.slug}` }))}
        />
        <span className="filter-bar-spacer" />
        {tab === 'forecast' && (
          <span className="tag">
            <Icon name="clock" size={12} />
            {hasForecast ? `${forecastPoints.length}-month horizon` : 'No horizon'}
          </span>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="Forecast views">
        <button type="button" role="tab" aria-selected={tab === 'forecast'}
          className={`tab ${tab === 'forecast' ? 'is-on' : ''}`} onClick={() => setTab('forecast')}>
          <Icon name="forecast" size={15} />
          Predicted cases
        </button>
        <button type="button" role="tab" aria-selected={tab === 'correlation'}
          className={`tab ${tab === 'correlation' ? 'is-on' : ''}`} onClick={() => setTab('correlation')}>
          <Icon name="chart" size={15} />
          Correlations
        </button>
      </div>

      {tab === 'correlation' ? (
        <CorrelationPanel
          panel={panel}
          loading={panelLoading}
          error={panelError}
          refetch={refetchPanel}
          activeSlug={activeSlug}
          regionName={regionName}
        />
      ) : (
      <>
      <div className="grid grid-4">
        <StatCard
          label="Peak predicted cases"
          value={peak ? formatInt(peak.forecast) : '—'}
          sublabel={peak ? `Week of ${formatDate(peak.date)}` : 'Awaiting a model run'}
          loading={predLoading && !hasForecast}
        />
        <StatCard
          label="Forecast starts"
          value={forecastStart ? formatDate(forecastStart.date, 'short') : '—'}
          sublabel={forecastStart ? `Through ${formatDate(forecastPoints.at(-1).date)}` : 'No predictions stored'}
          loading={predLoading && !hasForecast}
        />
        <StatCard
          label="Mean interval width"
          value={meanWidth !== null ? formatNumber(meanWidth, { decimals: 0 }) : '—'}
          unit="cases"
          sublabel="Average upper minus lower bound"
          loading={predLoading && !hasForecast}
        />
        <StatCard
          label="Last observed"
          value={lastObserved ? formatInt(lastObserved.observed) : '—'}
          sublabel={lastObserved ? `Week of ${formatDate(lastObserved.date)}` : 'No case data for this region'}
          trend={observedPoints.map((d) => d.observed)}
        />
      </div>

      <Card className="section-gap">
        <CardHead
          title={`Predicted cases — ${regionName}`}
          description="Observed surveillance counts and the hybrid model's forecast, on a single case-count axis."
          actions={<ViewToggle view={view} onChange={setView} label="Forecast view" />}
        />

        <AsyncSection
          loading={predLoading}
          error={predError}
          hasData={series.length > 0}
          isEmpty={series.length === 0}
          onRetry={refetchPred}
          errorTitle="Could not load the forecast"
          skeleton={<SkeletonBlock height={300} />}
          empty={(
            <EmptyState
              icon="forecast"
              title="No forecast stored for this region"
              body="Predictions are written into MySQL by the Python model service. Once it has run for this region, its output and credible interval appear here."
            />
          )}
        >
          {view === 'chart' ? (
            <CardBody>
              <div className="legend">
                <LegendItem shape="line" color={t.series2} label="Observed cases" />
                <LegendItem shape="line" color={t.series1} label="Forecast (hybrid)" />
                <LegendItem shape="band" color={t.series1} label="Credible interval" />
              </div>

              <div className="chart-frame">
                <ResponsiveContainer width="100%" height={320}>
                  {/* The right margin has to clear the peak label: the peak is
                      usually the last point, and a clipped direct label is
                      worse than none. */}
                  <ComposedChart data={series} margin={{ top: 22, right: 52, bottom: 4, left: -6 }}>
                    <CartesianGrid stroke={t.grid} strokeWidth={1} vertical={false} />

                    <XAxis
                      dataKey="key"
                      tickFormatter={(v) => formatDate(v, 'axis')}
                      tick={{ fill: t.ink3, fontSize: 11 }}
                      axisLine={{ stroke: t.axis }}
                      tickLine={false}
                      tickMargin={10}
                      minTickGap={16}
                    />
                    <YAxis
                      tick={{ fill: t.ink3, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={8}
                      width={52}
                      tickFormatter={(v) => v.toLocaleString()}
                    />

                    <Tooltip
                      cursor={{ stroke: t.axis, strokeWidth: 1 }}
                      content={(
                        <ChartTooltip
                          labelFormatter={(v) => `Week of ${formatDate(v, 'long')}`}
                          valueFormatter={(value) => (Array.isArray(value)
                            ? `${formatInt(value[0])} – ${formatInt(value[1])}`
                            : formatInt(value))}
                        />
                      )}
                    />

                    {forecastStart && (
                      <ReferenceLine
                        x={forecastStart.key}
                        stroke={t.axis}
                        strokeWidth={1}
                        label={{
                          value: 'forecast →',
                          position: 'insideTopLeft',
                          fill: t.ink3,
                          fontSize: 10,
                          offset: 8,
                        }}
                      />
                    )}

                    {/* ~14% wash, never a saturated block */}
                    <Area
                      dataKey="band"
                      name="Credible interval"
                      stroke="none"
                      fill={t.series1}
                      fillOpacity={0.14}
                      connectNulls={false}
                      isAnimationActive={false}
                      activeDot={false}
                    />

                    <Line
                      dataKey="observed"
                      name="Observed cases"
                      type="monotone"
                      stroke={t.series2}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={{ r: 3.5, fill: t.series2, stroke: t.surface, strokeWidth: 2 }}
                      activeDot={{ r: 5, fill: t.series2, stroke: t.surface, strokeWidth: 2 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />

                    <Line
                      dataKey="forecast"
                      name="Forecast (hybrid)"
                      type="monotone"
                      stroke={t.series1}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={{ r: 3.5, fill: t.series1, stroke: t.surface, strokeWidth: 2 }}
                      activeDot={{ r: 5, fill: t.series1, stroke: t.surface, strokeWidth: 2 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />

                    {/* The extreme is the only directly labelled point -- a
                        number on every point goes unread. */}
                    {peak && (
                      <ReferenceDot
                        x={peak.key}
                        y={peak.forecast}
                        r={0}
                        isFront
                        label={{
                          value: `peak ${formatInt(peak.forecast)}`,
                          position: 'top',
                          fill: t.ink2,
                          fontSize: 11,
                          fontWeight: 600,
                          offset: 10,
                        }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          ) : (
            <DataTable
              caption={`Weekly observed and predicted cases for ${regionName}`}
              rows={series}
              getRowKey={(row) => row.key}
              columns={[
                { key: 'date', header: 'Week of', render: (r) => formatDate(r.date) },
                { key: 'observed', header: 'Observed', align: 'right', render: (r) => (r.observed === null ? <span className="cell-quiet">—</span> : formatInt(r.observed)) },
                { key: 'forecast', header: 'Forecast', align: 'right', className: 'cell-strong', render: (r) => (r.forecast === null ? <span className="cell-quiet">—</span> : formatInt(r.forecast)) },
                { key: 'lower', header: 'CI lower', align: 'right', render: (r) => (r.lower === null ? <span className="cell-quiet">—</span> : formatInt(r.lower)) },
                { key: 'upper', header: 'CI upper', align: 'right', render: (r) => (r.upper === null ? <span className="cell-quiet">—</span> : formatInt(r.upper)) },
                {
                  key: 'width',
                  header: 'Width',
                  align: 'right',
                  render: (r) => (r.lower === null || r.upper === null
                    ? <span className="cell-quiet">—</span>
                    : formatInt(r.upper - r.lower)),
                },
              ]}
            />
          )}
        </AsyncSection>
      </Card>
      </>
      )}
    </>
  )
}
