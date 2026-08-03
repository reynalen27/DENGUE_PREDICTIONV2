import Icon from './Icon.jsx'

export function EmptyState({ icon = 'inbox', title, body, actions }) {
  return (
    <div className="state">
      <span className="state-glyph"><Icon name={icon} size={20} /></span>
      <p className="state-title">{title}</p>
      {body && <p className="state-body">{body}</p>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Could not load this data', error, onRetry }) {
  const detail =
    error?.response?.data?.error ||
    (error?.code === 'ERR_NETWORK'
      ? 'The API server did not respond. Check that the backend is running on port 4000.'
      : error?.message) ||
    'Unexpected error.'

  return (
    <div className="state state-error">
      <span className="state-glyph"><Icon name="warning" size={20} /></span>
      <p className="state-title">{title}</p>
      <p className="state-body">{detail}</p>
      {onRetry && (
        <div className="state-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            <Icon name="refresh" size={14} />
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

export function SkeletonRows({ rows = 4 }) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 14, width: `${92 - i * 9}%` }} />
      ))}
    </div>
  )
}

export function SkeletonBlock({ height = 240 }) {
  return (
    <div style={{ padding: 'var(--sp-5)' }} aria-hidden="true">
      <div className="skeleton" style={{ height, borderRadius: 'var(--r-md)' }} />
    </div>
  )
}

/*
 * One place that decides between loading / error / empty / content, so every
 * card in the app resolves those four states the same way. On a refetch the
 * previous render is held at reduced opacity rather than replaced by a
 * skeleton -- no flash, no layout jump.
 */
export function AsyncSection({
  loading,
  error,
  isEmpty,
  onRetry,
  skeleton,
  empty,
  errorTitle,
  hasData,
  children,
}) {
  if (error && !hasData) return <ErrorState title={errorTitle} error={error} onRetry={onRetry} />
  if (loading && !hasData) return skeleton ?? <SkeletonRows />
  if (isEmpty) return empty ?? <EmptyState title="Nothing to show yet" />
  return <div className={loading ? 'is-stale' : undefined}>{children}</div>
}
