import { useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useFetch } from '../hooks/useFetch.js'
import { modelsApi } from '../services/api.js'
import { Card, CardBody, CardFoot, CardHead } from '../components/Card.jsx'
import { LegendItem, PageHeader, Select, ViewToggle } from '../components/Controls.jsx'
import { AsyncSection, EmptyState, SkeletonBlock } from '../components/States.jsx'
import EvaluationBanner from '../components/EvaluationBanner.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import DataTable from '../components/DataTable.jsx'
import StatCard from '../components/StatCard.jsx'
import { seriesSlots, useChartTheme } from '../lib/useChartTheme.js'
import { formatNumber, toNumber } from '../lib/format.js'

/*
 * Objective 4: can the forecast's uncertainty be reliably reported as a
 * credible interval?
 *
 * Two pieces of evidence, because neither is sufficient alone:
 *
 *   Reliability  nominal vs empirical coverage against the 45-degree ideal.
 *                Below the line = overconfident (the interval misses more
 *                often than it claims). Above = needlessly wide.
 *
 *   PIT          where observations actually fell inside the predictive
 *                distribution. Flat = calibrated. U-shaped = overconfident.
 *                Hump = too wide. The reliability curve can look acceptable
 *                while the PIT shows the distribution has the wrong shape,
 *                which is why both are here.
 *
 * Sharpness (mean interval width) sits alongside throughout: an interval wide
 * enough to contain every plausible value has perfect coverage and no value.
 */

const IDEAL_NOTE = 'The diagonal is perfect calibration. Distance from it is the error.'

function CalibrationVerdict({ rows }) {
  const withGap = rows.filter((r) => r.gap !== null && r.gap !== undefined)
  if (!withGap.length) return null

  const worst = withGap.reduce((a, b) => (Math.abs(toNumber(b.gap)) > Math.abs(toNumber(a.gap)) ? b : a))
  const gap = toNumber(worst.gap)
  const mag = Math.abs(gap)

  // Thresholds are a judgement call, so the number behind the verdict is always
  // shown next to it rather than the reader having to trust the word.
  const tone = mag <= 3 ? 'low' : mag <= 8 ? 'moderate' : 'severe'
  const level = formatNumber(worst.nominal_level, { decimals: 0 })
  const empirical = formatNumber(worst.empirical_level, { decimals: 1 })

  // Below 3 points the direction is noise, and naming it ("overconfident")
  // next to a "well calibrated" verdict reads as a contradiction.
  const detail = mag <= 3
    ? `worst gap ${formatNumber(mag, { decimals: 1 })} pts, at the ${level}% level`
    : gap < 0
      ? `overconfident — the ${level}% interval held only ${empirical}% of observations`
      : `conservative — the ${level}% interval held ${empirical}%, wider than needed`

  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {mag <= 3 ? 'Well calibrated' : mag <= 8 ? 'Mild miscalibration' : 'Poorly calibrated'}: {detail}
    </span>
  )
}

