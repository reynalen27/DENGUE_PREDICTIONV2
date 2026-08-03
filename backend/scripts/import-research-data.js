#!/usr/bin/env node
/*
 * ETL: RESEARCH DATA SET -> MySQL
 * ---------------------------------------------------------------------------
 * Loads the CALABARZON research data into `regions`, `case_data`,
 * `climate_data` and `demographic_data`.
 *
 *   npm run etl                          # load everything, upsert
 *   npm run etl -- --dry-run             # parse and report, write nothing
 *   npm run etl -- --reset               # clear the four tables first
 *   npm run etl -- --laguna-proxy=Ambulong
 *   npm run etl -- --only=regions,climate
 *
 * It never touches `model_runs`, `predictions`, `evaluation_metrics` or
 * `alerts` — those belong to the model service, not to observed data.
 *
 * Every defect it repairs is documented in DATA_ASSESSMENT.md and reported at
 * the end of each run. A silent ETL over data this dirty would be lying.
 */

import { pool } from '../src/config/db.js'
import { readGazetteer, readDengue, readClimate } from './etl/sources.js'
import { AMBIGUOUS_NAMES, PROVINCES, STATION_PROVINCE, normKey } from './etl/normalize.js'

// --------------------------------------------------------------------------
// args
// --------------------------------------------------------------------------

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => argv.find((a) => a.startsWith(`${f}=`))?.split('=').slice(1).join('=') ?? null

