import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

const LEVELS = new Set(['region', 'province', 'municipality'])

/*
 * The table holds two scopes at once: the 17 administrative regions that are
 * the study's unit of analysis, and the 142 CALABARZON municipalities behind
 * the municipal map. Returning them in one undifferentiated list puts
 * "National Capital Region" next to "Agdangan" in every selector, so the
 * response carries `admin_level` and callers say which scope they mean.
 *
 *   GET /api/regions                       -> everything, tagged
 *   GET /api/regions?level=region          -> the 17 study regions
 *   GET /api/regions?level=municipality    -> the 142 CALABARZON LGUs
 */
export async function listRegions(req, res) {
  const { level } = req.query

  if (level && !LEVELS.has(level)) {
    return sendJson(res, 400, {
      error: `Unknown level "${level}". Expected one of: ${[...LEVELS].join(', ')}`,
    })
  }

  const rows = await query(
    `SELECT id, slug, admin_level, name, province, region_code,
            psgc_code, land_area_km2, lat, lng
     FROM regions
     ${level ? 'WHERE admin_level = :level' : ''}
     ORDER BY admin_level, name`,
    level ? { level } : {},
  )

  sendJson(res, 200, rows)
}