export default function Calibration() {
  const t = useChartTheme()
  const [view, setView] = useState('chart')
  const [runId, setRunId] = useState(null)

  const { data: runs, loading: runsLoading, error: runsError } = useFetch(() => modelsApi.compare(), [])
  const list = runs ?? []

  // Colour follows the entity: the hybrid keeps slot 1 across every page.
  const modelOrder = useMemo(() => {
    const byId = [...list].sort((a, b) => a.id - b.id)
    const isHybrid = (r) => /hybrid/i.test(r.model_type)
    return [...byId.filter(isHybrid), ...byId.filter((r) => !isHybrid(r))].map((r) => r.id)
  }, [list])

  const colorFor = useMemo(() => {
    const slots = seriesSlots(t)
    return (id) => slots[modelOrder.indexOf(id) % slots.length]
  }, [modelOrder, t])

  const activeId = runId ?? modelOrder[0] ?? null
  const activeRun = list.find((r) => String(r.id) === String(activeId)) ?? null

  const { data: coverage, loading: covLoading, error: covError, refetch } = useFetch(
    () => (activeId ? modelsApi.coverage(activeId, 'overall') : Promise.resolve([])),
    [activeId],
  )
  const { data: pit, loading: pitLoading } = useFetch(
    () => (activeId ? modelsApi.calibration(activeId) : Promise.resolve([])),
    [activeId],
  )

  const covRows = coverage ?? []

  // Every model on one reliability plot — the comparison is the point.
  const { data: allCoverage } = useFetch(
    () => (modelOrder.length
      ? Promise.all(modelOrder.map((id) => modelsApi.coverage(id, 'overall').then((rows) => ({ id, rows }))))
      : Promise.resolve([])),
    [modelOrder.join(',')],
  )

  const reliability = useMemo(() => {
    const levels = [...new Set((allCoverage ?? []).flatMap((m) => m.rows.map((r) => toNumber(r.nominal_level))))]
      .sort((a, b) => a - b)
    return levels.map((level) => {
      const point = { nominal: level, ideal: level }
      for (const m of allCoverage ?? []) {
        const hit = m.rows.find((r) => toNumber(r.nominal_level) === level)
        if (hit) point[`m${m.id}`] = toNumber(hit.empirical_level)
      }
      return point
    })
  }, [allCoverage])

  const pitRows = (pit ?? []).map((r) => ({
    bin: `${(toNumber(r.bin_lower) * 100).toFixed(0)}–${(toNumber(r.bin_upper) * 100).toFixed(0)}%`,
    observed: toNumber(r.observed_freq),
    n_obs: r.n_obs,
  }))
  const idealFreq = pitRows.length ? 1 / pitRows.length : 0

  const meanWidth = covRows.length
    ? covRows.reduce((s, r) => s + (toNumber(r.mean_width) ?? 0), 0) / covRows.length
    : null
  const worstGap = covRows.length
    ? covRows.reduce((a, b) => (Math.abs(toNumber(b.gap)) > Math.abs(toNumber(a.gap)) ? b : a))
    : null

  const ready = Boolean(list.length && covRows.length)

  return (
    <>
      <PageHeader
        title="Calibration"
        description="Whether the model's stated uncertainty can be trusted — the difference between an interval that is narrow and one that is honest."
        actions={<ViewToggle view={view} onChange={setView} label="Calibration view" />}
      />

      <EvaluationBanner run={activeRun} />

      <div className="filter-bar">
        <span className="filter-bar-label">Model</span>
        <Select
          label="Model"
          hideLabel
          value={activeId ?? ''}
          onChange={(v) => setRunId(Number(v))}
          options={modelOrder.map((id) => ({
            value: id,
            label: list.find((r) => r.id === id)?.model_type ?? `Run ${id}`,
          }))}
          disabled={!modelOrder.length}
        />
        <span className="filter-bar-spacer" />
        {covRows.length > 0 && <CalibrationVerdict rows={covRows} />}
      </div>

      <div className="grid grid-4">
        <StatCard
          label="Worst coverage gap"
          value={worstGap ? formatNumber(Math.abs(toNumber(worstGap.gap)), { decimals: 1 }) : '—'}
          unit="pts"
          sublabel={worstGap ? `At the ${formatNumber(worstGap.nominal_level, { decimals: 0 })}% level` : '—'}
          loading={covLoading && !covRows.length}
        />
        <StatCard
          label="Mean interval width"
          value={meanWidth !== null ? formatNumber(meanWidth, { decimals: 1 }) : '—'}
          unit="cases"
          sublabel="Sharpness — lower is better, but only at equal coverage"
          loading={covLoading && !covRows.length}
        />
        <StatCard
          label="95% interval holds"
          value={(() => {
            const r = covRows.find((x) => toNumber(x.nominal_level) === 95)
            return r ? formatNumber(r.empirical_level, { decimals: 1 }) : '—'
          })()}
          unit="%"
          sublabel="Of observations, against a 95% claim"
          loading={covLoading && !covRows.length}
        />
        <StatCard
          label="Observations scored"
          value={covRows[0]?.n_obs ?? '—'}
          sublabel="Region-months in the test window"
          loading={covLoading && !covRows.length}
        />
      </div>

      <AsyncSection
        loading={runsLoading || covLoading}
        error={runsError ?? covError}
        hasData={ready}
        isEmpty={Boolean(runs) && !list.length}
        onRetry={refetch}
        errorTitle="Could not load calibration results"
        skeleton={<Card className="section-gap"><SkeletonBlock height={360} /></Card>}
        empty={(
          <Card className="section-gap">
            <EmptyState
              icon="target"
              title="No calibration results yet"
              body="The model service writes interval_coverage and calibration_bins. Run npm run seed:fixtures in the backend to populate illustrative values."
            />
          </Card>
        )}
      >
        {view === 'chart' ? (
          <div className="grid grid-2 section-gap">
            <Card>
              <CardHead
                title="Reliability — nominal vs empirical coverage"
                description="Every model at once. Below the diagonal is overconfident; above is needlessly wide."
              />
              <CardBody>
                <div className="legend">
                  <LegendItem shape="line" color={t.axis} label="Perfect calibration" note="(diagonal)" />
                  {modelOrder.map((id) => (
                    <LegendItem
                      key={id}
                      shape="line"
                      color={colorFor(id)}
                      label={list.find((r) => r.id === id)?.model_type ?? `Run ${id}`}
                    />
                  ))}
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={reliability} margin={{ top: 12, right: 24, bottom: 4, left: -8 }}>
                      <CartesianGrid stroke={t.grid} strokeWidth={1} vertical={false} />
                      <XAxis
                        dataKey="nominal"
                        type="number"
                        domain={[40, 100]}
                        ticks={[50, 60, 70, 80, 90, 100]}
                        tick={{ fill: t.ink3, fontSize: 11 }}
                        axisLine={{ stroke: t.axis }}
                        tickLine={false}
                        tickMargin={10}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <YAxis
                        domain={[20, 100]}
                        tick={{ fill: t.ink3, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={8}
                        width={54}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        cursor={{ stroke: t.axis, strokeWidth: 1 }}
                        content={(
                          <ChartTooltip
                            labelFormatter={(v) => `${v}% nominal interval`}
                            valueFormatter={(value) => `${formatNumber(value, { decimals: 1 })}%`}
                          />
                        )}
                      />
                      {/* The ideal is a reference, not a series — hairline, recessive. */}
                      <Line
                        dataKey="ideal"
                        name="Perfect calibration"
                        type="linear"
                        stroke={t.axis}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                      />
                      {modelOrder.map((id) => (
                        <Line
                          key={id}
                          dataKey={`m${id}`}
                          name={list.find((r) => r.id === id)?.model_type ?? `Run ${id}`}
                          type="monotone"
                          stroke={colorFor(id)}
                          strokeWidth={2}
                          strokeLinecap="round"
                          dot={{ r: 4, fill: colorFor(id), stroke: t.surface, strokeWidth: 2 }}
                          activeDot={{ r: 6, fill: colorFor(id), stroke: t.surface, strokeWidth: 2 }}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
              <CardFoot>{IDEAL_NOTE}</CardFoot>
            </Card>

            <Card>
              <CardHead
                title={`PIT histogram — ${activeRun?.model_type ?? ''}`}
                description="Where observations actually fell inside the predictive distribution."
              />
              <CardBody>
                <div className="legend">
                  <LegendItem shape="swatch" color={t.series1} label="Observed frequency" />
                  <LegendItem shape="line" color={t.axis} label="Uniform (calibrated)" />
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={pitRows} margin={{ top: 20, right: 16, bottom: 4, left: -8 }}>
                      <CartesianGrid stroke={t.grid} strokeWidth={1} vertical={false} />
                      <XAxis
                        dataKey="bin"
                        tick={{ fill: t.ink3, fontSize: 10 }}
                        axisLine={{ stroke: t.axis }}
                        tickLine={false}
                        tickMargin={10}
                        interval={1}
                      />
                      <YAxis
                        tick={{ fill: t.ink3, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={8}
                        width={54}
                        tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      />
                      <Tooltip
                        cursor={{ fill: t.grid }}
                        content={(
                          <ChartTooltip
                            labelFormatter={(v) => `PIT bin ${v}`}
                            valueFormatter={(value) => `${(value * 100).toFixed(1)}%`}
                          />
                        )}
                      />
                      <ReferenceLine
                        y={idealFreq}
                        stroke={t.axis}
                        strokeWidth={1}
                        label={{ value: 'uniform', position: 'insideTopRight', fill: t.ink3, fontSize: 10, offset: 6 }}
                      />
                      <Bar
                        dataKey="observed"
                        name="Observed frequency"
                        fill={t.series1}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={24}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
              <CardFoot>
                Flat means calibrated. A U shape means the model is overconfident — too many
                observations land in the tails, outside its intervals. A hump means the
                intervals are wider than they need to be.
              </CardFoot>
            </Card>
          </div>
        ) : (
          <>
            <Card className="section-gap">
              <CardHead
                title="Interval coverage"
                description={`${activeRun?.model_type ?? ''} — the same numbers as the reliability chart.`}
              />
              <DataTable
                caption="Nominal vs empirical interval coverage"
                rows={covRows}
                getRowKey={(r) => r.id}
                columns={[
                  { key: 'nominal_level', header: 'Nominal', align: 'right', render: (r) => `${formatNumber(r.nominal_level, { decimals: 0 })}%` },
                  { key: 'empirical_level', header: 'Empirical', align: 'right', className: 'cell-strong', render: (r) => `${formatNumber(r.empirical_level, { decimals: 1 })}%` },
                  {
                    key: 'gap',
                    header: 'Gap',
                    align: 'right',
                    render: (r) => {
                      const g = toNumber(r.gap)
                      return (
                        <span style={{ color: Math.abs(g) <= 3 ? 'var(--status-good-ink)' : 'var(--status-critical-ink)' }}>
                          {g > 0 ? '+' : ''}{formatNumber(g, { decimals: 1 })} pts
                        </span>
                      )
                    },
                  },
                  { key: 'mean_width', header: 'Mean width', align: 'right', render: (r) => formatNumber(r.mean_width, { decimals: 1 }) },
                  { key: 'n_obs', header: 'n', align: 'right' },
                ]}
              />
              <CardFoot>
                A negative gap means the interval missed more often than it claimed —
                overconfidence. Read every row against its width: coverage bought by widening
                the interval is not calibration.
              </CardFoot>
            </Card>

            <Card className="section-gap">
              <CardHead title="PIT bins" description="Observed frequency per probability-integral-transform bin." />
              <DataTable
                caption="PIT histogram bins"
                rows={pitRows}
                getRowKey={(r) => r.bin}
                columns={[
                  { key: 'bin', header: 'Bin', className: 'cell-strong' },
                  { key: 'observed', header: 'Observed', align: 'right', render: (r) => `${(r.observed * 100).toFixed(1)}%` },
                  { key: 'ideal', header: 'Uniform', align: 'right', render: () => `${(idealFreq * 100).toFixed(1)}%` },
                  {
                    key: 'dev',
                    header: 'Deviation',
                    align: 'right',
                    render: (r) => {
                      const d = (r.observed - idealFreq) * 100
                      return `${d > 0 ? '+' : ''}${d.toFixed(1)} pts`
                    },
                  },
                  { key: 'n_obs', header: 'n', align: 'right' },
                ]}
              />
            </Card>
          </>
        )}
      </AsyncSection>
    </>
  )
}
