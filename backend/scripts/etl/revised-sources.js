import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { canonRegion, monthNumber } from './regions-ph.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REVISED_ROOT = path.join(
  HERE, '..', '..', '..', 'RESEARCH DATA SET', 'REVISED DATA SET',
)

/** Find the one file in a folder matching a prefix — the names carry long, brittle suffixes. */
function findFile(folderPrefix, ext = '.xlsx') {
  const dir = fs.readdirSync(REVISED_ROOT).find((d) => d.startsWith(folderPrefix))
  if (!dir) throw new Error(`No folder in REVISED DATA SET starting with "${folderPrefix}"`)
  const full = path.join(REVISED_ROOT, dir)
  const file = fs.readdirSync(full).find((f) => f.endsWith(ext))
  if (!file) throw new Error(`No ${ext} inside "${dir}"`)
  return path.join(full, file)
}

/* ExcelJS returns primitives, {formula,result} and {richText:[…]}. The PSA
   province subtotals are SUM() formulas and "QUEZON *" is rich text, so all
   three shapes have to be unwrapped or rows vanish silently. */
function cellValue(row, i) {
  const v = row.getCell(i).value
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return v
  if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('')
  if (v.result !== undefined) return v.result
  if (v.text !== undefined) return v.text
  return null
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/* ------------------------------------------------------------------------ *
 * 1. Monthly dengue cases and deaths, 2016-2020 — the modelling target
 * ------------------------------------------------------------------------ */

export function readMonthlyCases() {
  const file = findFile('Recorded Dengue Cases', '.csv')
  // utf-8 BOM: the header's first cell reads "﻿Month" without stripping it.
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim()
  const [header, ...lines] = text.split(/\r?\n/)
  const cols = header.split(',').map((h) => h.trim())

  const rows = []
  const problems = { unresolvedRegion: [], badMonth: [], nonNumeric: [] }

  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split(',')
    const rec = Object.fromEntries(cols.map((c, i) => [c, (parts[i] ?? '').trim()]))

    const slug = canonRegion(rec.Region)
    const month = monthNumber(rec.Month)
    const year = Number(rec.Year)
    const cases = Number(rec.Dengue_Cases)
    const deaths = Number(rec.Dengue_Deaths)

    if (!slug) { problems.unresolvedRegion.push(rec.Region); continue }
    if (!month) { problems.badMonth.push(rec.Month); continue }
    if (!Number.isFinite(cases)) { problems.nonNumeric.push(`${rec.Region} ${rec.Year}-${rec.Month}`); continue }

    rows.push({
      slug, year, month, cases,
      deaths: Number.isFinite(deaths) ? deaths : 0,
    })
  }

  return { rows, problems, file: path.basename(file) }
}

/* ------------------------------------------------------------------------ *
 * 2. ERA5 climate — four wide workbooks, 17 rows x 912 monthly columns
 * ------------------------------------------------------------------------ */

const ERA5 = [
  { key: 'temperature', folder: 'Mean Air Temperature', unit: 'C' },
  { key: 'rainfall', folder: 'Mean Precipitation', unit: 'mm' },
  { key: 'humidity', folder: 'Mean Relative Humidity', unit: '%' },
  { key: 'hot_days', folder: 'Number of Hot Days', unit: 'days' },
]

/**
 * Returns a Map of `${slug}|${year}|${month}` -> { temperature, rainfall, … }
 * restricted to [fromYear, toYear].
 *
 * hot_days is blank for ~73% of month-cells. In a tropical climate the
 * overwhelmingly likely reading is "no days above 35 C" rather than "not
 * measured", so blanks become 0 — but the count is reported so the assumption
 * is visible rather than buried.
 */
export async function readClimate(fromYear, toYear) {
  const out = new Map()
  const stats = {}
  const unresolved = new Set()

  for (const { key, folder } of ERA5) {
    const file = findFile(folder)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const ws = wb.worksheets[0]

    const header = ws.getRow(1)
    const periods = []
    for (let c = 3; c <= ws.columnCount; c += 1) {
      const p = cellValue(header, c)
      if (!p) continue
      const s = String(p)
      const m = /^(\d{4})-(\d{2})$/.exec(s)
      if (m) periods.push({ col: c, year: Number(m[1]), month: Number(m[2]) })
    }

    let filled = 0
    let blank = 0
    for (let r = 2; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r)
      const slug = canonRegion(cellValue(row, 2))
      if (!slug) {
        const raw = cellValue(row, 2)
        if (raw) unresolved.add(String(raw))
        continue
      }
      for (const { col, year, month } of periods) {
        if (year < fromYear || year > toYear) continue
        const k = `${slug}|${year}|${month}`
        if (!out.has(k)) out.set(k, { slug, year, month })
        const v = num(cellValue(row, col))
        if (v === null) blank += 1
        else filled += 1
        out.get(k)[key] = v
      }
    }
    stats[key] = { filled, blank, file: path.basename(file) }
  }

  // Blank hot_days means zero days over 35 C, not a missing observation.
  let hotDaysZeroed = 0
  for (const rec of out.values()) {
    if (rec.hot_days === null || rec.hot_days === undefined) {
      rec.hot_days = 0
      hotDaysZeroed += 1
    }
  }

  return { climate: out, stats, hotDaysZeroed, unresolved: [...unresolved] }
}

