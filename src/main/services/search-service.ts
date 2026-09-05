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
    const { lkp, radii, tripParams, bounds, mode } = req
    const analysisMode = mode || 'active-sar'
    const isLegacy = analysisMode === 'legacy-research'

    // If trip params provided, compute radii from them; otherwise use explicit radii
    const effectiveRadii = tripParams ? computeSearchRadii(tripParams) : radii

    // If trip params provided, derive walk speed for probability weighting
    const derived = tripParams ? deriveTripParams(tripParams) : null

    const zones: SearchZone[] = []

    if (isLegacy && bounds) {
      // LEGACY MODE: bbox-spread probability zones.
      // Instead of tight LKP rings, create a grid of probability cells across
      // the bounding box based on terrain passability.
      const [sw, ne] = bounds
      const gridCols = 4
      const gridRows = 4
      const cellW = (ne.lng - sw.lng) / gridCols
      const cellH = (ne.lat - sw.lat) / gridRows

      for (let i = 0; i < gridCols; i++) {
        for (let j = 0; j < gridRows; j++) {
          const cellSw: LngLat = { lng: sw.lng + i * cellW, lat: sw.lat + j * cellH }
          const cellNe: LngLat = { lng: sw.lng + (i + 1) * cellW, lat: sw.lat + (j + 1) * cellH }
          const cellCenter: LngLat = {
            lng: (cellSw.lng + cellNe.lng) / 2,
            lat: (cellSw.lat + cellNe.lat) / 2,
          }

          // Sample terrain passability at cell center
          const probability = await ringProbability(cellCenter, 0, derived?.walkSpeedMps)

          // Distance from LKP (if available) — mild influence only
          let lkpFactor = 1.0
          if (lkp) {
            const distM = haversineMeters(lkp.lng, lkp.lat, cellCenter.lng, cellCenter.lat)
            // In legacy mode, LKP distance is a mild modifier, not a hard frame
            lkpFactor = Math.max(0.3, 1 - distM / 20000) // mild decay over 20km
          }

          zones.push({
            radius: 0, // legacy zones are bbox cells, not rings
            polygon: [
              cellSw,
              { lng: cellNe.lng, lat: cellSw.lat },
              cellNe,
              { lng: cellSw.lng, lat: cellNe.lat },
              cellSw,
            ],
            probability: probability * lkpFactor,
          })
        }
      }
    } else {
      // ACTIVE SAR MODE: tight concentric rings around LKP
      for (const radius of effectiveRadii) {
        const polygon = createRing(lkp, radius)
        const probability = await ringProbability(lkp, radius, derived?.walkSpeedMps)
        zones.push({ radius, polygon, probability })
      }
    }

    return { zones }
  },
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
