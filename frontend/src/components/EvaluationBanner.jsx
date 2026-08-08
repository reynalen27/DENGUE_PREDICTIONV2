import Icon from './Icon.jsx'
import { formatDate } from '../lib/format.js'

/*
 * The evaluation window, shown on every page that reports a metric.
 *
 * "The hybrid beat SARIMA" means nothing without the window it was fitted and
 * scored on, and a reader comparing two runs trained on different windows is
 * comparing nothing. The window travels with the numbers rather than living in
 * a methods section nobody scrolls to.
 *
 * It also surfaces `notes`. While the tables hold demo fixtures every run is
 * stamped "DEMO FIXTURE", and a page that renders invented numbers without
 * saying so is the single worst thing this UI could do.
 */
export default function EvaluationBanner({ run, extra }) {
  if (!run) return null

  const isFixture = /demo fixture/i.test(run.notes ?? '')
  const features = (() => {
    if (!run.feature_set_json) return null
    try {
      return typeof run.feature_set_json === 'string'
        ? JSON.parse(run.feature_set_json)
        : run.feature_set_json
    } catch { return null }
  })()

  const window = (from, to) => (from && to ? `${formatDate(from)} – ${formatDate(to)}` : '—')

  return (
    <>
      {isFixture && (
        <div className="notice notice-warning" role="status" style={{ marginBottom: 'var(--sp-4)' }}>
          <Icon name="warning" size={15} />
          <span>
            <strong>These are demo fixtures, not model output.</strong>{' '}
            The values below are illustrative so the page can be built before the
            model service exists. Run <code className="mono">npm run seed:fixtures -- --clear</code>{' '}
            before loading real results.
          </span>
        </div>
      )}

      <div className="filter-bar" style={{ marginBottom: 'var(--sp-5)' }}>
        <span className="filter-bar-label">Trained on</span>
        <span className="tag"><Icon name="clock" size={12} />{window(run.train_start, run.train_end)}</span>
        <span className="filter-bar-label" style={{ marginLeft: 'var(--sp-2)' }}>Tested on</span>
        <span className="tag"><Icon name="target" size={12} />{window(run.test_start, run.test_end)}</span>
        {run.horizon_months && (
          <span className="tag">{run.horizon_months}-month horizon</span>
        )}
        {features?.excluded && (
          <span className="badge badge-moderate">
            <Icon name="info" size={13} strokeWidth={1.9} className="badge-icon" />
            {Object.entries(features.excluded).map(([k, v]) => `${k} excluded — ${v}`).join('; ')}
          </span>
        )}
        {extra && <><span className="filter-bar-spacer" />{extra}</>}
      </div>
    </>
  )
}
