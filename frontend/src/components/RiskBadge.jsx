import Icon from './Icon.jsx'
import { titleCase } from '../lib/format.js'

/*
 * Risk level is a *status*, so it wears the reserved status scale rather than
 * a categorical slot -- and it always ships the icon + label pairing, never
 * colour alone. That pairing is also what mitigates the sub-3:1 contrast of
 * the warning and serious steps against a light surface.
 */

const LEVELS = {
  low:      { className: 'badge-low',      icon: 'shield',  label: 'Low' },
  moderate: { className: 'badge-moderate', icon: 'info',    label: 'Moderate' },
  high:     { className: 'badge-high',     icon: 'warning', label: 'High' },
  severe:   { className: 'badge-severe',   icon: 'alerts',  label: 'Severe' },
}

export default function RiskBadge({ level = 'low', withIcon = true }) {
  const key = String(level ?? '').toLowerCase()
  const spec = LEVELS[key]

  if (!spec) {
    return (
      <span className="badge badge-neutral">
        <span className="badge-dot" />
        {titleCase(level) || 'Unknown'}
      </span>
    )
  }

  return (
    <span className={`badge ${spec.className}`}>
      {withIcon
        ? <Icon name={spec.icon} size={13} strokeWidth={1.9} className="badge-icon" />
        : <span className="badge-dot" />}
      {spec.label}
      <span className="sr-only"> risk</span>
    </span>
  )
}
