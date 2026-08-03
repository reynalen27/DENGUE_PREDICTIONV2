import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

export async function listRegions(req, res) {
  const rows = await query('SELECT id, name, province, region_code, lat, lng FROM regions ORDER BY name')
  sendJson(res, 200, rows)
}
