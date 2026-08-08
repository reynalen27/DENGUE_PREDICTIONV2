#!/usr/bin/env node
/*
 * ETL: RESEARCH DATA SET/REVISED DATA SET -> MySQL
 * ---------------------------------------------------------------------------
 * Loads the study panel: 17 administrative regions x 60 months (2016-01 to
 * 2020-12), with every predictor the objective names.
 *
 *   npm run etl:revised                  # load, upsert (idempotent)
 *   npm run etl:revised -- --dry-run     # parse and report, write nothing
 *   npm run etl:revised -- --reset       # clear this ETL's rows first
 *   npm run etl:revised -- --include-legacy-rates   # refused by default
 *
 * Scope: it writes ONLY admin_level='region' rows and their data. The 142
 * CALABARZON municipalities loaded by import-research-data.js are untouched,
 * and so are model_runs / predictions / evaluation_metrics, which belong to
 * the model service.
 *
 * The 2008-2016 rate file is excluded. See markdown/REVISION_PLAN.md section
 * 2a — it carries a period-3 quarterly artefact that is not epidemiology, and
 * the guard below re-derives that evidence at run time rather than trusting a
 * comment.
 */

import { pool } from '../src/config/db.js'
import { REGIONS, REGION_SLUGS } from './etl/regions-ph.js'
import {
  readMonthlyCases, readClimate, readGeography, readPsgcCodes,
  readPoverty, readUrban, readLegacyRates, quarterlyArtefactEvidence,
} from './etl/revised-sources.js'

// --------------------------------------------------------------------------

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => argv.find((a) => a.startsWith(`${f}=`))?.split('=').slice(1).join('=') ?? null

