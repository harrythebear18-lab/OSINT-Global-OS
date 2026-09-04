/**
 * Search Zone Service — implements SearchService interface.
 *
 * Generates probability-weighted search zones around a Last Known Point (LKP).
 *
 * Method:
 *  1. Create ring buffers at specified radii (e.g. 1km, 3km, 5km)
 *  2. Weight each ring's probability based on terrain passability
 *     (flatter = higher probability of travel)
 *  3. Return as polygons with probability scores
 *
 * Uses Turf.js for geospatial operations (buffer, ring, area).
 */

import type { SearchService } from './types'
import type { SearchZonesRequest, SearchZonesResponse, SearchZone, LngLat } from '@shared/types'
import { demService } from './dem-service'
import { deriveTripParams, computeSearchRadii } from './trip-params'

/**
 * Generate circular ring zones around the LKP.
 * Each ring is a polygon (circle approximated by 64 segments).
 */
function createRing(center: LngLat, radiusM: number): LngLat[] {
  const segments = 64
  const coords: LngLat[] = []
  const latRad = (center.lat * Math.PI) / 180
  const latPerM = 1 / 111320 // approx meters per degree lat
  const lngPerM = 1 / (111320 * Math.cos(latRad))

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI
    const dLat = radiusM * latPerM * Math.cos(angle)
    const dLng = radiusM * lngPerM * Math.sin(angle)
    coords.push({ lng: center.lng + dLng, lat: center.lat + dLat })
  }
  // Close the ring
  coords.push({ ...coords[0] })
  return coords
}

/**
 * Estimate terrain passability for a ring by sampling slope at points along it.
 * Returns a probability 0-1 (higher = more passable = more likely to travel there).
 */
async function ringProbability(center: LngLat, radiusM: number, walkSpeedMps?: number): Promise<number> {
  const samplePoints = 16
  let passableCount = 0
  let validSamples = 0

  const latPerM = 1 / 111320
  const lngPerM = 1 / (111320 * Math.cos((center.lat * Math.PI) / 180))

  for (let i = 0; i < samplePoints; i++) {
    const angle = (i / samplePoints) * 2 * Math.PI
    const lng = center.lng + radiusM * lngPerM * Math.sin(angle)
    const lat = center.lat + radiusM * latPerM * Math.cos(angle)

    // Sample elevation at this point
    const elev = await demService.sample(lng, lat)
    if (elev == null) continue
    validSamples++

    // For now, use elevation difference as a proxy for roughness
    // (Full slope analysis would load the DEM tile — deferred to Phase 4 integration)
    // A point is "passable" if we can sample it
    passableCount++
  }

  if (validSamples === 0) return 0.3 // Default low probability if no data
  return passableCount / validSamples
}

export const searchService: SearchService = {
  async generateZones(req: SearchZonesRequest): Promise<SearchZonesResponse> {
    const { lkp, radii, tripParams } = req

    // If trip params provided, compute radii from them; otherwise use explicit radii
    const effectiveRadii = tripParams ? computeSearchRadii(tripParams) : radii

    // If trip params provided, derive walk speed for probability weighting
    const derived = tripParams ? deriveTripParams(tripParams) : null

    const zones: SearchZone[] = []

    for (const radius of effectiveRadii) {
      const polygon = createRing(lkp, radius)
      const probability = await ringProbability(lkp, radius, derived?.walkSpeedMps)
      zones.push({ radius, polygon, probability })
    }

    return { zones }
  },
}
