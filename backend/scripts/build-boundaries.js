#!/usr/bin/env node
/*
 * Builds the CALABARZON municipal boundary file the risk map renders from.
 *
 *   npm run etl:boundaries
 *   npm run etl:boundaries -- --update-regions   # also write centroids to regions.lat/lng
 *
 * Source: geoBoundaries gbOpen PHL ADM3 (municipalities) and ADM2 (provinces),
 * boundary year 2020 — the same vintage as the PSA census in the ETL.
 * Licence: CC-BY 4.0, open data, no account and no API key. Attribution is
 * rendered in the map footer.
 *
 * This runs ONCE and commits its output. The app never calls a tile server or
 * a geocoding service at runtime: it ships a static GeoJSON and draws its own
 * SVG, so the map works offline and costs nothing to serve.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../src/config/db.js'
import { readGazetteer } from './etl/sources.js'
import { normKey } from './etl/normalize.js'
import { REGIONS, REGION_SLUGS, canonRegion } from './etl/regions-ph.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', '..', 'frontend', 'public', 'calabarzon-lgus.geojson')
const OUT_ADM1 = path.join(HERE, '..', '..', 'frontend', 'public', 'ph-regions.geojson')
const CACHE = path.join(HERE, '.cache')

const API = 'https://www.geoboundaries.org/api/current/gbOpen/PHL'
const PROVINCE_NAMES = { BATANGAS: 'Batangas', CAVITE: 'Cavite', LAGUNA: 'Laguna', QUEZON: 'Quezon', RIZAL: 'Rizal' }

const UPDATE_REGIONS = process.argv.includes('--update-regions')
const log = (...a) => console.log(...a)

// --------------------------------------------------------------------------
// geometry — no dependencies, the region is small enough for planar maths
// --------------------------------------------------------------------------

/** Ray casting. `ring` is [[lng, lat], ...]. */
function pointInRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** True if the point is in any polygon of the feature and in none of its holes. */
function pointInFeature(pt, geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const poly of polys) {
    if (!pointInRing(pt, poly[0])) continue
    if (poly.slice(1).some((hole) => pointInRing(pt, hole))) continue
    return true
  }
  return false
}

function ringArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  }
  return Math.abs(a / 2)
}

/** Area-weighted centroid of the largest ring — always lands inside the shape. */
function representativePoint(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let best = null
  let bestArea = -1
  for (const poly of polys) {
    const a = ringArea(poly[0])
    if (a > bestArea) { bestArea = a; best = poly[0] }
  }
  let x = 0
  let y = 0
  let area = 0
  for (let i = 0, j = best.length - 1; i < best.length; j = i, i += 1) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1]
    area += f
    x += (best[j][0] + best[i][0]) * f
    y += (best[j][1] + best[i][1]) * f
  }
  if (area === 0) return best[0]
  area *= 3
  return [x / area, y / area]
}

/**
 * Douglas-Peucker over an OPEN polyline. `eps` is in degrees; 0.001 is ~110 m.
 */
function simplifyOpen(points, eps, keep, offset) {
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    if (last <= first + 1) continue
    const [x1, y1] = points[first]
    const [x2, y2] = points[last]
    const dx = x2 - x1
    const dy = y2 - y1
    const denom = Math.hypot(dx, dy)
    let maxD = -1
    let idx = -1
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = points[i]
      // Degenerate baseline (identical endpoints): fall back to radial distance,
      // otherwise every point measures zero and the segment never splits.
      const d = denom === 0
        ? Math.hypot(px - x1, py - y1)
        : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / denom
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > eps && idx !== -1) {
      keep[offset + idx] = 1
      stack.push([first, idx], [idx, last])
    }
  }
}

/**
 * Douglas-Peucker for a CLOSED ring.
 *
 * A ring's first and last point are identical, so running plain DP on it
 * degenerates: the initial baseline has zero length, every perpendicular
 * distance measures 0, nothing clears eps, and the ring comes back untouched.
 * That is why an earlier version of this script appeared to simplify nothing
 * and the output was ~4x larger than it needed to be.
 *
 * The fix is the standard one: anchor on the vertex farthest from the start,
 * which splits the ring into two open polylines, and simplify each.
 */
function simplifyRing(points, eps) {
  if (points.length <= 5) return points

  const n = points.length - 1          // drop the duplicated closing vertex
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  let far = 1
  let farD = -1
  for (let i = 1; i < n; i += 1) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1])
    if (d > farD) { farD = d; far = i }
  }
  keep[far] = 1

  simplifyOpen(points.slice(0, far + 1), eps, keep, 0)
  simplifyOpen(points.slice(far, n + 1), eps, keep, far)

  const out = points.filter((_, i) => keep[i])
  // A ring needs 4 points to enclose area; below that, keep the original.
  return out.length >= 4 ? out : points
}

const round = (n, dp) => Number(n.toFixed(dp))

