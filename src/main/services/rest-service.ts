/**
 * Rest Point Service — predicts where a missing person would stop to rest.
 *
 * A logical rest point is NOT just "any flat spot near water."
 * It's a place where a tired, possibly lost person would naturally stop:
 *
 *  1. On or near a trail/road (people follow paths, then rest on them)
 *  2. Near water — but on the bank, not in a swamp (streams, lakes, rivers)
 *  3. Flat ground with natural shelter (not exposed ridges, not steep slopes)
 *  4. At natural rest intervals — roughly every 20-40 min of walking
 *     from the LKP, not every 100m
 *  5. Near landmarks a lost person would gravitate toward
 *     (trail junctions, water crossings, clearings, shelter features)
 *
 * Algorithm:
 *  1. Determine the search area (from bounds if provided, else LKP walk radius)
 *  2. Load DEM grid for the area
 *  3. Fetch water features + road/path features from OSM
 *  4. Sample candidate points on a 200m grid (not 100m — rest points are
 *     areas, not pixel-precise spots)
 *  5. Score each candidate:
 *     - Slope: <8° ideal, >15° disqualified
 *     - Water: within 200m of a stream/lake (not IN water)
 *     - Trail/road: within 100m of a path or road
 *     - Shelter: depression or leeward slope (not exposed ridge)
 *     - Distance: prefer points at 500-3000m from LKP (rest interval zone)
 *  6. Require minimum 2 strong factors to qualify (no single-factor points)
 *  7. Cluster surviving points with 300m NMS — one representative per area
 *  8. Return sorted by score, no artificial cap
 */

import type { RestPointService } from './types'
import type { RestPointsRequest, RestPointsResponse, RestPoint, LngLat } from '@shared/types'
import { demService } from './dem-service'
import { lngLatToTile } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'
import { deriveTripParams } from './trip-params'
import { fetchWaterFeatures, waterProximityScore, type WaterFeature } from './water-service'

const BASE_WALK_SPEED_MPS = 0.8 // ~2.9 km/hr
const GRID_SPACING_M = 200 // sample every 200m
const NMS_RADIUS_M = 500 // cluster: one representative per 500m area (good spread)
const SLOPE_MAX_DEG = 25 // above this = disqualified (cliff, not restable)
const WATER_PROXIMITY_M = 300 // good if within 300m of water
const TRAIL_PROXIMITY_M = 150 // good if within 150m of a trail/road
const REST_MIN_DIST_M = 100 // too close to LKP = not a rest point
const MAX_REST_POINTS = 40 // cap to prevent point spam on large bboxes

interface ScoredCandidate {
  lng: number
  lat: number
  score: number
  slopeScore: number
  waterScore: number
  shelterScore: number
  trailScore: number
  distanceScore: number
  reasons: string[]
}

