import { useMemo, useState } from 'react'
import { useFetch } from '../hooks/useFetch.js'
import { alertsApi } from '../services/api.js'
import { Card, CardFoot, CardHead } from '../components/Card.jsx'
import { PageHeader, Select } from '../components/Controls.jsx'
import { AsyncSection, EmptyState, SkeletonRows } from '../components/States.jsx'
import DataTable from '../components/DataTable.jsx'
import RiskBadge from '../components/RiskBadge.jsx'
import Icon from '../components/Icon.jsx'
import { RISK_ORDER, formatDate, formatRelative, riskRank, titleCase } from '../lib/format.js'

const LEVEL_OPTIONS = [
  { value: 'all', label: 'All levels' },
  { value: 'elevated', label: 'High and severe only' },
  ...RISK_ORDER.map((l) => ({ value: l, label: titleCase(l) })),
]

export default function Alerts() {
  const [level, setLevel] = useState('all')
  const { data: alerts, loading, error, refetch } = useFetch(() => alertsApi.list(), [])

  const list = alerts ?? []

  const counts = useMemo(() => {
    const out = Object.fromEntries(RISK_ORDER.map((l) => [l, 0]))
    for (const a of list) {
      const key = String(a.risk_level ?? '').toLowerCase()
      if (key in out) out[key] += 1
    }
    return out
  }, [list])

  const filtered = useMemo(() => {
    if (level === 'all') return list
    if (level === 'elevated') return list.filter((a) => riskRank(a.risk_level) >= riskRank('high'))
    return list.filter((a) => String(a.risk_level).toLowerCase() === level)
  }, [list, level])

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Region-level early warnings written by the latest model run, newest first."
      />

      {/* One filter row, above everything it scopes. */}
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

      <Card>
        <CardHead
          title={level === 'all' ? 'All alerts' : `Filtered alerts`}
          description={`${filtered.length} of ${list.length} alert${list.length === 1 ? '' : 's'} shown.`}
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
              { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
              { key: 'when', header: 'Raised', render: (r) => <span className="cell-quiet">{formatRelative(r.date)}</span> },
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
          Risk level uses the reserved status scale, and every badge pairs its colour with an icon and a
          written label, so the level is never carried by colour alone.
        </CardFoot>
      </Card>
    </>
  )
}
