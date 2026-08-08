import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

/*
 * The modelling panel: one row per region-month with the target and every
 * predictor the study objective names.
 *
 *   GET /api/panel
 *   GET /api/panel?region=R4A&from=2019-01&to=2019-12
 *
 * This is the join the Python model service trains on, exposed so the app can
 * show the same numbers the model saw. Three tables have to line up:
 *
 *   case_data        monthly, period_type='month'
 *   climate_data     monthly, same date
 *   demographic_data ANNUAL — joined on YEAR(date), because population is a
 *                    census figure interpolated between 2015 and 2020, not a
 *                    monthly observation
 *
 * `period_type = 'month'` and `admin_level = 'region'` are both required. Without
 * them the query would sweep in the 142 CALABARZON municipalities and their
 * annual totals, and silently return a panel that mixes two reporting periods
 * at two geographic levels.
 */

const MAX_ROWS = 5000

/*
 * Two traps live in the query below. Both cost a debugging round trip, so they
 * are documented here rather than inline:
 *
 * 1. NEVER put a colon in a SQL comment in this codebase. The pool runs with
 *    `namedPlaceholders: true`, so mysql2 scans the whole statement for
 *    `:name` — including inside `--` comments. An example timestamp written
 *    as 16-00-00 with colons registers `:00` as a bind parameter and the query
 *    dies with "Bind parameters must not contain undefined".
 *
 * 2. `c.date` serialises misleadingly. mysql2 returns a DATE as a JS Date at
 *    LOCAL midnight, which JSON-encodes to the previous day in UTC+8 —
 *    2019-08-01 leaves as a 2019-07-31 timestamp. Any client that string-slices
 *    it reads the wrong month. `period`, `year` and `month` are formatted by
 *    MySQL, carry no timezone, and are the fields to key on.
 */

/** 'YYYY-MM' or 'YYYY-MM-DD' -> 'YYYY-MM-01', else null. */
function monthStart(value) {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})/.exec(String(value).trim())
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}-01`
}

export async function getPanel(req, res) {
  const { region, regionId, from, to } = req.query

  const fromDate = monthStart(from)
  const toDate = monthStart(to)
  if (from && !fromDate) return sendJson(res, 400, { error: `Bad "from": expected YYYY-MM, got "${from}"` })
  if (to && !toDate) return sendJson(res, 400, { error: `Bad "to": expected YYYY-MM, got "${to}"` })
  if (fromDate && toDate && fromDate > toDate) {
    return sendJson(res, 400, { error: `"from" (${from}) is after "to" (${to})` })
  }

  const where = ["c.period_type = 'month'", "r.admin_level = 'region'"]
  const params = {}
  if (region) { where.push('r.slug = :region'); params.region = region }
  if (regionId) { where.push('r.id = :regionId'); params.regionId = regionId }
  if (fromDate) { where.push('c.date >= :fromDate'); params.fromDate = fromDate }
  if (toDate) { where.push('c.date <= :toDate'); params.toDate = toDate }

  const rows = await query(
    `SELECT
       r.id            AS region_id,
       r.slug          AS region_slug,
       r.name          AS region_name,
       c.date,
       DATE_FORMAT(c.date, '%Y-%m') AS period,
       YEAR(c.date)    AS year,
       MONTH(c.date)   AS month,
       c.confirmed_cases,
       c.deaths,
       d.population,
       d.population_density,
       d.urban_pct,
       -- PSA poverty incidence among FAMILIES, not individuals. Two source
       -- years only (2015 and 2018) interpolated across the case window; the
       -- population_source column says which values are derived and how.
       d.poverty_rate,
       d.source        AS population_source,
       cl.temperature,
       cl.rainfall,
       cl.humidity,
       cl.hot_days,
       CASE WHEN d.population > 0
            THEN ROUND(c.confirmed_cases / d.population * 100000, 4)
            ELSE NULL END AS incidence_per_100k
     FROM case_data c
     JOIN regions r          ON r.id = c.region_id
     JOIN climate_data cl    ON cl.region_id = r.id AND cl.date = c.date
     JOIN demographic_data d ON d.region_id = r.id AND d.year = YEAR(c.date)
     WHERE ${where.join(' AND ')}
     ORDER BY r.slug, c.date
     LIMIT ${MAX_ROWS}`,
    params,
  )

  sendJson(res, 200, rows)
}
