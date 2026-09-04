/**
 * Rest Point Service — implements RestPointService interface.
 *
 * Predicts likely rest points based on terrain + human behavior model.
 *
 * Scoring inputs (each 0-1, weighted equally for now):
 *  - slopeScore:     lower slope = better resting spot (< 10° ideal)
 *  - waterScore:     proximity to water (OSM hydrology)
 *  - shelterScore:   sheltered from wind (low anomaly / depression = sheltered)
 *  - distanceScore:  within reasonable walking distance of LKP (~2hr walk)
 *
 * Combined score = weighted average. Points ranked by score.
 *
 * Method:
 *  1. Load the DEM grid for the entire analysis area in one batch
 *  2. Sample a grid of candidate points around the LKP from the in-memory grid
 *  3. Score each point (no async calls per cell)
 *  4. Filter by minimum score threshold
 *  5. Cluster nearby high-score points (NMS — non-maximum suppression)
 *  6. Return top N points with full score breakdown
 */

import type { RestPointService } from './types'
import type { RestPointsRequest, RestPointsResponse, RestPoint, LngLat } from '@shared/types'
import { demService } from './dem-service'
import { lngLatToTile } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'
import { deriveTripParams } from './trip-params'
import { fetchWaterFeatures, waterProximityScore, type WaterFeature } from './water-service'

// Walking speed: default ~3 km/hr on flat terrain
const BASE_WALK_SPEED_MPS = 0.8 // ~2.9 km/hr
const GRID_SPACING_M = 100 // sample every 100m
const MIN_SCORE = 0.4
const NMS_RADIUS_M = 200 // suppress points within 200m of a higher-scored point
const MAX_RESULTS = 20

// Default scoring weights (overridden by trip params)
const DEFAULT_WEIGHTS = {
  slope: 0.4,
  water: 0.25,
  shelter: 0.2,
  distance: 0.15,
}

interface ScoredCandidate {
  lng: number
  lat: number
  score: number
  slopeScore: number
  waterScore: number
  shelterScore: number
  distanceScore: number
}

/** Load a DEM grid covering the bounding box (batch-loaded, no per-cell HTTP calls). */
async function loadDemGrid(
  bounds: [LngLat, LngLat],
  zoom: number,
): Promise<{ grid: (number | null)[][]; width: number; height: number; swLng: number; neLat: number; lngStep: number; latStep: number }> {
  // Auto-reduce zoom for large areas instead of throwing an error
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

/** Sample elevation from an in-memory grid (synchronous, no HTTP calls). */
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

export const restPointService: RestPointService = {
  async find(req: RestPointsRequest): Promise<RestPointsResponse> {
    const { lkp, maxHours, tripParams } = req

    // Derive walk speed and scoring weights from trip params
    const derived = tripParams ? deriveTripParams(tripParams) : null
    const walkSpeed = derived?.walkSpeedMps ?? BASE_WALK_SPEED_MPS
    // Cap rest point search radius — rest points are where a person would
    // stop to rest, typically within a few hours. Even if they've been
    // missing for 24h, we don't need to search 35km out for rest spots.
    // Cap at 3 hours walk (~8.6km) to keep the analysis fast and relevant.
    const effectiveHours = Math.min(maxHours, 3)
    const maxDistanceM = walkSpeed * effectiveHours * 3600

    // Adjust scoring weights based on trip params
    const weights = derived
      ? {
          slope: 0.35,
          water: 0.20,
          shelter: derived.shelterWeight, // weather-dependent
          distance: 1 - 0.35 - 0.20 - derived.shelterWeight,
        }
      : DEFAULT_WEIGHTS

    // Fetch water features from OSM Overpass for water proximity scoring
    const waterBounds: [LngLat, LngLat] = [
      { lng: lkp.lng - maxDistanceM / 111320, lat: lkp.lat - maxDistanceM / 111320 },
      { lng: lkp.lng + maxDistanceM / 111320, lat: lkp.lat + maxDistanceM / 111320 },
    ]
    let waterFeatures: WaterFeature[] = []
    try {
      const waterRes = await fetchWaterFeatures(waterBounds)
      waterFeatures = waterRes.features
    } catch {
      // If Overpass fails, fall back to neutral water scores
    }

    // ── Batch-load the DEM grid for the entire analysis area ──
    // This replaces 66,000+ individual demService.sample() calls with
    // a single batch load of ~1-4 DEM tiles.
    // Use zoom 12 (~9.6km/tile, ~37m/pixel) — sufficient for 100m grid spacing
    // and keeps tile count low even for large walk radii.
    const REST_DEM_ZOOM = 12
    const demGrid = await loadDemGrid(waterBounds, REST_DEM_ZOOM)
    const { grid, width, height, swLng, neLat, lngStep, latStep } = demGrid

    // Sample a grid of candidate points from the in-memory DEM grid
    const latPerM = 1 / 111320
    const lngPerM = 1 / (111320 * Math.cos((lkp.lat * Math.PI) / 180))
    const gridSize = Math.ceil((maxDistanceM * 2) / GRID_SPACING_M)

    const candidates: ScoredCandidate[] = []

    for (let i = 0; i <= gridSize; i++) {
      for (let j = 0; j <= gridSize; j++) {
        const dLng = (i - gridSize / 2) * GRID_SPACING_M * lngPerM
        const dLat = (j - gridSize / 2) * GRID_SPACING_M * latPerM
        const lng = lkp.lng + dLng
        const lat = lkp.lat + dLat

        const distM = Math.sqrt((dLng / lngPerM) ** 2 + (dLat / latPerM) ** 2)
        if (distM > maxDistanceM) continue

        // Sample elevation from in-memory grid (synchronous)
        const elev = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng, lat)
        if (elev == null) continue

        // Score: slope (flat = good) — sample neighbors from in-memory grid
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

        // Slope threshold from trip params (experience-based)
        const slopeThreshold = derived?.impassableSlopeDeg ?? 15
        const slopeScore = Math.max(0, 1 - slopeDeg / slopeThreshold)

        // Score: water proximity from OSM Overpass data
        const waterScore = waterProximityScore({ lng, lat }, waterFeatures)

        // Score: shelter (depressions = sheltered from wind)
        const neighborAvg = [e1, e2, e3, e4].filter((v): v is number => v != null)
        const shelterScore =
          neighborAvg.length > 0
            ? Math.max(0, Math.min(1, 0.5 + (neighborAvg.reduce((a, b) => a + b, 0) / neighborAvg.length - elev) / 10))
            : 0.5

        // Score: distance (closer = slightly higher, but not dominant)
        const distanceScore = 1 - distM / maxDistanceM

        // Combined score with dynamic weights
        const score =
          slopeScore * weights.slope +
          waterScore * weights.water +
          shelterScore * weights.shelter +
          distanceScore * weights.distance

        if (score >= MIN_SCORE) {
          candidates.push({ lng, lat, score, slopeScore, waterScore, shelterScore, distanceScore })
        }
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score)

    // Non-maximum suppression: remove candidates too close to a higher-scored one
    const kept: ScoredCandidate[] = []
    for (const c of candidates) {
      const tooClose = kept.some(
        (k) =>
          Math.sqrt(((k.lng - c.lng) / lngPerM) ** 2 + ((k.lat - c.lat) / latPerM) ** 2) < NMS_RADIUS_M,
      )
      if (!tooClose) kept.push(c)
      if (kept.length >= MAX_RESULTS) break
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
