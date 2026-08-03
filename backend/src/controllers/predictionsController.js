import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

// Predictions are produced by the separate Python model service and written
// into MySQL. This endpoint only reads the latest run's forecast for a region.
export async function getPredictionsForRegion(req, res) {
  const { regionId } = req.params
  const { modelRunId } = req.query

  const runId = modelRunId
    ? modelRunId
    : (
        await query(
          // id breaks the tie: seeded runs share a trained_at, and without it
          // MySQL can return a run that has no predictions rows.
          'SELECT id FROM model_runs ORDER BY trained_at DESC, id DESC LIMIT 1',
        )
      )[0]?.id

  if (!runId) {
    return sendJson(res, 200, [])
  }

  const rows = await query(
    `SELECT date, predicted_cases, ci_lower, ci_upper
     FROM predictions
     WHERE region_id = :regionId AND model_run_id = :runId
     ORDER BY date ASC`,
    { regionId, runId },
  )
  sendJson(res, 200, rows)
}