/** Load a DEM grid covering the bounding box. */
async function loadDemGrid(
  bounds: [LngLat, LngLat],
  zoom: number,
): Promise<{ grid: (number | null)[][]; width: number; height: number; swLng: number; neLat: number; lngStep: number; latStep: number }> {
  const effectiveZoom = computeOptimalZoom(bounds, zoom, 32)
  const [sw, ne] = bounds
  const minTile = lngLatToTile(sw.lng, ne.lat, effectiveZoom)
  const maxTile = lngLatToTile(ne.lng, sw.lat, effectiveZoom)
  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1

  const tileGrids: (number | null)[][][][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    tileGrids[ty] = []
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = await demService.loadTile(minTile.x + tx, minTile.y + ty, effectiveZoom)
      tileGrids[ty][tx] = tile.grid
    }
  }

  const grid: (number | null)[][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let row = 0; row < tileGrids[ty][0].length; row++) {
      const mergedRow: (number | null)[] = []
      for (let tx = 0; tx < tilesX; tx++) {
        const tileRow = tileGrids[ty][tx][row]
        if (tileRow) mergedRow.push(...tileRow)
      }
      grid.push(mergedRow)
    }
  }

  const height = grid.length
  const width = grid[0]?.length ?? 0
  if (width === 0 || height === 0) {
    throw new Error('No elevation data available for this area.')
  }

  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  return { grid, width, height, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

/** Sample elevation from the in-memory grid. */
function sampleGrid(
  grid: (number | null)[][],
  width: number,
  height: number,
  swLng: number,
  neLat: number,
  lngStep: number,
  latStep: number,
  lng: number,
  lat: number,
): number | null {
  const x = Math.floor((lng - swLng) / lngStep)
  const y = Math.floor((neLat - lat) / latStep)
  if (x < 0 || x >= width || y < 0 || y >= height) return null
  return grid[y]?.[x] ?? null
}

/** Fetch road/path features from OSM Overpass for trail proximity scoring. */
async function fetchTrailFeatures(
  bounds: [LngLat, LngLat],
): Promise<{ lng: number; lat: number }[]> {
  const [sw, ne] = bounds
  const query = `
    [out:json][timeout:15];
    (
      way["highway"~"path|track|footway|bridleway|cycleway|residential|unclassified|tertiary|secondary|primary"](${sw.lat},${sw.lng},${ne.lat},${ne.lng});
    );
    out center 500;
  `
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = await res.json() as any
    const elements = data.elements || []
    return elements
      .filter((e: any) => e.center)
      .map((e: any) => ({ lng: e.center.lon, lat: e.center.lat }))
  } catch {
    return []
  }
}

/** Distance from a point to the nearest trail/road point (meters). */
function nearestTrailDistance(
  lng: number,
  lat: number,
  trails: { lng: number; lat: number }[],
  lngPerM: number,
  latPerM: number,
): number {
  let minDist = Infinity
  for (const t of trails) {
    const dx = (t.lng - lng) / lngPerM
    const dy = (t.lat - lat) / latPerM
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < minDist) minDist = d
  }
  return minDist
}

