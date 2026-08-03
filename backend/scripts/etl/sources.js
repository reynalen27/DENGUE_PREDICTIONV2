import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import {
  AMBIGUOUS_NAMES, PROVINCES, STATION_PROVINCE, cleanMeasurement, displayName, normKey,
} from './normalize.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DATA_ROOT = path.join(HERE, '..', '..', '..', 'RESEARCH DATA SET')

/*
 * ExcelJS hands back three shapes for a populated cell: a primitive, a formula
 * object ({ formula, result }) — the PSA province subtotals are SUM() formulas
 * — or a rich-text object ({ richText: [...] }), which is how `QUEZON *` is
 * stored. String()-ing the last one yields "[object Object]" and silently
 * loses the province header, so all three are unwrapped here.
 */
const cell = (row, i) => {
  const v = row.getCell(i).value
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return v
  if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('')
  if (v.result !== undefined) return v.result
  if (v.text !== undefined) return v.text
  return null
}

/* ------------------------------------------------------------------------- *
 * PSA gazetteer — the authoritative list of the 142 CALABARZON LGUs.
 * ------------------------------------------------------------------------- */

/**
 * Province header rows are distinguished from the municipalities that share
 * their names (Rizal in Laguna, pop 18,332; Quezon in Quezon, pop 15,886) by
 * population: only the real province rows clear a million.
 *
 * The `QUEZON *` header excludes Lucena City, which PSA reports separately as
 * a highly urbanised city — the five province rows sum to 15,916,118 against a
 * regional 16,195,042, and the 278,924 difference is exactly Lucena.
 */
export async function readGazetteer() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(DATA_ROOT, 'Population Per Municipality', 'Population Per Municipality.xlsx'))
  const ws = wb.getWorksheet('R04A')

  const lgus = []
  const provinceTotals = {}
  let current = null

  ws.eachRow((row, n) => {
    if (n < 7) return
    const raw = cell(row, 1)
    if (!raw || !String(raw).trim()) return

    const label = String(raw).trim()
    const bare = label.toUpperCase().replace(/\*/g, '').trim()
    if (bare.startsWith('REGION') || bare.includes('STATISTICS AUTHORITY')) return

    const pop2020 = cell(row, 6)
    if (PROVINCES.includes(bare) && typeof pop2020 === 'number' && pop2020 > 1_000_000) {
      current = bare
      provinceTotals[bare] = pop2020
      return
    }
    if (typeof pop2020 !== 'number') return

    lgus.push({
      raw: label,
      name: displayName(label),
      key: normKey(label),
      province: current,
      population: {
        2000: cell(row, 3), 2010: cell(row, 4), 2015: cell(row, 5), 2020: pop2020,
      },
    })
  })

  return { lgus, provinceTotals }
}

/* ------------------------------------------------------------------------- *
 * Dengue workbook — annual totals per LGU, 2020..2024.
 * ------------------------------------------------------------------------- */

/**
 * Recovers the province column that was lost when the DOH PDFs were
 * transcribed into the workbook.
 *
 * The PDFs are laid out one table per province, and the flattening preserved
 * that order: each sheet is five blocks of municipalities separated by blank
 * rows. Assigning each block the province that the majority of its
 * *unambiguously named* members belong to resolves every block at 100% purity
 * on all five sheets, and the block sizes match the PSA counts exactly
 * (Cavite 23, Laguna 30, Batangas 34, Rizal 14, Quezon 38-42).
 *
 * That is what disambiguates Rosario: one block-1 (Cavite) row, one block-3
 * (Batangas) row, every year.
 */
function assignProvinceByBlock(blocks, provinceOfUniqueKey, problems, year) {
  return blocks.map((block, i) => {
    const votes = new Map()
    for (const row of block) {
      const p = provinceOfUniqueKey.get(row.key)
      if (p) votes.set(p, (votes.get(p) ?? 0) + 1)
    }
    if (votes.size === 0) {
      problems.unresolvedBlocks.push({ year, block: i + 1, size: block.length })
      return { province: null, rows: block }
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1])
    const [province, top] = ranked[0]
    const total = ranked.reduce((s, [, n]) => s + n, 0)
    if (top < total) {
      problems.impureBlocks.push({ year, block: i + 1, province, purity: top / total, votes: Object.fromEntries(ranked) })
    }
    return { province, rows: block }
  })
}

/**
 * Returns one record per (key, province, year) plus a `problems` report.
 * Nothing is silently dropped or silently merged — every defect is surfaced.
 *
 * Sheet layout: row 1 title, rows 2-3 the split header, data from row 4.
 * Columns: A name | B-D female alive/died/cases | E-G male | H total.
 *
 * @param provinceOfUniqueKey Map of normKey -> province, containing only keys
 *   that are unique region-wide (i.e. excluding AMBIGUOUS_NAMES).
 */
