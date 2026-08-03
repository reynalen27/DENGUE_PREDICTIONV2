/*
 * Formatting helpers.
 *
 * Two shapes come out of the API that need care:
 *  - MySQL DECIMAL columns arrive as strings ("28.300"), so anything numeric
 *    has to go through toNumber() before arithmetic or comparison.
 *  - DATE columns arrive as full ISO timestamps at local midnight
 *    ("2026-08-02T16:00:00.000Z" is 3 Aug in UTC+8), so they are formatted in
 *    the viewer's local zone, which puts them back on the intended day.
 */

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Trims MySQL's trailing decimal zeros: "28.300" -> "28.3", "89.60" -> "89.6" */
export function formatNumber(value, { decimals, unit = '' } = {}) {
  const n = toNumber(value)
  if (n === null) return '—'
  const text =
    decimals === undefined
      ? n.toLocaleString(undefined, { maximumFractionDigits: 3 })
      : n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return unit ? `${text}${unit}` : text
}

export function formatInt(value) {
  const n = toNumber(value)
  return n === null ? '—' : Math.round(n).toLocaleString()
}

/** Stat-tile compaction: 1,284 / 12.9K / 4.2M */
export function formatCompact(value) {
  const n = toNumber(value)
  if (n === null) return '—'
  if (Math.abs(n) < 10000) return Math.round(n).toLocaleString()
  return n.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })
}

export function formatDate(value, style = 'medium') {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  if (style === 'short') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (style === 'axis') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (style === 'long') {
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/** "3 days ago" / "in 2 weeks" — falls back to a date when far out. */
export function formatRelative(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000)
  if (Math.abs(days) > 60) return formatDate(value)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(days) >= 7) return rtf.format(Math.round(days / 7), 'week')
  return rtf.format(days, 'day')
}

/** Strips the time part so a DATE can be used as a map key or compared. */
export function dayKey(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const RISK_ORDER = ['low', 'moderate', 'high', 'severe']

export function riskRank(level) {
  const i = RISK_ORDER.indexOf(String(level ?? '').toLowerCase())
  return i === -1 ? 0 : i
}

export function titleCase(value) {
  const s = String(value ?? '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