const DRY_RUN = has('--dry-run')
const RESET = has('--reset')
const LAGUNA_PROXY = val('--laguna-proxy')
const ONLY = (val('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const wants = (step) => ONLY.length === 0 || ONLY.includes(step)

const CENSUS_YEARS = [2000, 2010, 2015, 2020]

const fmt = (n) => Number(n).toLocaleString('en-US')
const log = (...a) => console.log(...a)
const section = (t) => log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`)

// --------------------------------------------------------------------------

async function main() {
  const started = Date.now()
  log(`\nDengue research-data ETL${DRY_RUN ? '  [DRY RUN — no writes]' : ''}`)

  if (LAGUNA_PROXY && !Object.hasOwn(STATION_PROVINCE, LAGUNA_PROXY)) {
    throw new Error(
      `--laguna-proxy="${LAGUNA_PROXY}" is not a known station. Choose one of: ${Object.keys(STATION_PROVINCE).join(', ')}`,
    )
  }

  // ---- parse -------------------------------------------------------------

  section('1. PSA gazetteer')
  const { lgus, provinceTotals } = await readGazetteer()
  const perProvince = {}
  for (const l of lgus) perProvince[l.province] = (perProvince[l.province] ?? 0) + 1
  log(`  ${lgus.length} cities/municipalities`)
  for (const p of PROVINCES) {
    log(`    ${p.padEnd(9)} ${String(perProvince[p] ?? 0).padStart(3)} LGUs   pop 2020 ${fmt(provinceTotals[p]).padStart(10)}`)
  }

  // Only names that are unique region-wide can vote on a block's province.
  const provinceOfUniqueKey = new Map()
  const keyCounts = new Map()
  for (const l of lgus) keyCounts.set(l.key, (keyCounts.get(l.key) ?? 0) + 1)
  for (const l of lgus) {
    if (keyCounts.get(l.key) === 1 && !AMBIGUOUS_NAMES.includes(l.key)) {
      provinceOfUniqueKey.set(l.key, l.province)
    }
  }

  const lguByKey = new Map(lgus.map((l) => [`${l.key}::${l.province}`, l]))

  section('2. Dengue workbook')
  const { records: dengue, problems } = await readDengue(provinceOfUniqueKey)
  const years = [...new Set(dengue.map((r) => r.year))].sort()
  log(`  ${dengue.length} LGU-year records across ${years.join(', ')}`)

  const byProvinceYear = {}
  for (const r of dengue) {
    byProvinceYear[r.province] ??= {}
    byProvinceYear[r.province][r.year] = (byProvinceYear[r.province][r.year] ?? 0) + r.total
  }
  log(`\n  cases by province-year (province recovered from sheet block order)`)
  log(`  ${'province'.padEnd(10)}${years.map((y) => String(y).padStart(9)).join('')}`)
  for (const p of PROVINCES) {
    const row = years.map((y) => fmt(byProvinceYear[p]?.[y] ?? 0).padStart(9)).join('')
    log(`  ${p.padEnd(10)}${row}`)
  }
  log(`  ${'TOTAL'.padEnd(10)}${years.map((y) => fmt(PROVINCES.reduce((s, p) => s + (byProvinceYear[p]?.[y] ?? 0), 0)).padStart(9)).join('')}`)

  section('3. PAGASA climate')
  const { rows: climateRows, sentinels } = readClimate()
  log(`  ${climateRows.length} station-months from ${new Set(climateRows.map((r) => r.station)).size} stations`)
  if (sentinels.length) {
    log(`  ${sentinels.length} month(s) held the -999 "no observation" sentinel, now NULL:`)
    for (const s of sentinels) log(`     ${s.station} ${s.year}-${String(s.month).padStart(2, '0')}`)
  }

  // Average the stations within a province: Quezon has three, and the schema
  // is keyed (region_id, date) so they would otherwise collide.
  const climateByProvinceMonth = new Map()
  for (const r of climateRows) {
    const k = `${r.province}|${r.year}|${r.month}`
    if (!climateByProvinceMonth.has(k)) {
      climateByProvinceMonth.set(k, { province: r.province, year: r.year, month: r.month, acc: [] })
    }
    climateByProvinceMonth.get(k).acc.push(r)
  }
  const mean = (xs) => {
    const v = xs.filter((x) => x !== null && x !== undefined)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const climateByProvince = [...climateByProvinceMonth.values()].map((g) => ({
    province: g.province,
    year: g.year,
    month: g.month,
    stations: g.acc.length,
    rainfall: mean(g.acc.map((r) => r.rainfall)),
    temperature: mean(g.acc.map((r) => r.tmean)),
    humidity: mean(g.acc.map((r) => r.rh)),
  }))

  const covered = new Set(climateByProvince.map((r) => r.province))
  const uncovered = PROVINCES.filter((p) => !covered.has(p))
  if (uncovered.length) {
    log(`\n  no station: ${uncovered.join(', ')}`)
    if (LAGUNA_PROXY && uncovered.includes('LAGUNA')) {
      const src = climateByProvince.filter((r) => r.province === STATION_PROVINCE[LAGUNA_PROXY])
      for (const r of src) climateByProvince.push({ ...r, province: 'LAGUNA', proxy: LAGUNA_PROXY })
      log(`  --laguna-proxy=${LAGUNA_PROXY}: copying ${STATION_PROVINCE[LAGUNA_PROXY]} readings to Laguna (${src.length} months).`)
      log(`  This is a declared modelling assumption, not a measurement.`)
    } else if (uncovered.includes('LAGUNA')) {
      log(`  Laguna LGUs will get no climate rows. Pass --laguna-proxy=Ambulong (or Tanay)`)
      log(`  to substitute a neighbouring province's station as an explicit assumption.`)
    }
  }

  reportProblems(problems)

  if (DRY_RUN) {
    log(`\nDry run complete in ${((Date.now() - started) / 1000).toFixed(1)}s. Nothing written.`)
    return
  }

  // ---- load --------------------------------------------------------------

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    if (RESET) {
      section('Resetting research-owned tables')
      await conn.query('SET FOREIGN_KEY_CHECKS = 0')
      for (const t of ['case_data', 'climate_data', 'demographic_data']) {
        const [r] = await conn.query(`DELETE FROM ${t}`)
        log(`  cleared ${t} (${fmt(r.affectedRows)} rows)`)
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 1')
    }

    section('4. Writing to MySQL')
    const regionIdByKey = new Map()

    if (wants('regions')) {
      let inserted = 0
      let updated = 0
      for (const l of lgus) {
        const [existing] = await conn.execute(
          'SELECT id FROM regions WHERE name = :name AND province = :province',
          { name: l.name, province: l.province },
        )
        if (existing.length) {
          regionIdByKey.set(`${l.key}::${l.province}`, existing[0].id)
          updated += 1
        } else {
          const [res] = await conn.execute(
            'INSERT INTO regions (name, province, region_code) VALUES (:name, :province, :code)',
            { name: l.name, province: l.province, code: 'REG4A' },
          )
          regionIdByKey.set(`${l.key}::${l.province}`, res.insertId)
          inserted += 1
        }
      }
      log(`  regions            ${fmt(inserted)} inserted, ${fmt(updated)} already present`)
    } else {
      const [rows] = await conn.query("SELECT id, name, province FROM regions WHERE region_code = 'REG4A'")
      for (const r of rows) regionIdByKey.set(`${normKey(r.name)}::${r.province}`, r.id)
      log(`  regions            skipped (--only); resolved ${fmt(regionIdByKey.size)} existing`)
    }

    const resolve = (key, province) => regionIdByKey.get(`${key}::${province}`) ?? null

    if (wants('demographics')) {
      let n = 0
      for (const l of lgus) {
        const id = resolve(l.key, l.province)
        if (!id) continue
        for (const y of CENSUS_YEARS) {
          const pop = l.population[y]
          if (typeof pop !== 'number') continue
          await conn.execute(
            `INSERT INTO demographic_data (region_id, year, population)
             VALUES (:id, :y, :pop)
             ON DUPLICATE KEY UPDATE population = VALUES(population)`,
            { id, y, pop },
          )
          n += 1
        }
      }
      log(`  demographic_data   ${fmt(n)} rows (census ${CENSUS_YEARS.join('/')})`)
    }

    if (wants('cases')) {
      let n = 0
      const unmatched = []
      for (const r of dengue) {
        const id = resolve(r.key, r.province)
        if (!id) { unmatched.push(r); continue }
        // Annual totals, stamped at year end. These are NOT weekly counts —
        // see DATA_ASSESSMENT.md §2 for why that blocks the forecast model.
        await conn.execute(
          `INSERT INTO case_data (region_id, date, confirmed_cases, deaths)
           VALUES (:id, :date, :cases, :deaths)
           ON DUPLICATE KEY UPDATE confirmed_cases = VALUES(confirmed_cases), deaths = VALUES(deaths)`,
          { id, date: `${r.year}-12-31`, cases: r.total, deaths: r.deaths },
        )
        n += 1
      }
      log(`  case_data          ${fmt(n)} rows (annual totals at YYYY-12-31)`)
      if (unmatched.length) {
        log(`     ${unmatched.length} unmatched: ${[...new Set(unmatched.map((u) => `${u.key}/${u.province}`))].join(', ')}`)
      }
    }

    if (wants('climate')) {
      const lguByProvince = {}
      for (const l of lgus) (lguByProvince[l.province] ??= []).push(l)

      let n = 0
      for (const c of climateByProvince) {
        for (const l of lguByProvince[c.province] ?? []) {
          const id = resolve(l.key, l.province)
          if (!id) continue
          await conn.execute(
            `INSERT INTO climate_data (region_id, date, temperature, rainfall, humidity)
             VALUES (:id, :date, :t, :r, :h)
             ON DUPLICATE KEY UPDATE temperature = VALUES(temperature),
                                     rainfall = VALUES(rainfall),
                                     humidity = VALUES(humidity)`,
            {
              id,
              date: `${c.year}-${String(c.month).padStart(2, '0')}-01`,
              t: c.temperature === null ? null : Number(c.temperature.toFixed(2)),
              r: c.rainfall === null ? null : Number(c.rainfall.toFixed(2)),
              h: c.humidity === null ? null : Number(c.humidity.toFixed(2)),
            },
          )
          n += 1
        }
      }
      log(`  climate_data       ${fmt(n)} rows (provincial monthly means, replicated to each LGU)`)
      log(`                     enso_index left NULL — not in the research set (NOAA ONI is open)`)
    }

    await conn.commit()
    log(`\nCommitted in ${((Date.now() - started) / 1000).toFixed(1)}s.`)
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

// --------------------------------------------------------------------------

function reportProblems(p) {
  section('Data defects repaired or flagged')

  if (p.impureBlocks.length) {
    log(`  !! ${p.impureBlocks.length} province block(s) below 100% purity — check the sheet layout:`)
    for (const b of p.impureBlocks) log(`     ${b.year} block ${b.block}: ${(b.purity * 100).toFixed(0)}% ${b.province}`, b.votes)
  } else {
    log('  province recovery   every block resolved at 100% purity')
  }
  if (p.unresolvedBlocks.length) {
    log(`  !! ${p.unresolvedBlocks.length} block(s) with no recognisable member:`, p.unresolvedBlocks)
  }

  if (p.blankTotals.length) {
    const byYear = {}
    for (const b of p.blankTotals) (byYear[b.year] ??= []).push(b.name)
    log(`\n  blank TOTAL cells   ${p.blankTotals.length} row(s) present but empty — dropped, NOT read as zero:`)
    for (const [y, names] of Object.entries(byYear)) {
      log(`     ${y}: ${names.join(', ')}`)
    }
    log(`     Consequence: that province-year is an undercount. A zero here would`)
    log(`     teach the model a case crash that never happened.`)
  }

  if (p.exactDuplicates.length) {
    log(`\n  exact duplicate rows  ${p.exactDuplicates.length} collapsed (same town, same value, written twice):`)
    for (const d of p.exactDuplicates) log(`     ${d.year} ${d.province} ${d.key} = ${d.value}  ${JSON.stringify(d.labels)}`)
  }

  if (p.conflictingDuplicates.length) {
    log(`\n  !! conflicting duplicates  ${p.conflictingDuplicates.length} — same town, DIFFERENT values, summed:`)
    for (const d of p.conflictingDuplicates) {
      log(`     ${d.year} ${d.province} ${d.key}: ${d.values.join(' + ')} = ${d.values.reduce((a, b) => a + b, 0)}  ${JSON.stringify(d.labels)}`)
    }
    log(`     Not resolvable from the workbook. Verify against the source PDF.`)
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\nETL failed:', err.message)
    console.error(err.stack)
    await pool.end()
    process.exitCode = 1
  })
