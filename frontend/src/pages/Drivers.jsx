import { useMemo, useState } from 'react'
import { useFetch } from '../hooks/useFetch.js'
import { modelsApi, regionsApi } from '../services/api.js'
import { Card, CardBody, CardFoot, CardHead } from '../components/Card.jsx'
import { LegendItem, PageHeader, Select, ViewToggle } from '../components/Controls.jsx'
import { AsyncSection, EmptyState, SkeletonRows } from '../components/States.jsx'
import EvaluationBanner from '../components/EvaluationBanner.jsx'
import DataTable from '../components/DataTable.jsx'
import Icon from '../components/Icon.jsx'
import { useChartTheme } from '../lib/useChartTheme.js'
import { formatNumber, toNumber } from '../lib/format.js'

/*
 * Objective 3: which factors most influence predicted cases per region.
 *
 * The design decision that matters here is what to do with an effect whose
 * credible interval spans zero. Ranking it lower and moving on would turn an
 * interpretability result into a leaderboard: the reader would see
 * "population density, rank 7" and conclude it has a small effect, when the
 * honest statement is that its effect is not distinguishable from none.
 *
 * So a zero-crossing effect is rendered in the NEUTRAL midpoint colour, its
 * bar is drawn hollow, and it carries an explicit label. Colour alone never
 * carries that meaning.
 *
 * The palette is DIVERGING, not sequential: an effect is signed, and the
 * sequential teal ramp cannot express a sign. blue (pushes cases down) and
 * orange (pushes cases up) are a warm/cool pair, validated all-pairs in both
 * modes, with a grey midpoint that reads as "nothing".
 */

const FEATURE_LABELS = {
  temperature: 'Mean temperature',
  humidity: 'Mean relative humidity',
  rainfall: 'Mean precipitation',
  hot_days: 'Hot days (>35 °C)',
  population: 'Population',
  population_density: 'Population density',
  cases_lag1: 'Cases, previous month',
  cases_lag12: 'Cases, same month last year',
}

const label = (f) => FEATURE_LABELS[f] ?? f.replace(/_/g, ' ')

function EffectBar({ row, maxAbs, t }) {
  const value = toNumber(row.importance)
  const lo = toNumber(row.ci_lower)
  const hi = toNumber(row.ci_upper)
  const crosses = row.crosses_zero === 1 || row.crosses_zero === true
  const colour = crosses ? t.divMid : value >= 0 ? t.divPos : t.divNeg

  // Symmetric scale around zero so the sign is readable from position alone,
  // not only from colour.
  const scale = (v) => 50 + (v / maxAbs) * 48

  const centre = scale(0)
  const end = scale(value)
  const left = Math.min(centre, end)
  const width = Math.abs(end - centre)
  const ciLeft = lo === null ? null : scale(lo)
  const ciRight = hi === null ? null : scale(hi)

  return (
    <div className="effect-row">
      <div className="effect-head">
        <span className="effect-name">
          {label(row.feature)}
          {row.lag_months ? <span className="effect-lag"> · lag {row.lag_months}m</span> : null}
        </span>
        <span className="effect-value">
          {value > 0 ? '+' : ''}{formatNumber(value, { decimals: 3 })}
        </span>
      </div>

      <div className="effect-track" role="img"
        aria-label={`${label(row.feature)}: effect ${formatNumber(value, { decimals: 3 })}, `
          + `95% credible interval ${formatNumber(lo, { decimals: 3 })} to ${formatNumber(hi, { decimals: 3 })}`
          + (crosses ? ', not distinguishable from zero' : '')}
      >
        {/* zero line first, so every bar is read against it */}
        <span className="effect-zero" style={{ left: `${centre}%` }} />
        {ciLeft !== null && (
          <span
            className="effect-ci"
            style={{ left: `${ciLeft}%`, width: `${Math.max(ciRight - ciLeft, 0.6)}%`, background: colour }}
          />
        )}
        <span
          className={`effect-fill ${crosses ? 'is-null' : ''}`}
          style={{
            left: `${left}%`,
            width: `${Math.max(width, 0.4)}%`,
            background: crosses ? 'transparent' : colour,
            borderColor: colour,
          }}
        />
      </div>

      {crosses && (
        <span className="effect-null-note">
          <Icon name="info" size={11} strokeWidth={2} />
          Interval spans zero — not distinguishable from no effect
        </span>
      )}
    </div>
  )
}