/* ------------------------------------------------------------------------ *
 * 3. PSA population + land area — the only source of a denominator and of area
 * ------------------------------------------------------------------------ */

/**
 * Table A mixes regions, provinces and municipalities in one hierarchy with no
 * level column. Two traps, both verified against PSA's own national total:
 *
 *  - BARMM's label wraps across two spreadsheet rows ("Bangsamoro Autonomous
 *    Region" / "in Muslim Mindanao (BARMM) 3"), so the row that carries its
 *    numbers has a fragment for a name.
 *  - There is a MUNICIPALITY called Caraga in Davao Oriental, which a
 *    region-name match happily mistakes for Region XIII.
 *
 * Guarding on population > 1,000,000 AND area > 500 km² separates the region
 * rows from both. The loader asserts the result sums to 109,033,245.
 */
export async function readGeography() {
  const file = findFile('Population Density')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet('Table A')

  const found = new Map()
  const skippedLookalikes = []
  let prevLabel = ''

  for (let r = 8; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r)
    const raw = cellValue(row, 1)
    if (!raw || !String(raw).trim()) { prevLabel = ''; continue }

    let label = String(raw).replace(/�/g, 'n').trim()
    if (/^in Muslim Mindanao/i.test(label) && prevLabel) label = `${prevLabel} ${label}`
    prevLabel = label

    const p2010 = num(cellValue(row, 2))
    const p2015 = num(cellValue(row, 4))
    const p2020 = num(cellValue(row, 6))
    const area = num(cellValue(row, 8))
    if (p2015 === null || p2020 === null || area === null) continue

    const slug = canonRegion(label)
    if (!slug) continue

    if (p2020 < 1_000_000 || area < 500) {
      // e.g. the municipality of Caraga, Davao Oriental (39,704 people, 643 km²)
      skippedLookalikes.push({ label, slug, pop2020: p2020, area })
      continue
    }
    if (found.has(slug)) continue

    found.set(slug, { slug, label, pop2010: p2010, pop2015: p2015, pop2020: p2020, areaKm2: area })
  }

  return { geo: found, skippedLookalikes, file: path.basename(file) }
}

/* ------------------------------------------------------------------------ *
 * 4. PSGC codes — read, not guessed
 * ------------------------------------------------------------------------ */

/** The 2022-2025 population workbook's ADM1 sheets carry ADM1_PCODE. */
export async function readPsgcCodes() {
  const file = findFile('Population 2022-2025')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets.find((w) => /adm1/i.test(w.name))
  if (!ws) return new Map()

  const header = ws.getRow(1)
  let nameCol = null
  let codeCol = null
  for (let c = 1; c <= ws.columnCount; c += 1) {
    const h = String(cellValue(header, c) ?? '').toUpperCase()
    if (h === 'ADM1_NAME') nameCol = c
    if (h === 'ADM1_PCODE') codeCol = c
  }
  if (!nameCol || !codeCol) return new Map()

  const codes = new Map()
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r)
    const slug = canonRegion(cellValue(row, nameCol))
    const code = cellValue(row, codeCol)
    if (slug && code && !codes.has(slug)) codes.set(slug, String(code).trim())
  }
  return codes
}

/* ------------------------------------------------------------------------ *
 * 4b. Socioeconomic covariates — poverty incidence and urban share
 * ------------------------------------------------------------------------ */

/**
 * PSA poverty incidence, sheet "By Region".
 *
 * Layout: 1 Region · 2 PSGC · 3-4 annual per-capita threshold (2015, 2018)
 *         5-6 POVERTY INCIDENCE AMONG FAMILIES (2015, 2018) · 7-8 CV
 *
 * Two things the column name `poverty_rate` hides, so they are recorded here:
 * the figure is incidence among FAMILIES, not individuals, and it exists for
 * two years only against a 2016-2020 case window. The loader interpolates and
 * marks every derived row in `demographic_data.source`.
 *
 * Sanity anchor: the PHILIPPINES row reads 18.0% (2015) and 12.1% (2018),
 * which are PSA's published national figures.
 */
