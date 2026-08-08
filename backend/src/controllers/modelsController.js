import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

/*
 * Endpoints behind the study's four claims.
 *
 *   GET /api/models/compare?scope=overall|region   objectives 1 and 2
 *   GET /api/models/:runId/coverage                objectives 2 and 4
 *   GET /api/models/:runId/calibration             objective 4
 *   GET /api/models/:runId/importance              objective 3
 *
 * Every one of these reads a table the model service owns. They return an
 * empty array rather than an error when a run has not produced that output
 * yet, so the UI can distinguish "not computed" from "failed".
 */

const SCOPES = new Set(['overall', 'region'])

/** Reject a non-numeric :runId before it reaches SQL. */
function runIdOf(req) {
  const raw = req.params.runId
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Model runs joined to their evaluation metrics, best RMSE first.
 *
 * `scope` splits two different questions: 'overall' is one row per model
 * (the headline comparison), 'region' is one row per model per region (which
 * is what objective 3 needs to talk about influence *per region*).
 *
 * The train/test window travels with every row on purpose. "The hybrid beat
 * SARIMA" is unreproducible without it, and a reader comparing two runs fitted
 * on different windows is comparing nothing.
 */
export async function compareModels(req, res) {
  const scope = req.query.scope ?? 'overall'
  if (!SCOPES.has(scope)) {
    return sendJson(res, 400, { error: `Unknown scope "${scope}". Expected: ${[...SCOPES].join(', ')}` })
  }

  const rows = await query(
    /*
     * The four window dates are DATE_FORMAT-ed rather than returned raw.
     * mysql2 gives a DATE back as a JS Date at local midnight, which
     * JSON-encodes to the previous day in UTC+8 — a train_start stored as
     * 2016-01-01 reaches the client reading 2015-12-31, which would then be
     * printed on the comparison page as the study's training window. These
     * strings carry no timezone.
     */
    `SELECT mr.id, mr.model_type, mr.version, mr.trained_at,
            DATE_FORMAT(mr.train_start, '%Y-%m-%d') AS train_start,
            DATE_FORMAT(mr.train_end,   '%Y-%m-%d') AS train_end,
            DATE_FORMAT(mr.test_start,  '%Y-%m-%d') AS test_start,
            DATE_FORMAT(mr.test_end,    '%Y-%m-%d') AS test_end,
            mr.horizon_months, mr.feature_set_json, mr.notes,
            em.scope, em.region_id, r.slug AS region_slug, r.name AS region_name,
            em.rmse, em.mae, em.mape, em.crps, em.coverage,
            em.mean_interval_width, em.n_obs
     FROM model_runs mr
     JOIN evaluation_metrics em ON em.model_run_id = mr.id
     LEFT JOIN regions r        ON r.id = em.region_id
     WHERE em.scope = :scope
     ORDER BY r.name IS NULL DESC, r.name, em.rmse ASC`,
    { scope },
  )

  sendJson(res, 200, rows)
}

/**
 * Nominal vs empirical interval coverage — objective 4.
 *
 * `mean_width` ships alongside deliberately. Coverage on its own is not
 * evidence of a good interval: one wide enough to contain every plausible
 * value has perfect coverage and no decision value. The pair is the claim.
 */
export async function getCoverage(req, res) {
  const runId = runIdOf(req)
  if (!runId) return sendJson(res, 400, { error: 'runId must be a positive integer' })

  const { regionId } = req.query
  const where = ['ic.model_run_id = :runId']
  const params = { runId }
  if (regionId === 'null' || regionId === 'overall') where.push('ic.region_id IS NULL')
  else if (regionId) { where.push('ic.region_id = :regionId'); params.regionId = regionId }

  const rows = await query(
    `SELECT ic.id, ic.model_run_id, ic.region_id,
            r.slug AS region_slug, r.name AS region_name,
            ic.nominal_level, ic.empirical_level, ic.mean_width, ic.n_obs,
            ROUND(ic.empirical_level - ic.nominal_level, 2) AS gap
     FROM interval_coverage ic
     LEFT JOIN regions r ON r.id = ic.region_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.name IS NULL DESC, r.name, ic.nominal_level`,
    params,
  )

  sendJson(res, 200, rows)
}

/**
 * PIT histogram — objective 4.
 *
 * Flat means calibrated. U-shaped means the model is overconfident (too many
 * observations fall outside its intervals). Hump-shaped means the intervals
 * are wider than they need to be.
 */
export async function getCalibration(req, res) {
  const runId = runIdOf(req)
  if (!runId) return sendJson(res, 400, { error: 'runId must be a positive integer' })

  const rows = await query(
    `SELECT id, model_run_id, bin_lower, bin_upper, observed_freq, n_obs
     FROM calibration_bins
     WHERE model_run_id = :runId
     ORDER BY bin_lower`,
    { runId },
  )

  sendJson(res, 200, rows)
}

/**
 * Feature effects with uncertainty — objective 3.
 *
 * `crosses_zero` is computed here rather than left to the client because it is
 * the whole interpretability claim: an effect whose credible interval spans
 * zero is not distinguishable from no effect, and a ranking that hides that is
 * a leaderboard pretending to be an explanation. Every consumer must see it,
 * so the API states it rather than hoping each caller re-derives it.
 *
 *   ?regionId=<id>   effects for one region
 *   ?regionId=global effects pooled across regions (region_id IS NULL)
 */
export async function getFeatureImportance(req, res) {
  const runId = runIdOf(req)
  if (!runId) return sendJson(res, 400, { error: 'runId must be a positive integer' })

  const { regionId, method } = req.query
  const where = ['fi.model_run_id = :runId']
  const params = { runId }
  if (regionId === 'global' || regionId === 'null') where.push('fi.region_id IS NULL')
  else if (regionId) { where.push('fi.region_id = :regionId'); params.regionId = regionId }
  if (method) { where.push('fi.method = :method'); params.method = method }

  const rows = await query(
    `SELECT fi.id, fi.model_run_id, fi.region_id,
            r.slug AS region_slug, r.name AS region_name,
            fi.feature, fi.lag_months, fi.importance,
            fi.ci_lower, fi.ci_upper, fi.method, fi.rank_in_scope,
            CASE WHEN fi.ci_lower IS NULL OR fi.ci_upper IS NULL THEN NULL
                 WHEN fi.ci_lower <= 0 AND fi.ci_upper >= 0 THEN 1
                 ELSE 0 END AS crosses_zero
     FROM feature_importance fi
     LEFT JOIN regions r ON r.id = fi.region_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.name IS NULL DESC, r.name, ABS(fi.importance) DESC`,
    params,
  )

  sendJson(res, 200, rows)
}