function simplifyGeometry(geometry, eps, dp) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const out = []
  for (const poly of polys) {
    const rings = []
    for (const ring of poly) {
      const s = simplifyRing(ring, eps).map(([x, y]) => [round(x, dp), round(y, dp)])
      // Drop slivers that collapse to nothing, but always keep the outer ring.
      if (rings.length === 0 || s.length >= 4) rings.push(s)
    }
    if (rings[0]?.length >= 4) out.push(rings)
  }
  return out.length === 1
    ? { type: 'Polygon', coordinates: out[0] }
    : { type: 'MultiPolygon', coordinates: out }
}

function countPoints(geometry) {
  let n = 0
  const walk = (c) => {
    if (typeof c[0] === 'number') n += 1
    else c.forEach(walk)
  }
  walk(geometry.coordinates)
  return n
}

// --------------------------------------------------------------------------

async function fetchLayer(level) {
  fs.mkdirSync(CACHE, { recursive: true })
  const cached = path.join(CACHE, `PHL-${level}.geojson`)
  if (fs.existsSync(cached)) {
    log(`  ${level}: cache hit (${(fs.statSync(cached).size / 1e6).toFixed(1)} MB)`)
    return JSON.parse(fs.readFileSync(cached, 'utf8'))
  }

  log(`  ${level}: fetching metadata…`)
  const meta = await (await fetch(`${API}/${level}/`)).json()
  const url = meta.simplifiedGeometryGeoJSON
  log(`  ${level}: downloading ${meta.boundaryCanonical} (${meta.boundaryYearRepresented})`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${level} download failed: HTTP ${res.status}`)
  const text = await res.text()
  fs.writeFileSync(cached, text)
  log(`  ${level}: cached ${(text.length / 1e6).toFixed(1)} MB`)
  return JSON.parse(text)
}

/**
 * The national layer: the 17 administrative regions that are the study's unit
 * of analysis. Same open source, same one-time build, same static output — the
 * app still makes no request to a tile server at runtime.
 *
 * geoBoundaries ADM1 has its own naming again ("Autonomous Region In Muslim
 * Mindanao", "Region I"), so canonRegion() from the ETL does the matching here
 * too rather than a second lookup table drifting out of sync with it.
 */
async function buildRegions() {
  log('\nBuilding the national ADM1 layer (17 regions)\n')
  const adm1 = await fetchLayer('ADM1')

  const bySlug = new Map()
  const unmatched = []
  for (const f of adm1.features) {
    const slug = canonRegion(f.properties.shapeName)
    if (!slug) { unmatched.push(f.properties.shapeName); continue }
    if (!bySlug.has(slug)) bySlug.set(slug, f)
  }

  log(`  matched ${bySlug.size}/17 regions`)
  if (unmatched.length) log(`  unmatched ADM1 shapes: ${unmatched.join(', ')}`)

  const missing = REGION_SLUGS.filter((s) => !bySlug.has(s))
  if (missing.length) {
    throw new Error(`No ADM1 boundary for: ${missing.join(', ')}. Refusing to write a partial map.`)
  }

  let before = 0
  let after = 0
  const features = []
  for (const { slug, name } of REGIONS) {
    const f = bySlug.get(slug)
    before += countPoints(f.geometry)
    // Coarser than the municipal layer: these shapes render far smaller on
    // screen, so the extra vertices are invisible weight.
    const geometry = simplifyGeometry(f.geometry, 0.006, 3)
    after += countPoints(geometry)
    const pt = representativePoint(f.geometry)
    features.push({
      type: 'Feature',
      properties: { slug, name, lng: round(pt[0], 5), lat: round(pt[1], 5) },
      geometry,
    })
  }

  const bbox = features.reduce((b, f) => {
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1])
        b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1])
      } else c.forEach(walk)
    }
    walk(f.geometry.coordinates)
    return b
  }, [180, 90, -180, -90]).map((n) => round(n, 4))

  fs.mkdirSync(path.dirname(OUT_ADM1), { recursive: true })
  fs.writeFileSync(OUT_ADM1, JSON.stringify({
    type: 'FeatureCollection',
    bbox,
    metadata: {
      source: 'geoBoundaries gbOpen PHL ADM1',
      sourceUrl: 'https://www.geoboundaries.org/',
      licence: 'CC-BY 4.0',
      boundaryYear: 2020,
      generatedBy: 'backend/scripts/build-boundaries.js',
    },
    features,
  }))

  const kb = (fs.statSync(OUT_ADM1).size / 1024).toFixed(0)
  log(`  ${after.toLocaleString()} points (from ${before.toLocaleString()},`
    + ` ${((1 - after / before) * 100).toFixed(0)}% smaller)`)
  log(`  bbox ${bbox.join(', ')}`)
  log(`  wrote ${path.relative(process.cwd(), OUT_ADM1)}  (${kb} kB)`)
}

async function main() {
  await buildRegions()

  log('\nBuilding CALABARZON boundaries from geoBoundaries (gbOpen, CC-BY 4.0)\n')

  const adm2 = await fetchLayer('ADM2')
  const adm3 = await fetchLayer('ADM3')

  const provinces = adm2.features.filter((f) =>
    Object.values(PROVINCE_NAMES).includes(String(f.properties.shapeName).trim()))
  log(`\n  matched ${provinces.length}/5 CALABARZON provinces in ADM2`)
  if (provinces.length !== 5) {
    const got = provinces.map((f) => f.properties.shapeName)
    throw new Error(`Expected 5 provinces, got ${provinces.length}: ${got.join(', ')}`)
  }

  // ADM3 carries no parent province, so containment supplies it — which is
  // also what disambiguates the two Rosarios.
  const inRegion = []
  for (const f of adm3.features) {
    const pt = representativePoint(f.geometry)
    const parent = provinces.find((p) => pointInFeature(pt, p.geometry))
    if (!parent) continue
    inRegion.push({ feature: f, point: pt, province: String(parent.properties.shapeName).trim().toUpperCase() })
  }
  log(`  ${inRegion.length} ADM3 municipalities fall inside those provinces`)

  const { lgus } = await readGazetteer()
  const byKey = new Map(lgus.map((l) => [`${l.key}::${l.province}`, l]))

  const features = []
  const unmatchedShapes = []
  const matchedKeys = new Set()

  let ptsBefore = 0
  let ptsAfter = 0

  for (const { feature, point, province } of inRegion) {
    const key = normKey(feature.properties.shapeName)
    const lgu = byKey.get(`${key}::${province}`)
    if (!lgu) {
      unmatchedShapes.push({ shape: feature.properties.shapeName, key, province })
      continue
    }
    matchedKeys.add(`${key}::${province}`)

    ptsBefore += countPoints(feature.geometry)
    const geometry = simplifyGeometry(feature.geometry, 0.0016, 4)
    ptsAfter += countPoints(geometry)

    features.push({
      type: 'Feature',
      properties: {
        key,
        name: lgu.name,
        province: PROVINCE_NAMES[province],
        lng: round(point[0], 5),
        lat: round(point[1], 5),
      },
      geometry,
    })
  }

  const missing = lgus.filter((l) => !matchedKeys.has(`${l.key}::${l.province}`))

  log(`\n  matched   ${features.length} / ${lgus.length} gazetteer LGUs`)
  if (unmatchedShapes.length) {
    log(`  boundary shapes with no gazetteer entry (${unmatchedShapes.length}):`)
    for (const u of unmatchedShapes) log(`     ${u.shape}  [${u.province}]`)
  }
  if (missing.length) {
    log(`  gazetteer LGUs with no boundary (${missing.length}):`)
    for (const m of missing) log(`     ${m.name}  [${m.province}]`)
  }

  features.sort((a, b) =>
    a.properties.province.localeCompare(b.properties.province)
    || a.properties.name.localeCompare(b.properties.name))

  const bbox = features.reduce((b, f) => {
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1])
        b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1])
      } else c.forEach(walk)
    }
    walk(f.geometry.coordinates)
    return b
  }, [180, 90, -180, -90]).map((n) => round(n, 4))

  const out = {
    type: 'FeatureCollection',
    bbox,
    metadata: {
      source: 'geoBoundaries gbOpen PHL ADM3 + ADM2',
      sourceUrl: 'https://www.geoboundaries.org/',
      licence: 'CC-BY 4.0',
      boundaryYear: 2020,
      generatedBy: 'backend/scripts/build-boundaries.js',
      note: 'Simplified with Douglas-Peucker (eps 0.0016 deg) and rounded to 4 dp (~11 m).',
    },
    features,
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out))
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  const dropped = ptsBefore - ptsAfter
  log(`\n  ${ptsAfter.toLocaleString()} points across ${features.length} shapes`
    + ` (~${Math.round(ptsAfter / features.length)} per LGU)`)
  log(dropped > 0
    ? `  Douglas-Peucker removed ${dropped.toLocaleString()} points (${((dropped / ptsBefore) * 100).toFixed(0)}%)`
    : `  Douglas-Peucker removed nothing — geoBoundaries' *_simplified layer is`
      + ` already coarser than eps 0.0016 deg. The pass is kept as a guard for`
      + ` anyone switching to the full-resolution source.`)
  log(`  bbox ${bbox.join(', ')}`)
  log(`  wrote ${path.relative(process.cwd(), OUT)}  (${kb} kB)`)

  if (UPDATE_REGIONS) {
    let n = 0
    for (const f of features) {
      const [res] = await pool.execute(
        'UPDATE regions SET lat = :lat, lng = :lng WHERE name = :name AND province = :province',
        { lat: f.properties.lat, lng: f.properties.lng, name: f.properties.name, province: f.properties.province.toUpperCase() },
      )
      n += res.affectedRows
    }
    log(`  wrote centroids to regions.lat/lng for ${n} rows`)
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\nBoundary build failed:', err.message)
    await pool.end()
    process.exitCode = 1
  })
