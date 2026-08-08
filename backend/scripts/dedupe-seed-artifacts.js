#!/usr/bin/env node
/*
 * Remove the duplicate rows left behind by running `npm run seed` twice.
 *
 *   npm run dedupe              # report only, changes nothing (default)
 *   npm run dedupe -- --apply   # actually delete
 *
 * Why this is a separate script and not part of migration 002: it DELETES
 * rows. A migration should be safe to run unattended; deciding that a row is
 * junk is a judgement call, so it needs a human and an explicit flag.
 *
 * What it targets, and only this:
 *   - regions with an identical (name, province) — keeps the LOWEST id, which
 *     is the one existing foreign keys already point at
 *   - model_runs with an identical (model_type, version, trained_at) — keeps
 *     the lowest id, cascading to its predictions and evaluation_metrics
 *
 * Root cause, fixed separately: `regions` had no unique constraint, so the
 * `INSERT IGNORE` in seed.js had nothing to catch on, and `model_runs` used a
 * plain INSERT. Migration 003 adds the region identity key once this has run.
 */

import { pool } from '../src/config/db.js'

const APPLY = process.argv.includes('--apply')
const log = (...a) => console.log(...a)

async function main() {
  log(`\nSeed-artifact dedupe${APPLY ? '  [APPLY — rows will be deleted]' : '  [REPORT ONLY]'}`)

  const conn = await pool.getConnection()
  try {
    // ---- regions -----------------------------------------------------------
    const [dupRegions] = await conn.query(`
      SELECT name, province, COUNT(*) n,
             MIN(id) keep_id,
             GROUP_CONCAT(id ORDER BY id) all_ids
      FROM regions
      GROUP BY name, province
      HAVING n > 1
      ORDER BY name
    `)

    log(`\nregions — ${dupRegions.length} duplicated identit${dupRegions.length === 1 ? 'y' : 'ies'}`)
    let regionVictims = []
    for (const d of dupRegions) {
      const drop = d.all_ids.split(',').map(Number).filter((id) => id !== d.keep_id)
      regionVictims.push(...drop)
      // Show what each candidate row actually owns, so "junk" is a verified
      // claim rather than an assumption.
      for (const id of drop) {
        const [[owns]] = await conn.query(
          `SELECT
             (SELECT COUNT(*) FROM case_data        WHERE region_id = ?) cases,
             (SELECT COUNT(*) FROM climate_data     WHERE region_id = ?) climate,
             (SELECT COUNT(*) FROM demographic_data WHERE region_id = ?) demo,
             (SELECT COUNT(*) FROM predictions      WHERE region_id = ?) preds,
             (SELECT COUNT(*) FROM alerts           WHERE region_id = ?) alerts`,
          [id, id, id, id, id],
        )
        const total = Object.values(owns).reduce((a, b) => a + b, 0)
        log(`  ${d.name} / ${d.province}: keep id ${d.keep_id}, drop id ${id}`
          + `  (owns ${total} dependent rows: ${JSON.stringify(owns)})`)
        if (total > 0) {
          log(`     !! id ${id} has dependent data — deleting cascades. Review before --apply.`)
        }
      }
    }

    // ---- model_runs --------------------------------------------------------
    const [dupRuns] = await conn.query(`
      SELECT model_type, version, trained_at, COUNT(*) n,
             MIN(id) keep_id, GROUP_CONCAT(id ORDER BY id) all_ids
      FROM model_runs
      GROUP BY model_type, version, trained_at
      HAVING n > 1
    `)

    // A second seed writes a *different* trained_at, so identical runs do not
    // group together. Fall back to (model_type, version) and keep the oldest.
    const [dupRunsLoose] = await conn.query(`
      SELECT model_type, version, COUNT(*) n,
             MIN(id) keep_id, GROUP_CONCAT(id ORDER BY id) all_ids
      FROM model_runs
      GROUP BY model_type, version
      HAVING n > 1
    `)

    log(`\nmodel_runs — ${dupRunsLoose.length} duplicated (model_type, version)`)
    let runVictims = []
    for (const d of dupRunsLoose) {
      const ids = d.all_ids.split(',').map(Number)
      const drop = ids.filter((id) => id !== d.keep_id)
      runVictims.push(...drop)
      for (const id of ids) {
        const [[owns]] = await conn.query(
          `SELECT
             (SELECT COUNT(*) FROM predictions        WHERE model_run_id = ?) preds,
             (SELECT COUNT(*) FROM evaluation_metrics WHERE model_run_id = ?) metrics,
             (SELECT trained_at FROM model_runs WHERE id = ?) trained_at`,
          [id, id, id],
        )
        const verdict = id === d.keep_id ? 'KEEP' : 'DROP'
        log(`  ${verdict}  id ${id}  ${d.model_type} ${d.version}`
          + `  trained ${owns.trained_at?.toISOString?.().slice(0, 19) ?? owns.trained_at}`
          + `  preds=${owns.preds} metrics=${owns.metrics}`)
      }
    }

    if (!regionVictims.length && !runVictims.length) {
      log('\nNothing to remove — no duplicates found.')
      return
    }

    log(`\nWould delete: ${regionVictims.length} region row(s), ${runVictims.length} model_run row(s)`)

    if (!APPLY) {
      log('\nReport only. Re-run with --apply to delete.')
      return
    }

    await conn.beginTransaction()
    let n = 0
    if (regionVictims.length) {
      const [r] = await conn.query('DELETE FROM regions WHERE id IN (?)', [regionVictims])
      log(`  deleted ${r.affectedRows} region row(s)`)
      n += r.affectedRows
    }
    if (runVictims.length) {
      const [r] = await conn.query('DELETE FROM model_runs WHERE id IN (?)', [runVictims])
      log(`  deleted ${r.affectedRows} model_run row(s) (predictions and metrics cascade)`)
      n += r.affectedRows
    }
    await conn.commit()
    log(`\nDone — ${n} row(s) removed. You can now apply migration 003.`)
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.release()
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\nDedupe failed:', err.message)
    await pool.end()
    process.exitCode = 1
  })
