/**
 * Water Service — fetches water bodies from OpenStreetMap via Overpass API.
 *
 * Free, no key, no auth. Queries Overpass for natural water features
 * within a bounding box and returns them as polygons/lines for:
 *  - Rest point water proximity scoring
 *  - Map overlay rendering
 *
 * Features fetched:
 *  - waterway (streams, rivers, canals)
 *  - natural=water (lakes, ponds, reservoirs)
 *  - natural=spring (water sources)
 *  - natural=wetland
 */

import type { LngLat } from '@shared/types'

export interface WaterFeature {
  id: string
  type: 'stream' | 'river' | 'lake' | 'pond' | 'spring' | 'wetland' | 'reservoir'
  coords: LngLat[]
  name?: string
}

export interface WaterResponse {
  features: WaterFeature[]
  bounds: [LngLat, LngLat]
}

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
]

/**
 * Query Overpass for water features within a bounding box.
 * Tries multiple Overpass servers for reliability.
 */
export async function fetchWaterFeatures(bounds: [LngLat, LngLat]): Promise<WaterResponse> {
  const [sw, ne] = bounds
  // Overpass uses [south, west, north, east]
  const bbox = `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`

  const query = `
    [out:json][timeout:30];
    (
      way["natural"="water"](${bbox});
      relation["natural"="water"](${bbox});
      way["waterway"](${bbox});
      node["natural"="spring"](${bbox});
      way["natural"="wetland"](${bbox});
    );
    out geom;
  `

  let lastError: Error | null = null

  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        lastError = new Error(`Overpass ${url} returned ${res.status}`)
        continue
      }

      const data = await res.json()
      const features = parseOverpassResponse(data)
      return { features, bounds }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      continue
    }
  }

  // All servers failed — return empty rather than crashing
  console.error('All Overpass servers failed:', lastError?.message)
  return { features: [], bounds }
}

/**
 * Parse Overpass JSON response into WaterFeature[].
 */
function parseOverpassResponse(data: { elements?: OverpassElement[] }): WaterFeature[] {
  const features: WaterFeature[] = []
  if (!data.elements) return features

  for (const el of data.elements) {
    if (el.type === 'node') {
      // Spring — single point
      if (el.tags?.natural === 'spring') {
        features.push({
          id: `spring-${el.id}`,
          type: 'spring',
          coords: [{ lng: el.lon ?? 0, lat: el.lat ?? 0 }],
          name: el.tags?.name,
        })
      }
      continue
    }

    if (el.type === 'way' && el.geometry) {
      const coords: LngLat[] = el.geometry.map((g) => ({ lng: g.lon, lat: g.lat }))
      const tags = el.tags || {}
      let type: WaterFeature['type'] = 'stream'

      if (tags.waterway === 'river') type = 'river'
      else if (tags.waterway === 'stream') type = 'stream'
      else if (tags.waterway === 'canal') type = 'stream'
      else if (tags.natural === 'water') {
        type = tags.water === 'lake' ? 'lake' : tags.water === 'pond' ? 'pond' : tags.water === 'reservoir' ? 'reservoir' : 'lake'
      } else if (tags.natural === 'wetland') type = 'wetland'

      features.push({
        id: `${el.type}-${el.id}`,
        type,
        coords,
        name: tags.name,
      })
    }

    if (el.type === 'relation' && el.members) {
      // Relations (lakes with multiple ways) — just use the outer members
      for (const member of el.members) {
        if (member.role === 'outer' && member.geometry) {
          const coords: LngLat[] = member.geometry.map((g) => ({ lng: g.lon, lat: g.lat }))
          features.push({
            id: `rel-${el.id}-${member.ref}`,
            type: 'lake',
            coords,
            name: el.tags?.name,
          })
        }
      }
    }
  }

  return features
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: { ref: number; role: string; type: string; geometry: { lat: number; lon: number }[] }[]
}

/**
 * Compute water proximity score for a point (0-1, 1 = very close to water).
 * Uses haversine distance to nearest water feature.
 *
 * Returns 0 when no water features exist or are too far — do NOT hallucinate
 * water in deserts or when Overpass fails. A score of 0 means "no water nearby"
 * which is the correct answer for arid terrain.
 */
export function waterProximityScore(point: LngLat, features: WaterFeature[], maxDistanceM: number = 500): number {
  // No water features at all = no water. Return 0, not a false positive.
  if (features.length === 0) return 0

  let minDist = Infinity

  for (const f of features) {
    // Skip wetlands — they're not drinkable water sources
    if (f.type === 'wetland') continue
    for (const c of f.coords) {
      const dist = haversineMeters(point.lng, point.lat, c.lng, c.lat)
      minDist = Math.min(minDist, dist)
    }
  }

  // No drinkable water features found = no water
  if (minDist === Infinity) return 0
  if (minDist < 50) return 1.0 // right at water's edge
  if (minDist > maxDistanceM) return 0 // far from water = no water

  // Linear falloff
  return 1.0 - (minDist / maxDistanceM) * 0.8
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
