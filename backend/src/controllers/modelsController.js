import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

// Joins model_runs with evaluation_metrics so the frontend can render the
// hybrid-vs-baseline comparison table in one call, best RMSE first.
export async function compareModels(req, res) {
  const rows = await query(`
    SELECT mr.id, mr.model_type, mr.version, mr.trained_at,
           em.rmse, em.mae, em.mape, em.crps, em.coverage
    FROM model_runs mr
    JOIN evaluation_metrics em ON em.model_run_id = mr.id
    ORDER BY em.rmse ASC
  `)
  sendJson(res, 200, rows)
}
