import { useId } from 'react'
import Icon from './Icon.jsx'

export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  )
}

export function Select({ label, value, onChange, options, hideLabel = false, disabled }) {
  const id = useId()
  return (
    <div className="field">
      <label className={hideLabel ? 'sr-only' : 'field-label'} htmlFor={id}>{label}</label>
      <div className="select-wrap">
        <select
          id={id}
          className="input"
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Icon name="chevronDown" size={15} />
      </div>
    </div>
  )
}

/*
 * The chart/table switch. Both views show the same numbers -- the table is
 * the WCAG-clean twin, never a fallback, so no value is gated behind hover.
 */
export function ViewToggle({ view, onChange, label = 'View' }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      <button type="button" aria-pressed={view === 'chart'} onClick={() => onChange('chart')}>
        <Icon name="chart" size={13} />
        Chart
      </button>
      <button type="button" aria-pressed={view === 'table'} onClick={() => onChange('table')}>
        <Icon name="table" size={13} />
        Table
      </button>
    </div>
  )
}

export function Notice({ tone = 'info', icon, children }) {
  const glyph = icon ?? (tone === 'bad' ? 'warning' : tone === 'good' ? 'check' : tone === 'warning' ? 'warning' : 'info')
  return (
    <div className={`notice notice-${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={glyph} size={15} />
      <span>{children}</span>
    </div>
  )
}

/** Small colour key that sits beside text; identity never rides the text colour. */
export function LegendItem({ color, label, shape = 'line', note }) {
  return (
    <span className="legend-item">
      {shape === 'line' && <span className="key-line" style={{ background: color }} />}
      {shape === 'swatch' && <span className="key-swatch" style={{ background: color }} />}
      {shape === 'band' && (
        <span
          className="legend-band"
          style={{ background: color, opacity: 0.22, border: `1px solid ${color}` }}
        />
      )}
      {label}
      {note && <span className="muted">&nbsp;{note}</span>}
    </span>
  )
}
