import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

/*
 * GET /api/alerts?level=region|municipality|all
 *
 * The flat list the alerts table shows. Row shape is unchanged; only the scope
 * is new, and it mirrors `/api/regions?level=`.
 *
 * The default is `region`, not `all`, because the study is regional: the panel,
 * the model runs and the risk map all work on the 17 regions. Left unscoped,
 * this endpoint also returns three pre-revision seed alerts attached to
 * MUNICIPALITY rows literally named "Metro Manila" and "Davao Region" — stale
 * duplicates of NCR and Region XI carrying invented dates. Those made the
 * alerts table say 20 while the map drew 17, and inflated the sidebar badge.
 * `level=all` still returns everything for anyone auditing the table.
 */
export async function listAlerts(req, res) {
  const level = req.query.level ?? 'region'
  if (!['region', 'municipality', 'all'].includes(level)) {
    return sendJson(res, 400, { error: `Bad level "${level}" — expected region, municipality or all` })
  }

  const rows = await query(
    `SELECT a.id, DATE_FORMAT(a.date, '%Y-%m-%d') AS date, a.risk_level,
            a.triggered_by_model_run_id,
            a.region_id, r.name AS region_name, r.slug AS region_slug,
            r.admin_level
     FROM alerts a
     JOIN regions r ON r.id = a.region_id
     ${level === 'all' ? '' : 'WHERE r.admin_level = :level'}
     ORDER BY a.date DESC, a.id DESC
     LIMIT 200`,
    level === 'all' ? {} : { level },
  )
  sendJson(res, 200, rows)
}

/*
 * GET /api/alerts/regions?year=2019
 *
 * One row per study region: its current risk level plus the context a reader
 * needs to interpret that level — density, poverty, humidity and the recorded
 * case count for the reference year.
 *
 * Why a separate endpoint rather than four client-side calls: the map's hover
 * panel needs all of it at once for 17 regions, and assembling it in the
 * browser would mean joining `alerts`, `demographic_data`, `climate_data` and
 * `case_data` in JavaScript — four round trips and a join the database does
 * better.
 *
 * Regions with no alert are still returned, with `risk_level` NULL. The map
 * must be able to distinguish "no alert issued" from "low risk"; collapsing
 * them would tell a health officer that an unmonitored region is safe.
 */
export async function listRegionRisk(req, res) {
  // `Number(x) || 2019` would swallow a typo as the default — every other
  // endpoint rejects bad input rather than guessing, so this one does too.
  const raw = req.query.year
  const year = raw === undefined || raw === '' ? 2019 : Number(raw)
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return sendJson(res, 400, { error: `Bad year "${raw}" — expected a 4-digit year` })
  }

  const rows = await query(
    `SELECT
       r.id            AS region_id,
       r.slug          AS region_slug,
       r.name          AS region_name,
       r.land_area_km2,

       a.id            AS alert_id,
       a.risk_level,
       DATE_FORMAT(a.date, '%Y-%m-%d') AS alert_date,
       a.triggered_by_model_run_id,

       d.population,
       d.population_density,
       d.poverty_rate,
       d.urban_pct,
       d.source        AS demographic_source,

       cases.confirmed_cases,
       cases.deaths,
       CASE WHEN d.population > 0
            THEN ROUND(cases.confirmed_cases / d.population * 100000, 1)
            ELSE NULL END AS incidence_per_100k,

       ROUND(clim.humidity, 2)      AS humidity,
       ROUND(clim.temperature, 2)   AS temperature,
       ROUND(clim.rainfall, 1)      AS rainfall

     FROM regions r

     -- Newest alert per region. A region can accumulate alerts over time and
     -- the map shows its CURRENT level, not its history.
     LEFT JOIN alerts a
       ON a.id = (
         SELECT a2.id FROM alerts a2
         WHERE a2.region_id = r.id
         ORDER BY a2.date DESC, a2.id DESC
         LIMIT 1
       )

     LEFT JOIN demographic_data d
       ON d.region_id = r.id AND d.year = :year

     -- Annual totals and annual climate means for the reference year, so the
     -- hover panel compares like with like.
     LEFT JOIN (
       SELECT region_id,
              SUM(confirmed_cases) AS confirmed_cases,
              SUM(deaths)          AS deaths
       FROM case_data
       WHERE period_type = 'month' AND YEAR(date) = :year
       GROUP BY region_id
     ) cases ON cases.region_id = r.id

     LEFT JOIN (
       SELECT region_id,
              AVG(humidity)    AS humidity,
              AVG(temperature) AS temperature,
              AVG(rainfall)    AS rainfall
       FROM climate_data
       WHERE YEAR(date) = :year
       GROUP BY region_id
     ) clim ON clim.region_id = r.id

     WHERE r.admin_level = 'region'
     ORDER BY r.name`,
    { year },
  )

  sendJson(res, 200, rows)
}
