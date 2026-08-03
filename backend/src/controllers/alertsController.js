import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

export async function listAlerts(req, res) {
  const rows = await query(`
    SELECT a.id, a.date, a.risk_level, a.triggered_by_model_run_id, r.name AS region_name
    FROM alerts a
    JOIN regions r ON r.id = a.region_id
    ORDER BY a.date DESC
    LIMIT 200
  `)
  sendJson(res, 200, rows)
}
