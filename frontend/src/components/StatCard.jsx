import Icon from './Icon.jsx'
import Sparkline from './Sparkline.jsx'

/*
 * Stat tile contract: label / value / optional unit, delta, sublabel and a
 * 12-point sparkline. The value keeps proportional figures on purpose --
 * tabular-nums makes a number like 121 look loose at this size.
 */

/*
 * Direction and tone are separate on purpose: the arrow reports which way the
 * data moved, the colour reports whether that is good news. For case counts
 * those disagree -- a fall is a down arrow *and* the good colour -- and
 * collapsing them into one signal is how a chart ends up claiming the
 * opposite of its own numbers.
 */
function Delta({ delta }) {
  if (!delta) return null
  const { value, direction = 'flat', tone = 'flat', label } = delta
  const icon = direction === 'up' ? 'arrowUp' : direction === 'down' ? 'arrowDown' : 'minus'
  return (
    <span className={`delta delta-${tone}`}>
      <Icon name={icon} size={12} strokeWidth={2.2} />
      {value}
      {label && <span className="muted" style={{ fontWeight: 500 }}>&nbsp;{label}</span>}
    </span>
  )
}

export default function StatCard({
  label,
  value,
  unit,
  sublabel,
  delta,
  trend,
  loading = false,
  icon,
}) {
  return (
    <div className="card">
      <div className="stat">
        <span className="stat-label">
          {icon && <Icon name={icon} size={13} style={{ verticalAlign: -2, marginRight: 5 }} />}
          {label}
        </span>

        {loading ? (
          <div className="skeleton" style={{ width: 92, height: 28, marginBlock: 2 }} />
        ) : (
          <div className="stat-value-row">
            <span className="stat-value">{value}</span>
            {unit && <span className="stat-unit">{unit}</span>}
            <Delta delta={delta} />
          </div>
        )}

        {sublabel && <span className="stat-sub">{sublabel}</span>}

        {trend && trend.length > 1 && (
          <div className="stat-spark">
            <Sparkline values={trend} />
          </div>
        )}
      </div>
    </div>
  )
}