export async function readPoverty() {
  const file = findFile('Poverty Threshold Incidence')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet('By Region')
  if (!ws) throw new Error('Poverty workbook has no "By Region" sheet')

  const out = new Map()
  let national = null

  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r)
    const label = cellValue(row, 1)
    if (!label) continue

    const i2015 = num(cellValue(row, 5))
    const i2018 = num(cellValue(row, 6))
    if (i2015 === null && i2018 === null) continue

    if (/^philippines/i.test(String(label).trim())) {
      national = { 2015: i2015, 2018: i2018 }
      continue
    }
    const slug = canonRegion(label)
    if (!slug || out.has(slug)) continue
    out.set(slug, { 2015: i2015, 2018: i2018 })
  }

  return { poverty: out, national, file: path.basename(file) }
}

/**
 * PSA urban population, "Table A".
 *
 * Layout: 1 name · 2 total 2020 · 3 total 2015 · 5 urban 2020 · 6 urban 2015
 *         8 percent urban 2020
 *
 * The 2015 share is computed rather than read — the sheet only prints the
 * percentage for 2020.
 */
export async function readUrban() {
  const file = findFile('Urban Population')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet('Table A')
  if (!ws) throw new Error('Urban workbook has no "Table A" sheet')

  const out = new Map()
  for (let r = 6; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r)
    const label = cellValue(row, 1)
    if (!label) continue
    if (/^philippines/i.test(String(label).trim())) continue

    const total2020 = num(cellValue(row, 2))
    const total2015 = num(cellValue(row, 3))
    const urban2020 = num(cellValue(row, 5))
    const urban2015 = num(cellValue(row, 6))
    if (total2020 === null || urban2020 === null) continue

    // Same guard as readGeography: only region rows clear a million people.
    if (total2020 < 1_000_000) continue

    const slug = canonRegion(label)
    if (!slug || out.has(slug)) continue

    out.set(slug, {
      2015: total2015 ? (urban2015 / total2015) * 100 : null,
      2020: (urban2020 / total2020) * 100,
    })
  }

  return { urban: out, file: path.basename(file) }
}

/* ------------------------------------------------------------------------ *
 * 5. The excluded 2008-2016 rate file — recognised only so it can be refused
 * ------------------------------------------------------------------------ */

export function readLegacyRates() {
  const file = findFile('Dengue Cases Per 100k', '.csv')
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim()
  const [header, ...lines] = text.split(/\r?\n/)
  const cols = header.split(',').map((h) => h.trim())

  const rows = []
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split(',')
    const rec = Object.fromEntries(cols.map((c, i) => [c, (parts[i] ?? '').trim()]))
    const slug = canonRegion(rec.Region)
    const month = monthNumber(rec.Month)
    const rate = Number(rec.Dengue_Cases)
    if (slug && month && Number.isFinite(rate)) {
      rows.push({ slug, year: Number(rec.Year), month, rate })
    }
  }
  return { rows, file: path.basename(file) }
}

/**
 * Re-derives the period-3 evidence at run time rather than trusting a comment.
 * If the file is ever replaced with a corrected version, this stops firing and
 * the guard can be lifted on evidence instead of on faith.
 */
export function quarterlyArtefactEvidence(rows) {
  const byKey = new Map(rows.map((r) => [`${r.slug}|${r.year}|${r.month}`, r.rate]))
  let rising = 0
  let total = 0
  for (const { slug, year } of rows) {
    for (let q = 0; q < 4; q += 1) {
      const a = byKey.get(`${slug}|${year}|${q * 3 + 1}`)
      const b = byKey.get(`${slug}|${year}|${q * 3 + 2}`)
      const c = byKey.get(`${slug}|${year}|${q * 3 + 3}`)
      if ([a, b, c].some((v) => v === undefined)) continue
      total += 1
      if (a <= b && b <= c) rising += 1
    }
  }
  const monthly = {}
  for (let m = 1; m <= 12; m += 1) {
    const vs = rows.filter((r) => r.month === m).map((r) => r.rate)
    monthly[m] = vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : null
  }
  // total counts each quarter once per row, so divide back out
  const quarters = total / 12
  return {
    risingQuarters: Math.round(rising / 12),
    totalQuarters: Math.round(quarters),
    pct: total ? (rising / total) * 100 : 0,
    monthlyMeans: monthly,
    peakMonth: Object.entries(monthly).sort((a, b) => b[1] - a[1])[0]?.[0],
    troughMonth: Object.entries(monthly).sort((a, b) => a[1] - b[1])[0]?.[0],
  }
}
