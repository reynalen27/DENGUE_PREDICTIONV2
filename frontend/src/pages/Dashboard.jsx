import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useFetch } from '../hooks/useFetch.js'
import { alertsApi, casesApi, modelsApi, regionsApi } from '../services/api.js'
import { Card, CardFoot, CardHead } from '../components/Card.jsx'
import { PageHeader } from '../components/Controls.jsx'
import { AsyncSection, EmptyState, SkeletonRows } from '../components/States.jsx'
import DataTable from '../components/DataTable.jsx'
import RiskBadge from '../components/RiskBadge.jsx'
import StatCard from '../components/StatCard.jsx'
import Icon from '../components/Icon.jsx'
import { dayKey, formatCompact, formatDate, formatNumber, formatRelative, riskRank, toNumber } from '../lib/format.js'

/** Latest alert per region, so a region is counted once at its current level. */
function currentRiskByRegion(alerts) {
  const latest = new Map()
  for (const alert of alerts ?? []) {
    const existing = latest.get(alert.region_name)
    if (!existing || new Date(alert.date) > new Date(existing.date)) latest.set(alert.region_name, alert)
  }
  return latest
}

/** National confirmed cases per week, oldest first — feeds the tile sparkline. */
function weeklyTotals(cases) {
  const byWeek = new Map()
  for (const row of cases ?? []) {
    const key = dayKey(row.date)
    byWeek.set(key, (byWeek.get(key) ?? 0) + (toNumber(row.confirmed_cases) ?? 0))
  }
  return [...byWeek.entries()]
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([date, total]) => ({ date, total }))
}