export const restPointService: RestPointService = {
  async find(req: RestPointsRequest): Promise<RestPointsResponse> {
    const { lkp, maxHours, tripParams, bounds, mode } = req
    const analysisMode: 'active-sar' | 'legacy-research' = mode || 'active-sar'
    const isLegacy = analysisMode === 'legacy-research'

    const derived = tripParams ? deriveTripParams(tripParams) : null
    const walkSpeed = derived?.walkSpeedMps ?? BASE_WALK_SPEED_MPS

    // ── Determine the search area ──
    const effectiveHours = Math.min(maxHours, isLegacy ? 12 : 4)
    const walkRadiusM = walkSpeed * effectiveHours * 3600

    let searchBounds: [LngLat, LngLat]
    if (bounds) {
      searchBounds = bounds
    } else {
      const latPerM = 1 / 111320
      const lngPerM = 1 / (111320 * Math.cos((lkp.lat * Math.PI) / 180))
      searchBounds = [
        { lng: lkp.lng - walkRadiusM * lngPerM, lat: lkp.lat - walkRadiusM * latPerM },
        { lng: lkp.lng + walkRadiusM * lngPerM, lat: lkp.lat + walkRadiusM * latPerM },
      ]
    }

    const [sw, ne] = searchBounds

    // ── Load DEM grid for the search area ──
    const REST_DEM_ZOOM = 12
    const demGrid = await loadDemGrid(searchBounds, REST_DEM_ZOOM)
    const { grid, width, height, swLng, neLat, lngStep, latStep } = demGrid

    // ── Fetch water + trail features from OSM ──
    let waterFeatures: WaterFeature[] = []
    try {
      const waterRes = await fetchWaterFeatures(searchBounds)
      waterFeatures = waterRes.features
    } catch { /* neutral water scores if Overpass fails */ }

    let trailFeatures: { lng: number; lat: number }[] = []
    try {
      trailFeatures = await fetchTrailFeatures(searchBounds)
    } catch { /* neutral trail scores if Overpass fails */ }

    // ── Sample candidate points on a grid ──
    const latPerM = 1 / 111320
    const lngPerM = 1 / (111320 * Math.cos((lkp.lat * Math.PI) / 180))

    // Grid covers the bounding box, spaced at GRID_SPACING_M
    const gridWidthM = (ne.lng - sw.lng) / lngPerM
    const gridHeightM = (ne.lat - sw.lat) / latPerM
    const cols = Math.ceil(gridWidthM / GRID_SPACING_M)
    const rows = Math.ceil(gridHeightM / GRID_SPACING_M)

    const candidates: ScoredCandidate[] = []

    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const lng = sw.lng + (i / cols) * (ne.lng - sw.lng)
        const lat = sw.lat + (j / rows) * (ne.lat - sw.lat)

        // Distance from LKP (used for scoring, not hard filtering in legacy mode)
        const distM = lkp
          ? Math.sqrt(((lng - lkp.lng) / lngPerM) ** 2 + ((lat - lkp.lat) / latPerM) ** 2)
          : Infinity

        // Active SAR: always constrain by walkable radius from LKP,
        // even when bounds are provided. A missing person can only walk
        // so far — drawing a big bbox shouldn't scatter points beyond
        // physical walking range.
        // Legacy: bbox is the constraint — no LKP distance filter.
        if (!isLegacy && lkp && distM !== Infinity && distM > walkRadiusM) continue

        // Sample elevation
        const elev = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng, lat)
        if (elev == null) continue

        // ── Score: slope ──
        const e1 = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng + 30 * lngPerM, lat)
        const e2 = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng - 30 * lngPerM, lat)
        const e3 = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng, lat + 30 * latPerM)
        const e4 = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng, lat - 30 * latPerM)

        let slopeDeg = 0
        if (e1 != null && e2 != null) {
          slopeDeg = Math.max(slopeDeg, Math.atan2(Math.abs(e1 - e2), 60) * (180 / Math.PI))
        }
        if (e3 != null && e4 != null) {
          slopeDeg = Math.max(slopeDeg, Math.atan2(Math.abs(e3 - e4), 60) * (180 / Math.PI))
        }

        // Disqualify cliffs only
        if (slopeDeg > SLOPE_MAX_DEG) continue

        // Slope score: 1.0 at 0°, decays linearly to 0 at SLOPE_MAX_DEG
        const slopeScore = Math.max(0, 1 - slopeDeg / SLOPE_MAX_DEG)

        // ── Score: water proximity ──
        const waterScore = waterProximityScore({ lng, lat }, waterFeatures)
        // waterScore: 1.0 at water's edge, decays with distance

        // ── Score: trail/road proximity ──
        // If no trail data available (Overpass failed), use neutral 0.3.
        // Don't penalize points just because we couldn't fetch trail data.
        let trailScore = 0.3
        if (trailFeatures.length > 0) {
          const trailDist = nearestTrailDistance(lng, lat, trailFeatures, lngPerM, latPerM)
          if (trailDist <= TRAIL_PROXIMITY_M) {
            trailScore = 1 - trailDist / TRAIL_PROXIMITY_M
          } else if (trailDist <= TRAIL_PROXIMITY_M * 3) {
            trailScore = Math.max(0, 0.3 - (trailDist - TRAIL_PROXIMITY_M) / (TRAIL_PROXIMITY_M * 2) * 0.3)
          } else {
            trailScore = 0 // confirmed far from any trail
          }
        }

        // ── Score: shelter (depression = sheltered from wind) ──
        const neighborAvg = [e1, e2, e3, e4].filter((v): v is number => v != null)
        const shelterScore =
          neighborAvg.length > 0
            ? Math.max(0, Math.min(1, 0.5 + (neighborAvg.reduce((a, b) => a + b, 0) / neighborAvg.length - elev) / 10))
            : 0.5

        // ── Score: distance from LKP (mode-dependent) ──
        let distanceScore: number
        if (isLegacy || !lkp || distM === Infinity) {
          // Legacy/research: LKP is an estimate — no bias. Flat score.
          distanceScore = 0.7
        } else if (distM < 200) {
          // Active SAR: too close to LKP — hasn't walked far enough to rest
          distanceScore = 0.3
        } else if (distM <= 3000) {
          // Active SAR: rest interval zone (10-60 min walk) — ideal
          distanceScore = 0.9
        } else {
          // Active SAR: beyond typical first rest — decays
          distanceScore = Math.max(0.2, 0.6 - (distM - 3000) / 5000)
        }

        // ── Combined score (mode-dependent weights) ──
        // Active SAR: slope + trail + water + shelter + distance (LKP matters)
        // Legacy: slope + trail + water + shelter (terrain only, LKP is estimate)
        const weights = isLegacy
          ? (derived
            ? {
                slope: 0.38,
                trail: 0.27,
                water: 0.22,
                shelter: derived.shelterWeight,
                distance: 1 - 0.38 - 0.27 - 0.22 - derived.shelterWeight,
              }
            : {
                slope: 0.38,
                trail: 0.27,
                water: 0.22,
                shelter: 0.13,
                distance: 0.00,
              })
          : (derived
            ? {
                slope: 0.30,
                trail: 0.22,
                water: 0.18,
                shelter: derived.shelterWeight,
                distance: 1 - 0.30 - 0.22 - 0.18 - derived.shelterWeight,
              }
            : {
                slope: 0.30,
                trail: 0.22,
                water: 0.18,
                shelter: 0.12,
                distance: 0.18,
              })

        const score =
          trailScore * weights.trail +
          slopeScore * weights.slope +
          waterScore * weights.water +
          shelterScore * weights.shelter +
          distanceScore * weights.distance

        // ── Qualification: require at least 2 strong factors ──
        // A rest point should have multiple reasons to be a rest point.
        // A flat spot in the middle of nowhere with no water/trail is not
        // a likely rest spot — it's just flat ground.
        // "Strong" = score > 0.5 in that factor.
        const strongFactors =
          (slopeScore > 0.5 ? 1 : 0) +
          (waterScore > 0.5 ? 1 : 0) +
          (trailScore > 0.5 ? 1 : 0) +
          (shelterScore > 0.55 ? 1 : 0) +
          (distanceScore > 0.6 ? 1 : 0)

        if (strongFactors < 2) continue

        // Also require a minimum combined score
        if (score < 0.25) continue

        // Build human-readable reasons
        const reasons: string[] = []
        if (slopeScore > 0.5) reasons.push(`flat terrain (${slopeDeg.toFixed(0)}°)`)
        if (waterScore > 0.4) reasons.push('near water')
        if (trailScore > 0.5) reasons.push('near trail/path')
        if (shelterScore > 0.55) reasons.push('sheltered position')
        if (distanceScore > 0.6) reasons.push(`${(distM / 1000).toFixed(1)}km from LKP (rest interval)`)

        candidates.push({
          lng, lat, score,
          slopeScore, waterScore, shelterScore, trailScore, distanceScore,
          reasons,
        })
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score)

    // Non-maximum suppression: one representative per NMS_RADIUS_M area
    // Process in score order (already sorted) so highest-scoring points win.
    const kept: ScoredCandidate[] = []
    for (const c of candidates) {
      if (kept.length >= MAX_REST_POINTS) break
      const tooClose = kept.some(
        (k) =>
          Math.sqrt(((k.lng - c.lng) / lngPerM) ** 2 + ((k.lat - c.lat) / latPerM) ** 2) < NMS_RADIUS_M,
      )
      if (!tooClose) kept.push(c)
    }

    const points: RestPoint[] = kept.map((c, i) => ({
      id: `rest-${i}`,
      lng: c.lng,
      lat: c.lat,
      score: c.score,
      slopeScore: c.slopeScore,
      waterScore: c.waterScore,
      shelterScore: c.shelterScore,
      distanceScore: c.distanceScore,
    }))

    return { points }
  },
}