export async function readDengue(provinceOfUniqueKey) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(DATA_ROOT, 'Historical Dengue Data', 'DENGUE DATA.xlsx'))

  const records = []
  const problems = {
    blankTotals: [], exactDuplicates: [], conflictingDuplicates: [],
    unresolvedBlocks: [], impureBlocks: [],
  }

  for (const ws of wb.worksheets) {
    const year = Number(ws.name)
    if (!Number.isInteger(year)) continue

    // Walk row numbers rather than eachRow(): the blank rows between province
    // blocks are the delimiters, and eachRow() skips them.
    const blocks = []
    let block = []
    for (let n = 4; n <= ws.rowCount; n += 1) {
      const row = ws.getRow(n)
      const raw = cell(row, 1)
      if (!raw || !String(raw).trim()) {
        if (block.length) { blocks.push(block); block = [] }
        continue
      }
      const total = cell(row, 8)
      if (typeof total !== 'number') {
        problems.blankTotals.push({ year, name: String(raw).trim() })
        continue
      }
      block.push({
        key: normKey(raw),
        raw: String(raw).trim(),
        total,
        deaths: (Number(cell(row, 3)) || 0) + (Number(cell(row, 6)) || 0),
      })
    }
    if (block.length) blocks.push(block)

    for (const { province, rows } of assignProvinceByBlock(blocks, provinceOfUniqueKey, problems, year)) {
      // Collapse repeats within one province block.
      const byKey = new Map()
      for (const r of rows) {
        if (!byKey.has(r.key)) byKey.set(r.key, [])
        byKey.get(r.key).push(r)
      }

      for (const [key, hits] of byKey) {
        if (hits.length === 1) {
          records.push({ key, province, year, ...hits[0] })
          continue
        }
        const totals = new Set(hits.map((h) => h.total))
        if (totals.size === 1) {
          // 2024 carries "LUCENA CITY 827" and "Lucena City 827" — one town
          // written twice. Counting both would inflate the year by 827.
          problems.exactDuplicates.push({ year, province, key, value: hits[0].total, labels: hits.map((h) => h.raw) })
          records.push({ key, province, year, ...hits[0] })
        } else {
          // 2023 has "LUCENA CITY 268" and "CITY OF LUCENA 167" — not
          // resolvable from this file. Sum, and flag loudly.
          problems.conflictingDuplicates.push({ year, province, key, values: hits.map((h) => h.total), labels: hits.map((h) => h.raw) })
          records.push({
            key,
            province,
            year,
            raw: hits[0].raw,
            total: hits.reduce((s, h) => s + h.total, 0),
            deaths: hits.reduce((s, h) => s + h.deaths, 0),
            conflicted: true,
          })
        }
      }
    }
  }

  return { records, problems }
}

/* ------------------------------------------------------------------------- *
 * PAGASA monthly climate — 6 stations x 60 months.
 * ------------------------------------------------------------------------- */

export function readClimate() {
  const dir = fs.readdirSync(DATA_ROOT).find((d) => d.startsWith('PAGASA DATA'))
  const base = path.join(DATA_ROOT, dir)

  const rows = []
  const sentinels = []

  for (const file of fs.readdirSync(base).filter((f) => f.endsWith('.csv'))) {
    const station = file.replace(' Monthly Data.csv', '')
    const province = STATION_PROVINCE[station]
    if (!province) throw new Error(`No province mapped for PAGASA station "${station}"`)

    const text = fs.readFileSync(path.join(base, file), 'utf8').trim()
    const [header, ...lines] = text.split(/\r?\n/)
    const cols = header.split(',').map((h) => h.trim())

    for (const line of lines) {
      if (!line.trim()) continue
      const parts = line.split(',')
      const rec = Object.fromEntries(cols.map((c, i) => [c, parts[i]?.trim()]))

      const values = {
        rainfall: cleanMeasurement(rec.RAINFALL),
        tmax: cleanMeasurement(rec.TMAX),
        tmin: cleanMeasurement(rec.TMIN),
        tmean: cleanMeasurement(rec.TMEAN),
        rh: cleanMeasurement(rec.RH),
      }
      if (Object.values(values).some((v) => v === null)) {
        sentinels.push({ station, year: Number(rec.YEAR), month: Number(rec.MONTH) })
      }

      rows.push({ station, province, year: Number(rec.YEAR), month: Number(rec.MONTH), ...values })
    }
  }

  return { rows, sentinels }
}