export default function Drivers() {
  const t = useChartTheme()
  const [view, setView] = useState('chart')
  const [scope, setScope] = useState('global')

  const { data: runs, loading: runsLoading, error: runsError } = useFetch(() => modelsApi.compare(), [])
  const list = runs ?? []

  // Only the hybrid produces feature effects — that is the interpretability claim.
  const hybrid = list.find((r) => /hybrid/i.test(r.model_type)) ?? null

  const { data: regions } = useFetch(() => regionsApi.list('region'), [])

  const { data: effects, loading, error, refetch } = useFetch(
    () => (hybrid ? modelsApi.importance(hybrid.id, scope) : Promise.resolve([])),
    [hybrid?.id, scope],
  )

  const rows = useMemo(
    () => [...(effects ?? [])].sort((a, b) => Math.abs(toNumber(b.importance)) - Math.abs(toNumber(a.importance))),
    [effects],
  )

  const maxAbs = useMemo(() => {
    const all = rows.flatMap((r) => [toNumber(r.importance), toNumber(r.ci_lower), toNumber(r.ci_upper)])
      .filter((v) => v !== null)
    return all.length ? Math.max(...all.map(Math.abs)) : 1
  }, [rows])

  const influential = rows.filter((r) => !(r.crosses_zero === 1 || r.crosses_zero === true))
  const nulls = rows.filter((r) => r.crosses_zero === 1 || r.crosses_zero === true)
  const strongest = influential[0]

  // Regions that actually have per-region effects stored.
  const regionOptions = useMemo(() => {
    const opts = [{ value: 'global', label: 'All regions (pooled)' }]
    for (const r of regions ?? []) opts.push({ value: String(r.id), label: r.name })
    return opts
  }, [regions])

  const scopeLabel = scope === 'global'
    ? 'pooled across all 17 regions'
    : (regions ?? []).find((r) => String(r.id) === String(scope))?.name ?? 'this region'

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Which factors move predicted cases, and by how much — with the uncertainty on each effect, because an effect without one cannot be called influential."
        actions={<ViewToggle view={view} onChange={setView} label="Drivers view" />}
      />

      <EvaluationBanner run={hybrid} />

      <div className="filter-bar">
        <span className="filter-bar-label">Scope</span>
        <Select
          label="Scope"
          hideLabel
          value={scope}
          onChange={setScope}
          options={regionOptions}
        />
        <span className="filter-bar-spacer" />
        <LegendItem shape="swatch" color={t.divPos} label="Pushes cases up" />
        <LegendItem shape="swatch" color={t.divNeg} label="Pushes cases down" />
        <LegendItem shape="swatch" color={t.divMid} label="No detectable effect" />
      </div>

      <div className="grid grid-3">
        <Card>
          <div className="stat">
            <span className="stat-label">Strongest driver</span>
            <div className="stat-value-row">
              <span className="stat-value" style={{ fontSize: 'var(--text-xl)' }}>
                {strongest ? label(strongest.feature) : '—'}
              </span>
            </div>
            <span className="stat-sub">
              {strongest
                ? `Effect ${toNumber(strongest.importance) > 0 ? '+' : ''}${formatNumber(strongest.importance, { decimals: 3 })}`
                  + `${strongest.lag_months ? `, at a ${strongest.lag_months}-month lag` : ''}`
                : 'No effects recorded'}
            </span>
          </div>
        </Card>
        <Card>
          <div className="stat">
            <span className="stat-label">Distinguishable from zero</span>
            <div className="stat-value-row">
              <span className="stat-value">{influential.length}</span>
              <span className="stat-unit">of {rows.length}</span>
            </div>
            <span className="stat-sub">Credible interval excludes zero</span>
          </div>
        </Card>
        <Card>
          <div className="stat">
            <span className="stat-label">No detectable effect</span>
            <div className="stat-value-row">
              <span className="stat-value">{nulls.length}</span>
            </div>
            <span className="stat-sub">
              {nulls.length ? nulls.map((r) => label(r.feature)).join(', ') : 'None'}
            </span>
          </div>
        </Card>
      </div>

      <Card className="section-gap">
        <CardHead
          title={`Feature effects — ${scopeLabel}`}
          description="Bars run from zero. The lighter band behind each bar is the 95% credible interval."
        />

        <AsyncSection
          loading={loading || runsLoading}
          error={error ?? runsError}
          hasData={rows.length > 0}
          isEmpty={Boolean(effects) && rows.length === 0}
          onRetry={refetch}
          errorTitle="Could not load feature effects"
          skeleton={<SkeletonRows rows={8} />}
          empty={(
            <EmptyState
              icon="models"
              title={hybrid ? 'No effects stored for this scope' : 'No hybrid model run found'}
              body={hybrid
                ? 'The model service writes feature_importance per run and per region. Run npm run seed:fixtures in the backend to populate illustrative values, or pick another scope.'
                : 'Feature effects come from the Bayesian-neural hybrid. Run npm run seed in the backend first.'}
            />
          )}
        >
          {view === 'chart' ? (
            <CardBody>
              <div className="effect-list">
                {rows.map((r) => (
                  <EffectBar key={`${r.feature}-${r.lag_months ?? 'x'}`} row={r} maxAbs={maxAbs} t={t} />
                ))}
              </div>
            </CardBody>
          ) : (
            <DataTable
              caption={`Feature effects, ${scopeLabel}`}
              rows={rows}
              getRowKey={(r) => `${r.feature}-${r.lag_months ?? 'x'}`}
              columns={[
                { key: 'feature', header: 'Feature', className: 'cell-strong', render: (r) => label(r.feature) },
                { key: 'lag_months', header: 'Lag', align: 'right', render: (r) => (r.lag_months ? `${r.lag_months} mo` : <span className="cell-quiet">—</span>) },
                {
                  key: 'importance',
                  header: 'Effect',
                  align: 'right',
                  className: 'cell-strong',
                  render: (r) => `${toNumber(r.importance) > 0 ? '+' : ''}${formatNumber(r.importance, { decimals: 3 })}`,
                },
                {
                  key: 'ci',
                  header: '95% credible interval',
                  align: 'right',
                  render: (r) => (
                    <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>
                      [{formatNumber(r.ci_lower, { decimals: 3 })}, {formatNumber(r.ci_upper, { decimals: 3 })}]
                    </span>
                  ),
                },
                {
                  key: 'verdict',
                  header: 'Verdict',
                  render: (r) => ((r.crosses_zero === 1 || r.crosses_zero === true)
                    ? <span className="badge badge-neutral"><span className="badge-dot" />Not distinguishable from zero</span>
                    : <span className="badge badge-accent"><span className="badge-dot" />Influential</span>),
                },
                { key: 'method', header: 'Method', render: (r) => <span className="mono cell-quiet">{r.method}</span> },
              ]}
            />
          )}
        </AsyncSection>

        <CardFoot>
          An effect is only called influential when its 95% credible interval excludes zero.
          With 17 regions there is little cross-sectional power, so a static predictor such as
          population density can be genuinely undetectable here — that is a finding, not a gap
          in the model.
        </CardFoot>
      </Card>
    </>
  )
}
