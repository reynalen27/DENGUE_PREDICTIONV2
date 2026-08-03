/*
 * Shared Recharts tooltip.
 *
 * Value leads, series name follows -- the reader already knows which series
 * they are on and wants the number. Rows are keyed with a short stroke of the
 * series colour rather than a filled box, and the name is rendered as a text
 * node (never innerHTML), because series labels come from the database.
 */
export default function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter, footer }) {
  if (!active || !payload?.length) return null

  const rows = payload.filter((p) => p.value !== null && p.value !== undefined && !p.hide)

  return (
    <div className="chart-tip" role="tooltip">
      <div className="chart-tip-head">{labelFormatter ? labelFormatter(label) : label}</div>
      {rows.map((row) => (
        <div className="chart-tip-row" key={row.dataKey ?? row.name}>
          <span className="chart-tip-key">
            <span className="key-line" style={{ background: row.color ?? row.stroke }} />
            <span className="chart-tip-name">{row.name}</span>
          </span>
          <span className="chart-tip-value">
            {valueFormatter ? valueFormatter(row.value, row) : row.value}
          </span>
        </div>
      ))}
      {footer && <div className="chart-tip-head" style={{ borderBottom: 0, borderTop: '1px solid var(--line-grid)', marginTop: 6, marginBottom: 0, paddingTop: 6, paddingBottom: 0 }}>{footer}</div>}
    </div>
  )
}
