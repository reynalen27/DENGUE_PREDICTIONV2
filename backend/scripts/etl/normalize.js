/*
 * Municipality-name normalisation for the CALABARZON research data.
 *
 * Three separate sources name the same 142 LGUs three different ways, so every
 * join in this ETL goes through normKey(). See DATA_ASSESSMENT.md for how each
 * defect was found and measured.
 */

/**
 * OCR corruptions in `DENGUE DATA.xlsx`. The workbook was transcribed from the
 * DOH PDFs and the transcription damaged eleven names. Left unrepaired each one
 * becomes a phantom municipality that silently fails to join: before this map,
 * only 116 of 152 name variants carried a value in all five years; after it,
 * 134 of 141 LGUs form a complete panel.
 */
export const OCR_CORRECTIONS = {
  'AGONCILLA': 'AGONCILLO',            // 2020
  'CALAUJAG': 'CALAUAG',               // 2020
  'CABUAYAO': 'CABUYAO',               // 2022
  'LIUW': 'LILIW',                     // 2022
  'MATAAS NA KAHOY': 'MATAASNAKAHOY',  // 2020, 2023
  'MATAAS NA KAOY': 'MATAASNAKAHOY',   // 2022
  'MATAAS NA KAOYO': 'MATAASNAKAHOY',  // 2021 — four spellings of one town
  'UMACA': 'GUMACA',                   // 2023 — dropped leading G
  'UNIAN': 'UNISAN',                   // 2023
  'TIINGLOY': 'TINGLOY',               // 2023
  'TAKAWANAN': 'TAGKAWAYAN',           // 2023
}

export const PROVINCES = ['BATANGAS', 'CAVITE', 'LAGUNA', 'QUEZON', 'RIZAL']

/*
 * Municipality names that occur in more than one CALABARZON province. The
 * dengue workbook has no province column (the PDFs did — it was lost in
 * transcription), so these rows are genuinely ambiguous from that file alone.
 *
 * Measured impact: keying Cavite's LGUs on name alone sums to 4,234,022 against
 * the census province total of 4,344,829 — short by exactly 110,807, which is
 * Rosario, Cavite. One municipality silently dropped and its cases misfiled.
 */
export const AMBIGUOUS_NAMES = ['ROSARIO']

/**
 * Canonical key for one municipality name.
 *
 * Deliberately keeps the distinction between a city and the province it is
 * named after: "Cavite City" must not collapse onto the province "Cavite".
 * The trailing-CITY strip only fires once the string has been trimmed, because
 * "BATANGAS CITY (Capital)" leaves a trailing space after the parenthetical is
 * removed and would otherwise keep its suffix.
 */
export function normKey(value) {
  let s = String(value ?? '').trim().toUpperCase()

  // U+FFFD is how the enye in DASMARIÑAS / MENDEZ-NUÑEZ survives the workbook.
  s = s.replace(/�/g, 'N')

  s = s.replace(/\(.*?\)/g, ' ').trim()              // "(Capital)", "(MENDEZ-NUÑEZ)"
  s = s.replace(/^(CITY OF|MUNICIPALITY OF)\s+/, '').trim()
  s = s.replace(/\s+CITY$/, '').trim()
  s = s.replace(/[.\-]/g, ' ')
  s = s.replace(/\bSTO\b/g, 'SANTO').replace(/\bSTA\b/g, 'SANTA')
  s = s.replace(/\bGEN\b/g, 'GENERAL')
  s = s.replace(/[\d*]+/g, '')                        // "STO. TOMAS 1", "QUEZON *"
  s = s.replace(/\s+/g, ' ').trim()

  return OCR_CORRECTIONS[s] ?? s
}

const LOWERCASE_WORDS = new Set(['of', 'de', 'del', 'la', 'las', 'los', 'na', 'ng', 'y'])

/**
 * Human-readable label for the UI. PSA ships everything in caps with
 * bookkeeping suffixes — "CITY OF ANTIPOLO (Capital)", "CITY OF STO. TOMAS 1" —
 * which read as shouting in a sidebar and truncate badly in a table.
 *
 * "(Capital)" and the trailing disambiguation digit go; other parentheticals
 * stay, because they carry meaning ("SAN FRANCISCO (AURORA)" is how that town
 * is told apart from the other San Franciscos).
 */
export function displayName(value) {
  let s = String(value ?? '').trim().replace(/�/g, 'Ñ')
  s = s.replace(/\s*\(capital\)\s*/i, ' ')
  s = s.replace(/\s+\d+$/, '')
  s = s.replace(/\s+/g, ' ').trim()

  return s
    .toLowerCase()
    .split(' ')
    .map((word, i) => {
      if (i > 0 && LOWERCASE_WORDS.has(word.replace(/[()]/g, ''))) return word
      // Title-case inside parentheses and after hyphens too.
      return word.replace(/(^|[(\-])([a-zñ])/g, (_, p, c) => p + c.toUpperCase())
    })
    .join(' ')
}

/** Composite key. Use wherever a province is known — it is the only safe join. */
export function regionKey(name, province) {
  return `${normKey(name)}::${String(province ?? '').trim().toUpperCase()}`
}

/** PAGASA writes -999 for "no observation". It is a number, so nothing flags it. */
export function cleanMeasurement(value) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n === -999) return null
  return n
}

/**
 * Station -> province. Laguna deliberately has no entry: the region's
 * second-most-populous province has no PAGASA station in this dataset, and
 * substituting a neighbour silently would bury a modelling assumption in an
 * ETL script. Pass --laguna-proxy to make that choice explicit and recorded.
 */
export const STATION_PROVINCE = {
  'Sangley Point': 'CAVITE',
  'Ambulong': 'BATANGAS',
  'Tanay': 'RIZAL',
  'Alabat': 'QUEZON',
  'Infanta': 'QUEZON',
  'Tayabas': 'QUEZON',
}
