/**
 * Export Service — converts analysis results to GeoJSON and KML.
 *
 * GeoJSON: standard FeatureCollection format, importable by QGIS, Google Earth, etc.
 * KML: Keyhole Markup Language for direct Google Earth import.
 */

import type {
  LngLat,
  SearchZonesResponse,
  RestPointsResponse,
  RunoffResponse,
  RoutePlanResponse,
  FallRiskResponse,
  RemainsCorridorResponse,
  SlopeAnalysisResponse,
  AnomalyAnalysisResponse,
} from '@shared/types'

interface GeoJSONFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown>
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

/** Convert a list of analysis results into a GeoJSON FeatureCollection. */
export function toGeoJSON(results: Record<string, unknown>): string {
  const features: GeoJSONFeature[] = []

  // Search zones
  const zones = results.zones as SearchZonesResponse | undefined
  if (zones) {
    for (const z of zones.zones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.polygon.map((c) => [c.lng, c.lat])] },
        properties: { type: 'search-zone', radius: z.radius, probability: z.probability },
      })
    }
  }

  // Rest points
  const rest = results.restPoints as RestPointsResponse | undefined
  if (rest) {
    for (const p of rest.points) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { type: 'rest-point', score: p.score, slope: p.slopeScore, water: p.waterScore, shelter: p.shelterScore, distance: p.distanceScore },
      })
    }
  }

  // Runoff
  const runoff = results.runoff as RunoffResponse | undefined
  if (runoff) {
    for (const p of runoff.flowPaths) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: p.coords.map((c) => [c.lng, c.lat]) },
        properties: { type: 'flow-path', accumulation: p.accumulation, dischargeLps: p.dischargeLps },
      })
    }
    for (const p of runoff.poolingAreas) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [p.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'pooling-area', volumeL: p.volumeL, depthM: p.depthM },
      })
    }
    for (const z of runoff.floodRiskZones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: z.coords.map((c) => [c.lng, c.lat]) },
        properties: { type: 'flood-risk', risk: z.risk, reason: z.reason },
      })
    }
  }

  // Route
  const route = results.route as RoutePlanResponse | undefined
  if (route) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.primary.coords.map((c) => [c.lng, c.lat]) },
      properties: { type: 'route-primary', distanceM: route.primary.totalDistanceM, hours: route.primary.estimatedHours, maxFallRisk: route.primary.maxFallRisk },
    })
    for (const alt of route.alternatives) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: alt.coords.map((c) => [c.lng, c.lat]) },
        properties: { type: 'route-alternative', id: alt.id },
      })
    }
    for (const z of route.fallRiskZones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'route-fallrisk', risk: z.risk, level: z.level, reason: z.reason },
      })
    }
  }

  // Fall risk
  const fallRisk = results.fallRisk as FallRiskResponse | undefined
  if (fallRisk) {
    for (const z of fallRisk.zones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'fall-risk', risk: z.risk, level: z.level, reason: z.reason },
      })
    }
  }

  // Remains corridor
  const corridor = results.corridor as RemainsCorridorResponse | undefined
  if (corridor) {
    for (const p of corridor.paths) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: p.coords.map((c) => [c.lng, c.lat]) },
        properties: { type: 'corridor-path', primary: p.primary },
      })
    }
    for (const z of corridor.depositionZones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'deposition-zone', priority: z.priority, depositionType: z.type, reason: z.reason },
      })
    }
    for (const c of corridor.chokePoints) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.coord.lng, c.coord.lat] },
        properties: { type: 'choke-point', reason: c.reason },
      })
    }
    if (corridor.terminalZone) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [corridor.terminalZone.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'terminal-zone', areaKm2: corridor.terminalZone.areaKm2 },
      })
    }
  }

  // Slope bands
  const slope = results.slope as SlopeAnalysisResponse | undefined
  if (slope) {
    for (const b of slope.bands) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [b.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'slope-band', slopeDeg: b.slopeDeg, class: b.class },
      })
    }
  }

  // Anomaly zones
  const anomaly = results.anomaly as AnomalyAnalysisResponse | undefined
  if (anomaly) {
    for (const z of anomaly.zones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'anomaly', strength: z.strength, anomalyType: z.type, sizeM: z.sizeM },
      })
    }
  }

  const fc: GeoJSONFeatureCollection = { type: 'FeatureCollection', features }
  return JSON.stringify(fc, null, 2)
}

/** Convert analysis results to KML for Google Earth. */
export function toKML(results: Record<string, unknown>): string {
  const features = JSON.parse(toGeoJSON(results)) as GeoJSONFeatureCollection
  const styles = `
    <Style id="search-zone"><LineStyle><color>ff00aaff</color><width>2</width></LineStyle><PolyStyle><color>3300aaff</color></PolyStyle></Style>
    <Style id="rest-point"><IconStyle><color>ffff6644</color><scale>1.0</scale></IconStyle></Style>
    <Style id="flow-path"><LineStyle><color>ff00b4d8</color><width>2</width></LineStyle></Style>
    <Style id="route-primary"><LineStyle><color>ff00ff88</color><width>3</width></LineStyle></Style>
    <Style id="route-alt"><LineStyle><color>ff888888</color><width>2</width></LineStyle></Style>
    <Style id="fall-risk"><LineStyle><color>ff0000ff</color><width>2</width></LineStyle><PolyStyle><color>330000ff</color></PolyStyle></Style>
    <Style id="corridor"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>
    <Style id="deposition"><LineStyle><color>ff00ffff</color><width>2</width></LineStyle><PolyStyle><color>3300ffff</color></PolyStyle></Style>
    <Style id="slope-band"><LineStyle><color>ff3636d9</color><width>1</width></LineStyle><PolyStyle><color>333636d9</color></PolyStyle></Style>
    <Style id="anomaly"><LineStyle><color>ffffff00</color><width>1</width></LineStyle><PolyStyle><color>33ffff00</color></PolyStyle></Style>
  `

  let placemarks = ''
  for (const f of features.features) {
    const type = f.properties.type as string
    const styleUrl = `#${type}`
    const desc = Object.entries(f.properties)
      .filter(([k]) => k !== 'type')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')

    if (f.geometry.type === 'Point') {
      const coords = f.geometry.coordinates as number[]
      placemarks += `<Placemark><name>${type}</name><styleUrl>${styleUrl}</styleUrl><description>${desc}</description><Point><coordinates>${coords[0]},${coords[1]},0</coordinates></Point></Placemark>`
    } else if (f.geometry.type === 'LineString') {
      const coords = f.geometry.coordinates as number[][]
      const kmlCoords = coords.map((c) => `${c[0]},${c[1]},0`).join(' ')
      placemarks += `<Placemark><name>${type}</name><styleUrl>${styleUrl}</styleUrl><description>${desc}</description><LineString><coordinates>${kmlCoords}</coordinates></LineString></Placemark>`
    } else if (f.geometry.type === 'Polygon') {
      const rings = f.geometry.coordinates as number[][][]
      const kmlCoords = rings[0].map((c) => `${c[0]},${c[1]},0`).join(' ')
      placemarks += `<Placemark><name>${type}</name><styleUrl>${styleUrl}</styleUrl><description>${desc}</description><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>Terrain Scout Export</name>
${styles}
${placemarks}
</Document>
</kml>`
}
