/**
 * Rest Point Service — implements RestPointService interface.
 *
 * Predicts likely rest points based on terrain + human behavior model.
 *
 * Scoring inputs (each 0-1, weighted equally for now):
 *  - slopeScore:     lower slope = better resting spot (< 10° ideal)
 *  - waterScore:     proximity to water (OSM hydrology — stubbed for now)
 *  - shelterScore:   sheltered from wind (low anomaly / depression = sheltered)
 *  - distanceScore:  within reasonable walking distance of LKP (~2hr walk)
 *
 * Combined score = weighted average. Points ranked by score.
 *
 * Method:
 *  1. Sample a grid of candidate points around the LKP
 *  2. Score each point
 *  3. Filter by minimum score threshold
 *  4. Cluster nearby high-score points (NMS — non-maximum suppression)
 *  5. Return top N points with full score breakdown
 */

import type { RestPointService } from './types'
import type { RestPointsRequest, RestPointsResponse, RestPoint, TripParams } from '@shared/types'
import { demService } from './dem-service'
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

export const restPointService: RestPointService = {
  async find(req: RestPointsRequest): Promise<RestPointsResponse> {
    const { lkp, maxHours, tripParams } = req

    // Derive walk speed and scoring weights from trip params
    const derived = tripParams ? deriveTripParams(tripParams) : null
    const walkSpeed = derived?.walkSpeedMps ?? BASE_WALK_SPEED_MPS
    const maxDistanceM = walkSpeed * maxHours * 3600

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
    const waterBounds: [import('@shared/types').LngLat, import('@shared/types').LngLat] = [
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

    // Sample a grid of candidate points
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

        // Sample elevation
        const elev = await demService.sample(lng, lat)
        if (elev == null) continue

        // Score: slope (flat = good)
        // Sample a few neighbors to estimate local slope
        const e1 = await demService.sample(lng + 30 * lngPerM, lat)
        const e2 = await demService.sample(lng - 30 * lngPerM, lat)
        const e3 = await demService.sample(lng, lat + 30 * latPerM)
        const e4 = await demService.sample(lng, lat - 30 * latPerM)

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
        // Compare elevation to neighbors — lower = more sheltered
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