const DRY_RUN = has('--dry-run')
const RESET = has('--reset')
const INCLUDE_LEGACY = has('--include-legacy-rates')
const ONLY = (val('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const wants = (step) => ONLY.length === 0 || ONLY.includes(step)

const FROM_YEAR = 2016
const TO_YEAR = 2020
const CENSUS = { 2010: 'pop2010', 2015: 'pop2015', 2020: 'pop2020' }
const PSA_NATIONAL_2020 = 109_033_245

const fmt = (n) => Number(n).toLocaleString('en-US')
const log = (...a) => console.log(...a)
const section = (t) => log(`\n${'─'.repeat(74)}\n${t}\n${'─'.repeat(74)}`)

// --------------------------------------------------------------------------

async function main() {
  const started = Date.now()
  log(`\nRevised-dataset ETL — 17 regions x monthly${DRY_RUN ? '   [DRY RUN — no writes]' : ''}`)

  // ---- 0. the excluded file ----------------------------------------------
  section('0. Excluded source: Dengue Cases Per 100k, 2008-2016')
  const legacy = readLegacyRates()
  const ev = quarterlyArtefactEvidence(legacy.rows)
  log(`  ${legacy.file}: ${fmt(legacy.rows.length)} region-months parsed`)
  log(`  period-3 check: ${ev.risingQuarters}/${ev.totalQuarters} quarters rise m1<=m2<=m3`
    + ` = ${ev.pct.toFixed(1)}%  (16.7% expected by chance)`)
  log(`  peak month ${ev.peakMonth}, trough month ${ev.troughMonth}`
    + `  — real PH dengue peaks in Aug/Sep`)
  if (INCLUDE_LEGACY) {
    log(`  !! --include-legacy-rates given. This file is still NOT loaded: its`)
    log(`     values are rates per 100k, not counts, and the artefact above`)
    log(`     would dominate any seasonality the model learns. Remove the flag.`)
  } else {
    log(`  -> excluded (default). Pass --include-legacy-rates to see this again.`)
  }

  // ---- 1. geography -------------------------------------------------------
  section('1. Geography — PSA population and land area')
  const { geo, skippedLookalikes, file: geoFile } = await readGeography()
  log(`  ${geoFile}`)
  log(`  resolved ${geo.size}/17 regions`)
  for (const s of skippedLookalikes) {
    log(`  skipped look-alike: "${s.label}" would match ${s.slug}`
      + ` but has ${fmt(s.pop2020)} people / ${s.area} km2 — a municipality, not a region`)
  }
  const missingGeo = REGION_SLUGS.filter((s) => !geo.has(s))
  if (missingGeo.length) throw new Error(`Geography missing for: ${missingGeo.join(', ')}`)

  const sum2020 = [...geo.values()].reduce((s, g) => s + g.pop2020, 0)
  const reconciles = sum2020 === PSA_NATIONAL_2020
  log(`  sum of 2020 populations = ${fmt(sum2020)}`)
  log(`  PSA national total      = ${fmt(PSA_NATIONAL_2020)}   ${reconciles ? 'RECONCILES' : '!! MISMATCH'}`)
  if (!reconciles) {
    throw new Error('Regional populations do not sum to the PSA national total — '
      + 'the region rows were mis-identified. Refusing to load.')
  }

  const psgc = await readPsgcCodes()
  log(`  PSGC codes read for ${psgc.size}/17 regions`)

  const { poverty, national, file: povFile } = await readPoverty()
  log(`
  ${povFile.slice(0, 52)}`)
  log(`  poverty incidence (families) for ${poverty.size}/17 regions, years 2015 and 2018`)
  if (national) {
    log(`  national anchor: ${national[2015]?.toFixed(1)}% (2015) -> ${national[2018]?.toFixed(1)}% (2018)`)
  }
  const povMissing = REGION_SLUGS.filter((s2) => !poverty.has(s2))
  if (povMissing.length) log(`  !! no poverty figure for: ${povMissing.join(', ')}`)

  const { urban, file: urbFile } = await readUrban()
  log(`  ${urbFile.slice(0, 52)}`)
  log(`  urban share for ${urban.size}/17 regions, years 2015 and 2020`)
  const urbMissing = REGION_SLUGS.filter((s2) => !urban.has(s2))
  if (urbMissing.length) log(`  !! no urban figure for: ${urbMissing.join(', ')}`)

  // ---- 2. cases -----------------------------------------------------------
  section('2. Target — monthly dengue cases and deaths')
  const { rows: caseRows, problems: caseProblems, file: caseFile } = readMonthlyCases()
  const inWindow = caseRows.filter((r) => r.year >= FROM_YEAR && r.year <= TO_YEAR)
  log(`  ${caseFile}: ${fmt(caseRows.length)} rows, ${fmt(inWindow.length)} inside ${FROM_YEAR}-${TO_YEAR}`)
  for (const [k, v] of Object.entries(caseProblems)) {
    if (v.length) log(`  !! ${k}: ${v.length} — ${[...new Set(v)].slice(0, 6).join(', ')}`)
  }

  const byYear = {}
  for (const r of inWindow) {
    byYear[r.year] ??= { cases: 0, deaths: 0, n: 0 }
    byYear[r.year].cases += r.cases
    byYear[r.year].deaths += r.deaths
    byYear[r.year].n += 1
  }
  log(`\n  ${'year'.padEnd(6)}${'region-months'.padStart(14)}${'cases'.padStart(12)}${'deaths'.padStart(10)}`)
  for (const y of Object.keys(byYear).sort()) {
    const b = byYear[y]
    log(`  ${y.padEnd(6)}${String(b.n).padStart(14)}${fmt(b.cases).padStart(12)}${fmt(b.deaths).padStart(10)}`)
  }

  // 2020 is in the data but must not be used for headline evaluation.
  const y2019 = byYear[2019]?.cases ?? 0
  const y2020 = byYear[2020]?.cases ?? 0
  if (y2019 && y2020) {
    log(`\n  2020 is ${((y2020 / y2019) * 100).toFixed(0)}% of 2019 — the COVID surveillance`)
    log(`  break. Loaded, but excluded from headline evaluation (train 2016-2018,`)
    log(`  test 2019). See markdown/REVISION_PLAN.md section 2b.`)
  }

  // ---- 3. climate ---------------------------------------------------------
  section('3. Predictors — ERA5 monthly climate')
  const { climate, stats, hotDaysZeroed, unresolved } = await readClimate(FROM_YEAR, TO_YEAR)
  for (const [k, s] of Object.entries(stats)) {
    log(`  ${k.padEnd(13)} ${fmt(s.filled).padStart(7)} values`
      + (s.blank ? `, ${fmt(s.blank)} blank` : '')
      + `   ${s.file.slice(0, 44)}`)
  }
  if (unresolved.length) log(`  !! unresolved region labels: ${unresolved.join(', ')}`)
  log(`  hot_days: ${fmt(hotDaysZeroed)} blank month-cells written as 0`)
  log(`            (ERA5 leaves a month blank when no day exceeded 35C; in this`)
  log(`             climate that is far likelier than "not measured")`)
  log(`  climate region-months in window: ${fmt(climate.size)}`)

  // ---- 4. the panel -------------------------------------------------------
  section('4. Joined panel')
  const panel = []
  const gaps = []
  for (const slug of REGION_SLUGS) {
    for (let y = FROM_YEAR; y <= TO_YEAR; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const c = inWindow.find((r) => r.slug === slug && r.year === y && r.month === m)
        const k = climate.get(`${slug}|${y}|${m}`)
        if (!c || !k) { gaps.push({ slug, y, m, cases: !!c, climate: !!k }); continue }
        panel.push({ slug, year: y, month: m, ...c, ...k })
      }
    }
  }
  const expected = REGION_SLUGS.length * (TO_YEAR - FROM_YEAR + 1) * 12
  log(`  rows      ${fmt(panel.length)} / ${fmt(expected)} expected  (17 regions x 60 months)`)
  log(`  complete  ${panel.length === expected ? 'YES — zero gaps' : `NO — ${gaps.length} gaps`}`)
  if (gaps.length) {
    for (const g of gaps.slice(0, 10)) {
      log(`    ${g.slug} ${g.y}-${String(g.m).padStart(2, '0')}  cases=${g.cases} climate=${g.climate}`)
    }
  }

  if (DRY_RUN) {
    log(`\nDry run complete in ${((Date.now() - started) / 1000).toFixed(1)}s. Nothing written.`)
    return
  }

  // ---- 5. write -----------------------------------------------------------
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    if (RESET) {
      section('Resetting this ETL\'s rows')
      const [r] = await conn.query(
        `DELETE cd FROM case_data cd JOIN regions r ON r.id = cd.region_id
         WHERE r.admin_level = 'region' AND cd.period_type = 'month'`)
      log(`  cleared ${fmt(r.affectedRows)} monthly case rows`)
      const [c] = await conn.query(
        `DELETE cl FROM climate_data cl JOIN regions r ON r.id = cl.region_id
         WHERE r.admin_level = 'region'`)
      log(`  cleared ${fmt(c.affectedRows)} climate rows`)
      const [d] = await conn.query(
        `DELETE dd FROM demographic_data dd JOIN regions r ON r.id = dd.region_id
         WHERE r.admin_level = 'region'`)
      log(`  cleared ${fmt(d.affectedRows)} demographic rows`)
    }

    section('5. Writing to MySQL')

    // regions — upsert on slug, the unique key migration 002 added
    const idBySlug = new Map()
    let inserted = 0
    let updated = 0
    for (const { slug, name } of REGIONS) {
      const g = geo.get(slug)
      await conn.execute(
        `INSERT INTO regions (slug, admin_level, name, region_code, psgc_code, land_area_km2)
         VALUES (:slug, 'region', :name, :slug, :psgc, :area)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), psgc_code = VALUES(psgc_code),
           land_area_km2 = VALUES(land_area_km2)`,
        { slug, name, psgc: psgc.get(slug) ?? null, area: g.areaKm2 },
      )
      const [[row]] = await conn.query('SELECT id FROM regions WHERE slug = ?', [slug])
      idBySlug.set(slug, row.id)
    }
    const [[regionCount]] = await conn.query(
      "SELECT COUNT(*) n FROM regions WHERE admin_level = 'region'")
    log(`  regions            ${regionCount.n} region rows (upserted on slug)`)

    if (wants('cases')) {
      let n = 0
      for (const r of inWindow) {
        const date = `${r.year}-${String(r.month).padStart(2, '0')}-01`
        await conn.execute(
          `INSERT INTO case_data (region_id, date, period_type, confirmed_cases, deaths)
           VALUES (:id, :date, 'month', :cases, :deaths)
           ON DUPLICATE KEY UPDATE
             confirmed_cases = VALUES(confirmed_cases), deaths = VALUES(deaths)`,
          { id: idBySlug.get(r.slug), date, cases: r.cases, deaths: r.deaths },
        )
        n += 1
      }
      log(`  case_data          ${fmt(n)} monthly rows (period_type='month')`)
    }

    if (wants('climate')) {
      let n = 0
      for (const rec of climate.values()) {
        const date = `${rec.year}-${String(rec.month).padStart(2, '0')}-01`
        await conn.execute(
          `INSERT INTO climate_data (region_id, date, temperature, rainfall, humidity, hot_days)
           VALUES (:id, :date, :t, :r, :h, :hd)
           ON DUPLICATE KEY UPDATE
             temperature = VALUES(temperature), rainfall = VALUES(rainfall),
             humidity = VALUES(humidity), hot_days = VALUES(hot_days)`,
          {
            id: idBySlug.get(rec.slug),
            date,
            t: rec.temperature ?? null,
            r: rec.rainfall ?? null,
            h: rec.humidity ?? null,
            hd: rec.hot_days ?? null,
          },
        )
        n += 1
      }
      log(`  climate_data       ${fmt(n)} monthly rows (temperature, rainfall, humidity, hot_days)`)
    }

    if (wants('demographics')) {
      /*
       * Three covariates, three different time coverages, none of them annual:
       *
       *   population   census 2010 / 2015 / 2020  -> interpolate 2016-2019
       *   poverty      2015 / 2018 only           -> interpolate 2016-2017,
       *                                              carry 2018 forward to 2019-2020
       *   urban share  2015 / 2020 only           -> interpolate 2016-2019
       *
       * Every derived value records how it was derived in `source`, so a
       * reader can never mistake an interpolation for an observation. Carrying
       * poverty forward past 2018 is the weakest assumption here and is named
       * as such ('carried') rather than blended into 'interpolated'.
       */
      const lerp = (y, y0, v0, y1, v1) => v0 + ((v1 - v0) * (y - y0)) / (y1 - y0)

      let n = 0
      let carried = 0
      for (const slug of REGION_SLUGS) {
        const g = geo.get(slug)
        const id = idBySlug.get(slug)
        const pov = poverty.get(slug)
        const urb = urban.get(slug)

        const povertyFor = (year) => {
          if (!pov || pov[2015] === null || pov[2018] === null) return [null, null]
          if (year === 2015) return [pov[2015], 'census']
          if (year === 2018) return [pov[2018], 'census']
          if (year > 2018) { carried += 1; return [pov[2018], 'carried'] }
          if (year > 2015) return [lerp(year, 2015, pov[2015], 2018, pov[2018]), 'interpolated']
          return [null, null]
        }

        const urbanFor = (year) => {
          if (!urb || urb[2015] === null || urb[2020] === null) return null
          if (year <= 2015) return urb[2015]
          if (year >= 2020) return urb[2020]
          return lerp(year, 2015, urb[2015], 2020, urb[2020])
        }

        const write = async (year, population, popSource) => {
          const [povRate, povSource] = povertyFor(year)
          const urbPct = urbanFor(year)
          // The row's `source` describes the weakest derivation it contains,
          // because that is what limits how the row may be read.
          const src = [popSource, povSource === 'carried' ? 'poverty:carried' : null]
            .filter(Boolean).join('+')
          await conn.execute(
            `INSERT INTO demographic_data
               (region_id, year, population, population_density, urban_pct, poverty_rate, source)
             VALUES (:id, :year, :pop, :dens, :urban, :pov, :source)
             ON DUPLICATE KEY UPDATE
               population = VALUES(population),
               population_density = VALUES(population_density),
               urban_pct = VALUES(urban_pct),
               poverty_rate = VALUES(poverty_rate),
               source = VALUES(source)`,
            {
              id,
              year,
              pop: Math.round(population),
              dens: Number((population / g.areaKm2).toFixed(2)),
              urban: urbPct === null ? null : Number(urbPct.toFixed(2)),
              pov: povRate === null ? null : Number(povRate.toFixed(2)),
              source: src,
            },
          )
          n += 1
        }

        for (const [year, key] of Object.entries(CENSUS)) {
          if (g[key] !== null) await write(Number(year), g[key], 'census')
        }
        const step = (g.pop2020 - g.pop2015) / 5
        for (let y = 2016; y <= 2019; y += 1) {
          await write(y, g.pop2015 + step * (y - 2015), 'interpolated')
        }
      }
      log(`  demographic_data   ${fmt(n)} rows (2010/2015/2020 census + 2016-2019 interpolated)`)
      log(`                     population_density = population / land_area_km2`)
      log(`                     poverty_rate = PSA incidence among FAMILIES;`)
      log(`                     2016-2017 interpolated from 2015/2018, ${carried} rows`)
      log(`                     carried forward past 2018 (marked in \`source\`)`)
      log(`                     urban_pct interpolated between the 2015 and 2020 censuses`)
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

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\nETL failed:', err.message)
    console.error(err.stack)
    await pool.end()
    process.exitCode = 1
  })