export default function Dashboard() {
  const { data: alerts, loading: alertsLoading, error: alertsError, refetch: refetchAlerts } =
    useFetch(() => alertsApi.list(), [])
  const { data: runs, loading: runsLoading } = useFetch(() => modelsApi.compare(), [])
  const { data: regions } = useFetch(() => regionsApi.list('municipality'), [])
  const { data: cases } = useFetch(() => casesApi.list(), [])

  const riskByRegion = useMemo(() => currentRiskByRegion(alerts), [alerts])
  const weeks = useMemo(() => weeklyTotals(cases), [cases])

  const elevated = [...riskByRegion.values()].filter((a) => riskRank(a.risk_level) >= riskRank('high'))
  const monitored = regions?.length ?? 0

  // /api/models/compare is ordered best RMSE first.
  const best = runs?.[0]
  const runnerUp = runs?.[1]
  const rmseGain = best && runnerUp
    ? ((toNumber(runnerUp.rmse) - toNumber(best.rmse)) / toNumber(runnerUp.rmse)) * 100
    : null

  const latestWeek = weeks.at(-1)
  const priorWeek = weeks.at(-2)
  const weekDelta = latestWeek && priorWeek && priorWeek.total
    ? ((latestWeek.total - priorWeek.total) / priorWeek.total) * 100
    : null

  const rankedRegions = useMemo(() => {
    const list = (regions ?? []).map((region) => ({
      ...region,
      alert: riskByRegion.get(region.name) ?? null,
    }))
    return list.sort((a, b) => {
      const diff = riskRank(b.alert?.risk_level) - riskRank(a.alert?.risk_level)
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    })
  }, [regions, riskByRegion])

  return (
    <>
      <PageHeader
        title="National overview"
        description="Current dengue risk across monitored regions, and how the hybrid model is performing against its baselines."
      />

      {/* Exactly one hero figure per view. */}
      <div className="grid grid-hero">
        <Card>
          <div className="hero">
            <span className="eyebrow">Regions at high risk or above</span>
            <div>
              <span className="hero-value">{alertsLoading && !alerts ? '—' : elevated.length}</span>
              <span className="hero-unit">of {monitored || '—'}</span>
            </div>
            <p className="hero-caption">
              {elevated.length === 0
                ? 'No region is currently above the alert threshold.'
                : `${elevated.length === 1 ? 'One region is' : `${elevated.length} regions are`} above the alert threshold and should be prioritised for vector control.`}
            </p>
            <div className="hero-foot">
              {elevated.length > 0
                ? elevated.map((a) => (
                    <span key={a.id} className="badge badge-neutral">
                      <span className="badge-dot" />
                      {a.region_name}
                    </span>
                  ))
                : <span className="badge badge-low"><Icon name="shield" size={13} strokeWidth={1.9} />All clear</span>}
            </div>
          </div>
        </Card>

        <div className="grid grid-2">
          <StatCard
            label="Best model by RMSE"
            value={runsLoading && !best ? '—' : (best?.model_type ?? 'n/a')}
            sublabel={best ? `RMSE ${formatNumber(best.rmse)} · trained ${formatRelative(best.trained_at)}` : 'Comparative evaluation pending'}
            loading={runsLoading && !best}
          />
          <StatCard
            label="Interval coverage"
            value={best?.coverage != null ? formatNumber(best.coverage, { decimals: 1 }) : '—'}
            unit="%"
            sublabel="Share of observations inside the credible interval"
            loading={runsLoading && !best}
          />
          <StatCard
            label="Confirmed cases, latest week"
            value={latestWeek ? formatCompact(latestWeek.total) : '—'}
            sublabel={latestWeek ? `Week of ${formatDate(latestWeek.date)}` : 'No case data loaded'}
            delta={weekDelta === null ? null : {
              value: `${Math.abs(weekDelta).toFixed(1)}%`,
              // Arrow follows the data; colour follows whether it is good news,
              // and for case counts a fall is the good direction.
              direction: weekDelta > 0.5 ? 'up' : weekDelta < -0.5 ? 'down' : 'flat',
              tone: weekDelta > 0.5 ? 'bad' : weekDelta < -0.5 ? 'good' : 'flat',
              label: 'wk/wk',
            }}
            trend={weeks.map((w) => w.total)}
          />
          <StatCard
            label="RMSE gain over next best"
            value={rmseGain === null ? '—' : rmseGain.toFixed(1)}
            unit="%"
            sublabel={runnerUp ? `Against ${runnerUp.model_type}` : 'Needs two evaluated runs'}
            loading={runsLoading && !best}
          />
        </div>
      </div>

      <div className="grid grid-split section-gap">
        <Card>
          <CardHead
            title="Recent alerts"
            description="Every alert written by the latest model run, newest first."
            actions={<Link className="btn btn-secondary btn-sm" to="/alerts">View all</Link>}
          />
          <AsyncSection
            loading={alertsLoading}
            error={alertsError}
            hasData={Boolean(alerts?.length)}
            isEmpty={Boolean(alerts) && alerts.length === 0}
            onRetry={refetchAlerts}
            errorTitle="Could not load alerts"
            skeleton={<SkeletonRows rows={4} />}
            empty={(
              <EmptyState
                icon="shield"
                title="No alerts recorded"
                body="Alerts appear here once a model run writes a risk level for a region."
              />
            )}
          >
            <DataTable
              caption="Recent region alerts"
              rows={(alerts ?? []).slice(0, 8)}
              getRowKey={(row) => row.id}
              columns={[
                { key: 'region_name', header: 'Region', className: 'cell-strong' },
                { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
                { key: 'risk_level', header: 'Risk level', render: (r) => <RiskBadge level={r.risk_level} /> },
              ]}
            />
          </AsyncSection>
        </Card>

        <Card>
          <CardHead title="Risk by region" description="Current level for every monitored region." />
          <AsyncSection
            loading={!regions}
            hasData={Boolean(regions?.length)}
            isEmpty={Boolean(regions) && regions.length === 0}
            skeleton={<SkeletonRows rows={4} />}
            empty={<EmptyState icon="data" title="No regions" body="Run npm run seed in the backend to load the sample regions." />}
          >
            <div>
              {rankedRegions.map((region) => (
                <div className="region-row" key={region.id}>
                  <span>
                    <span className="region-name">{region.name}</span>
                    <br />
                    <span className="region-meta">{region.region_code} · {region.province}</span>
                  </span>
                  <span className="region-row-right">
                    {region.alert
                      ? <RiskBadge level={region.alert.risk_level} />
                      : <span className="badge badge-neutral"><span className="badge-dot" />No data</span>}
                  </span>
                </div>
              ))}
            </div>
          </AsyncSection>
          <CardFoot>A region shows “No data” until a model run writes an alert row for it.</CardFoot>
        </Card>
      </div>
    </>
  )
}
