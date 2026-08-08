/*
 * The 17 administrative regions of the Philippines — the study's unit of
 * analysis — and the machinery for recognising them across four different
 * source vocabularies.
 *
 * The revised dataset names the same region four ways:
 *
 *   dengue CSV      "Region IV-A"    "NCR"   "BARMM"
 *   ERA5 workbooks  "Region 4-A"     "National Capital Region"
 *   PSA density     "Region IV-A (CALABARZON)"   "Bangsamoro Autonomous …"
 *   PSA population  "REGION IV-A (CALABARZON)"   with an ADM1_PCODE
 *
 * plus two historical renames — ARMM became BARMM, and CARAGA is Region XIII.
 * Every join in this ETL goes through canonRegion(), and the loader asserts it
 * resolved all 17 before writing anything.
 */

/** slug -> canonical display name. The slug is the DB's stable key. */
export const REGIONS = [
  { slug: 'NCR', name: 'National Capital Region' },
  { slug: 'CAR', name: 'Cordillera Administrative Region' },
  { slug: 'R1', name: 'Region I (Ilocos Region)' },
  { slug: 'R2', name: 'Region II (Cagayan Valley)' },
  { slug: 'R3', name: 'Region III (Central Luzon)' },
  { slug: 'R4A', name: 'Region IV-A (CALABARZON)' },
  { slug: 'R4B', name: 'MIMAROPA Region' },
  { slug: 'R5', name: 'Region V (Bicol Region)' },
  { slug: 'R6', name: 'Region VI (Western Visayas)' },
  { slug: 'R7', name: 'Region VII (Central Visayas)' },
  { slug: 'R8', name: 'Region VIII (Eastern Visayas)' },
  { slug: 'R9', name: 'Region IX (Zamboanga Peninsula)' },
  { slug: 'R10', name: 'Region X (Northern Mindanao)' },
  { slug: 'R11', name: 'Region XI (Davao Region)' },
  { slug: 'R12', name: 'Region XII (SOCCSKSARGEN)' },
  { slug: 'R13', name: 'Region XIII (Caraga)' },
  { slug: 'BARMM', name: 'Bangsamoro Autonomous Region in Muslim Mindanao' },
]

export const REGION_SLUGS = REGIONS.map((r) => r.slug)

/** Exact spellings seen in the source files, lowercased. */
const EXACT = {
  // dengue CSV (2016-2020)
  'region i': 'R1', 'region ii': 'R2', 'region iii': 'R3', 'region iv-a': 'R4A',
  'region iv-b': 'R4B', 'region v': 'R5', 'region vi': 'R6', 'region vii': 'R7',
  'region viii': 'R8', 'region ix': 'R9', 'region x': 'R10', 'region xi': 'R11',
  'region xii': 'R12', 'region xiii': 'R13',
  'ncr': 'NCR', 'car': 'CAR', 'barmm': 'BARMM', 'armm': 'BARMM',
  // dengue CSV (2008-2016, dotted — excluded from loading but still recognised
  // so the guard in the loader can name what it is refusing)
  'region.i': 'R1', 'region.ii': 'R2', 'region.iii': 'R3', 'region.iv.a': 'R4A',
  'region.iv.b': 'R4B', 'region.v': 'R5', 'region.vi': 'R6', 'region.vii': 'R7',
  'region.viii': 'R8', 'region.ix': 'R9', 'region.x': 'R10', 'region.xi': 'R11',
  'region.xii': 'R12', 'caraga': 'R13',
  // ERA5 workbooks
  'region 1': 'R1', 'region 2': 'R2', 'region 3': 'R3', 'region 4-a': 'R4A',
  'region 4-b': 'R4B', 'region 5': 'R5', 'region 6': 'R6', 'region 7': 'R7',
  'region 8': 'R8', 'region 9': 'R9', 'region 10': 'R10', 'region 11': 'R11',
  'region 12': 'R12', 'region 13': 'R13',
  'national capital region': 'NCR',
  'cordillera administrative region': 'CAR',
  'bangsamoro autonomous region in muslim mindanao': 'BARMM',
}

/*
 * Distinctive substrings, for the PSA spellings that carry a parenthetical.
 *
 * Each needle must be specific enough that no PROVINCE matches it — the PSA
 * density workbook lists regions and provinces in one flat hierarchy, so a
 * loose needle silently promotes a province to a region. "ilocos" would catch
 * Ilocos Norte and Ilocos Sur; "zamboanga" would catch Zamboanga del Sur,
 * which at 1.05M people over 4,484 km² is large enough to slip past the
 * size guard in readGeography() too.
 */
const CONTAINS = [
  ['mimaropa', 'R4B'], ['ilocos region', 'R1'], ['cagayan valley', 'R2'],
  ['central luzon', 'R3'], ['calabarzon', 'R4A'], ['bicol region', 'R5'],
  ['western visayas', 'R6'], ['central visayas', 'R7'], ['eastern visayas', 'R8'],
  ['zamboanga peninsula', 'R9'], ['northern mindanao', 'R10'], ['davao region', 'R11'],
  ['soccsksargen', 'R12'], ['caraga', 'R13'],
  ['bangsamoro', 'BARMM'], ['muslim mindanao', 'BARMM'],
  ['cordillera', 'CAR'], ['national capital', 'NCR'],
]

/**
 * Resolve any source spelling to a slug, or null.
 *
 * Order matters. The exact lookup runs BEFORE trailing digits are stripped,
 * because "region 1" is a name while the trailing digit in "BARMM 3" or
 * "Negros Occidental 1" is a footnote marker. Stripping first turns
 * "region 1" into "region" and silently loses twelve of the seventeen.
 */
export function canonRegion(value) {
  if (value === null || value === undefined) return null
  let k = String(value).replace(/�/g, 'n').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!k) return null

  if (EXACT[k]) return EXACT[k]

  const noParens = k.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  if (EXACT[noParens]) return EXACT[noParens]

  const noFootnote = noParens.replace(/[*]/g, '').replace(/\s+\d+$/, '').trim()
  if (EXACT[noFootnote]) return EXACT[noFootnote]

  for (const [needle, slug] of CONTAINS) {
    if (noFootnote.includes(needle)) return slug
  }
  return null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "January" / "Jan" / "1" -> 1..12, else null. */
export function monthNumber(value) {
  const s = String(value ?? '').trim().toLowerCase()
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return n >= 1 && n <= 12 ? n : null
  }
  const i = MONTHS.indexOf(s.slice(0, 3))
  return i === -1 ? null : i + 1
}
