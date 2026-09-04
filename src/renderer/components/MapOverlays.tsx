import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useMap } from '../hooks/useMap'
import { useSearchZones, useRestPoints } from '../hooks/useAnalysis'
import type { FeatureCollection, Feature, Polygon, Point } from 'geojson'

/**
 * Map overlays — renders analysis results as MapLibre layers.
 *  - Search zones: translucent ring polygons
 *  - Rest points: circle markers sized by score
 *
 * Reads from the same hooks as AnalysisPanel (shared state via context
 * would be cleaner, but for now we pass results through a simple event bus).
 */

// Simple shared state via window events (same pattern as selection)
// Fall point marker rendering is now handled by the unified MarkerLayer component.

interface AnalysisResults {
  zones?: { zones: { radius: number; polygon: { lng: number; lat: number }[]; probability: number }[] }
  restPoints?: { points: { id: string; lng: number; lat: number; score: number; slopeScore: number; waterScore: number; shelterScore: number; distanceScore: number }[] }
  runoff?: {
    flowPaths: { id: string; coords: { lng: number; lat: number }[]; accumulation: number; dischargeLps: number }[]
    poolingAreas: { id: string; coords: { lng: number; lat: number }[]; volumeL: number; depthM: number }[]
    watershedDivides: { id: string; coords: { lng: number; lat: number }[]; label: string; areaKm2: number }[]
    floodRiskZones: { id: string; coords: { lng: number; lat: number }[]; risk: number; reason: string }[]
  }
  route?: {
    primary: { id: string; coords: { lng: number; lat: number }[]; totalDistanceM: number; estimatedHours: number; maxFallRisk: number; hasDangerSections: boolean }
    alternatives: { id: string; coords: { lng: number; lat: number }[] }[]
    fallRiskZones: { id: string; coords: { lng: number; lat: number }[]; risk: number; level: string; reason: string }[]
  }
  fallRisk?: {
    zones: { id: string; coords: { lng: number; lat: number }[]; risk: number; level: string; reason: string }[]
  }
  corridor?: {
    paths: { id: string; coords: { lng: number; lat: number }[]; primary: boolean }[]
    depositionZones: { id: string; coords: { lng: number; lat: number }[]; priority: number; type: string; reason: string }[]
    chokePoints: { id: string; coord: { lng: number; lat: number }; reason: string }[]
    terminalZone: { coords: { lng: number; lat: number }[]; areaKm2: number } | null
  }
  slope?: {
    bands: { id: string; coords: { lng: number; lat: number }[]; slopeDeg: number; class: string }[]
    legend: { deg: number; label: string; color: string }[]
  }
  anomaly?: {
    zones: { id: string; coords: { lng: number; lat: number }[]; strength: number; type: string; sizeM: number }[]
  }
  water?: {
    features: { id: string; type: string; coords: { lng: number; lat: number }[]; name?: string }[]
  }
  sentinel?: {
    tileUrl: string
    id: string
  }
  imported?: {
    features: { id: string; name: string; type: 'point' | 'line' | 'polygon'; coords: { lng: number; lat: number }[]; styleColor?: string }[]
  }
}

let sharedResults: AnalysisResults = {}

export function setAnalysisResults(results: AnalysisResults) {
  sharedResults = results
  window.dispatchEvent(new CustomEvent('terrain:analysis-results'))
}

export function clearAnalysisResults() {
  sharedResults = {}
}

export function MapOverlays() {
  const { map } = useMap()

  // Clear shared results when "Clear Map" is pressed.
  // The actual layer/source removal is handled by MapProvider.clearMap(),
  // but we also need to wipe sharedResults so stale data doesn't reappear
  // if the user runs a new partial analysis.
  useEffect(() => {
    const handler = () => { clearAnalysisResults() }
    window.addEventListener('terrain:clear-all', handler)
    return () => window.removeEventListener('terrain:clear-all', handler)
  }, [])

  useEffect(() => {
    if (!map) return

    const renderOverlays = () => {
      const results = sharedResults

      // --- Search Zones ---
      if (results.zones && results.zones.zones.length > 0) {
        const features: Feature<Polygon>[] = results.zones.zones.map((z, i) => ({
          type: 'Feature',
          properties: { radius: z.radius, probability: z.probability, index: i },
          geometry: {
            type: 'Polygon',
            coordinates: [z.polygon.map((p) => [p.lng, p.lat])],
          },
        }))

        const fc: FeatureCollection = { type: 'FeatureCollection', features }

        if (map.getSource('search-zones')) {
          ;(map.getSource('search-zones') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('search-zones', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'search-zones-fill',
            type: 'fill',
            source: 'search-zones',
            paint: {
              'fill-color': '#ff8c42',
              'fill-opacity': ['interpolate', ['linear'], ['get', 'probability'], 0, 0.05, 1, 0.25],
            },
          })
          map.addLayer({
            id: 'search-zones-outline',
            type: 'line',
            source: 'search-zones',
            paint: { 'line-color': '#ff8c42', 'line-width': 1.5, 'line-dasharray': [3, 2] },
          })
        }
      }

      // --- Rest Points ---
      if (results.restPoints && results.restPoints.points.length > 0) {
        const features: Feature<Point>[] = results.restPoints.points.map((p) => ({
          type: 'Feature',
          properties: {
            id: p.id,
            score: p.score,
            slopeScore: p.slopeScore,
            waterScore: p.waterScore,
            shelterScore: p.shelterScore,
            distanceScore: p.distanceScore,
          },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        }))

        const fc: FeatureCollection = { type: 'FeatureCollection', features }

        if (map.getSource('rest-points')) {
          ;(map.getSource('rest-points') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('rest-points', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'rest-points-circle',
            type: 'circle',
            source: 'rest-points',
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0.4, 4, 1, 10],
              'circle-color': '#4ea1ff',
              'circle-stroke-color': '#fff',
              'circle-stroke-width': 1.5,
              'circle-opacity': 0.85,
            },
          })

          // Popups on click
          const popup = new maplibregl.Popup({ closeButton: false, offset: 12 })
          map.on('click', 'rest-points-circle', (e) => {
            const f = e.features?.[0]
            if (!f) return
            const p = f.properties
            const html = `
              <div class="rest-popup">
                <div class="rest-popup-score">Score: ${(p.score * 100).toFixed(0)}%</div>
                <div class="rest-popup-breakdown">
                  <span>Slope: ${(p.slopeScore * 100).toFixed(0)}%</span>
                  <span>Water: ${(p.waterScore * 100).toFixed(0)}%</span>
                  <span>Shelter: ${(p.shelterScore * 100).toFixed(0)}%</span>
                  <span>Distance: ${(p.distanceScore * 100).toFixed(0)}%</span>
                </div>
              </div>
            `
            popup.setHTML(html).setLngLat(e.lngLat).addTo(map)
          })
          map.on('mouseenter', 'rest-points-circle', () => {
            map.getCanvas().style.cursor = 'pointer'
          })
          map.on('mouseleave', 'rest-points-circle', () => {
            map.getCanvas().style.cursor = ''
          })
        }
      }

      // --- Runoff: Flow paths (streams) ---
      if (results.runoff && results.runoff.flowPaths.length > 0) {
        const features: Feature = {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiLineString',
            coordinates: results.runoff.flowPaths.map((p) => p.coords.map((c) => [c.lng, c.lat])),
          },
        }
        if (map.getSource('runoff-flow')) {
          ;(map.getSource('runoff-flow') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [features] })
        } else {
          map.addSource('runoff-flow', { type: 'geojson', data: { type: 'FeatureCollection', features: [features] } })
          map.addLayer({
            id: 'runoff-flow-line',
            type: 'line',
            source: 'runoff-flow',
            paint: {
              'line-color': '#00b4d8',
              'line-width': 2,
              'line-opacity': 0.7,
            },
          })
        }
      }

      // --- Runoff: Pooling areas ---
      if (results.runoff && results.runoff.poolingAreas.length > 0) {
        const features: Feature<Polygon>[] = results.runoff.poolingAreas.map((p) => ({
          type: 'Feature',
          properties: { volumeL: p.volumeL, depthM: p.depthM },
          geometry: { type: 'Polygon', coordinates: [p.coords.map((c) => [c.lng, c.lat])] },
        }))
        const fc: FeatureCollection = { type: 'FeatureCollection', features }
        if (map.getSource('runoff-pools')) {
          ;(map.getSource('runoff-pools') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('runoff-pools', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'runoff-pools-fill',
            type: 'fill',
            source: 'runoff-pools',
            paint: { 'fill-color': '#0077b6', 'fill-opacity': 0.4 },
          })
        }
      }

      // --- Runoff: Flood risk zones ---
      if (results.runoff && results.runoff.floodRiskZones.length > 0) {
        const features: Feature = {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiLineString',
            coordinates: results.runoff.floodRiskZones.map((z) => z.coords.map((c) => [c.lng, c.lat])),
          },
        }
        if (map.getSource('runoff-flood')) {
          ;(map.getSource('runoff-flood') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [features] })
        } else {
          map.addSource('runoff-flood', { type: 'geojson', data: { type: 'FeatureCollection', features: [features] } })
          map.addLayer({
            id: 'runoff-flood-line',
            type: 'line',
            source: 'runoff-flood',
            paint: {
              'line-color': '#ff0000',
              'line-width': 3,
              'line-opacity': 0.6,
              'line-dasharray': [4, 2],
            },
          })
        }
      }

      // --- Runoff: Watershed divides ---
      if (results.runoff && results.runoff.watershedDivides.length > 0) {
        const features: Feature<Polygon>[] = results.runoff.watershedDivides.map((w) => ({
          type: 'Feature',
          properties: { label: w.label, areaKm2: w.areaKm2 },
          geometry: { type: 'Polygon', coordinates: [w.coords.map((c) => [c.lng, c.lat])] },
        }))
        const fc: FeatureCollection = { type: 'FeatureCollection', features }
        if (map.getSource('runoff-watersheds')) {
          ;(map.getSource('runoff-watersheds') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('runoff-watersheds', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'runoff-watersheds-outline',
            type: 'line',
            source: 'runoff-watersheds',
            paint: { 'line-color': '#90e0ef', 'line-width': 1.5, 'line-dasharray': [6, 3], 'line-opacity': 0.5 },
          })
        }
      }

      // --- Route: Primary path ---
      if (results.route && results.route.primary.coords.length > 0) {
        const features: Feature[] = [
          {
            type: 'Feature',
            properties: { type: 'primary' },
            geometry: { type: 'LineString', coordinates: results.route.primary.coords.map((c) => [c.lng, c.lat]) },
          },
          ...results.route.alternatives.map((a) => ({
            type: 'Feature' as const,
            properties: { type: 'alternative' },
            geometry: { type: 'LineString' as const, coordinates: a.coords.map((c: { lng: number; lat: number }) => [c.lng, c.lat]) },
          })),
        ]
        if (map.getSource('route-plan')) {
          ;(map.getSource('route-plan') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
        } else {
          map.addSource('route-plan', { type: 'geojson', data: { type: 'FeatureCollection', features } })
          map.addLayer({
            id: 'route-alt-line',
            type: 'line',
            source: 'route-plan',
            filter: ['==', ['get', 'type'], 'alternative'],
            paint: { 'line-color': '#888', 'line-width': 2, 'line-dasharray': [4, 3], 'line-opacity': 0.5 },
          })
          map.addLayer({
            id: 'route-primary-line',
            type: 'line',
            source: 'route-plan',
            filter: ['==', ['get', 'type'], 'primary'],
            paint: { 'line-color': '#00ff88', 'line-width': 3, 'line-opacity': 0.8 },
          })

          // Click on primary route to set fall point
          map.on('click', 'route-primary-line', (e) => {
            if (!e.lngLat) return
            const point = { lng: e.lngLat.lng, lat: e.lngLat.lat }
            window.dispatchEvent(new CustomEvent('terrain:fallpoint', { detail: point }))
            // Marker rendering handled by MarkerLayer component
          })
          map.on('mouseenter', 'route-primary-line', () => {
            map.getCanvas().style.cursor = 'crosshair'
          })
          map.on('mouseleave', 'route-primary-line', () => {
            map.getCanvas().style.cursor = ''
          })
        }
      }

      // --- Route: Fall risk zones along path ---
      if (results.route && results.route.fallRiskZones.length > 0) {
        const features: Feature<Polygon>[] = results.route.fallRiskZones.map((z) => ({
          type: 'Feature',
          properties: { risk: z.risk, level: z.level, reason: z.reason },
          geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        }))
        const fc: FeatureCollection = { type: 'FeatureCollection', features }
        if (map.getSource('route-fallrisk')) {
          ;(map.getSource('route-fallrisk') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('route-fallrisk', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'route-fallrisk-fill',
            type: 'fill',
            source: 'route-fallrisk',
            paint: {
              'fill-color': ['match', ['get', 'level'], 'extreme', '#ff0000', 'high', '#ff6600', 'medium', '#ffaa00', '#ffff00'],
              'fill-opacity': 0.3,
            },
          })
        }
      }

      // --- Fall risk zones (standalone) ---
      if (results.fallRisk && results.fallRisk.zones.length > 0) {
        const features: Feature<Polygon>[] = results.fallRisk.zones.map((z) => ({
          type: 'Feature',
          properties: { risk: z.risk, level: z.level, reason: z.reason },
          geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        }))
        const fc: FeatureCollection = { type: 'FeatureCollection', features }
        if (map.getSource('fallrisk-zones')) {
          ;(map.getSource('fallrisk-zones') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('fallrisk-zones', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'fallrisk-zones-fill',
            type: 'fill',
            source: 'fallrisk-zones',
            paint: {
              'fill-color': ['match', ['get', 'level'], 'extreme', '#ff0000', 'high', '#ff6600', 'medium', '#ffaa00', '#ffff00'],
              'fill-opacity': 0.25,
            },
          })
          map.addLayer({
            id: 'fallrisk-zones-outline',
            type: 'line',
            source: 'fallrisk-zones',
            paint: { 'line-color': '#ff0000', 'line-width': 1, 'line-opacity': 0.5 },
          })
        }
      }

      // --- Remains corridor: paths ---
      if (results.corridor && results.corridor.paths.length > 0) {
        const features: Feature[] = results.corridor.paths.map((p) => ({
          type: 'Feature',
          properties: { primary: p.primary },
          geometry: { type: 'LineString', coordinates: p.coords.map((c) => [c.lng, c.lat]) },
        }))
        if (map.getSource('corridor-paths')) {
          ;(map.getSource('corridor-paths') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
        } else {
          map.addSource('corridor-paths', { type: 'geojson', data: { type: 'FeatureCollection', features } })
          map.addLayer({
            id: 'corridor-paths-secondary',
            type: 'line',
            source: 'corridor-paths',
            filter: ['!=', ['get', 'primary'], true],
            paint: { 'line-color': '#ff4444', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.4 },
          })
          map.addLayer({
            id: 'corridor-paths-primary',
            type: 'line',
            source: 'corridor-paths',
            filter: ['==', ['get', 'primary'], true],
            paint: { 'line-color': '#ff0000', 'line-width': 3, 'line-opacity': 0.7 },
          })
        }
      }

      // --- Remains corridor: deposition zones ---
      if (results.corridor && results.corridor.depositionZones.length > 0) {
        const features: Feature<Polygon>[] = results.corridor.depositionZones.map((z) => ({
          type: 'Feature',
          properties: { priority: z.priority, type: z.type, reason: z.reason },
          geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        }))
        const fc: FeatureCollection = { type: 'FeatureCollection', features }
        if (map.getSource('corridor-deposition')) {
          ;(map.getSource('corridor-deposition') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('corridor-deposition', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'corridor-deposition-fill',
            type: 'fill',
            source: 'corridor-deposition',
            paint: {
              'fill-color': ['match', ['get', 'type'], 'fan', '#ff00ff', 'basin', '#ff6600', 'shelf', '#ffaa00', 'snag', '#ffff00', 'confluence', '#00ffff', '#888'],
              'fill-opacity': ['interpolate', ['linear'], ['get', 'priority'], 0, 0.2, 1, 0.5],
            },
          })
        }
      }

      // --- Remains corridor: choke points ---
      if (results.corridor && results.corridor.chokePoints.length > 0) {
        const features: Feature<Point>[] = results.corridor.chokePoints.map((c) => ({
          type: 'Feature',
          properties: { reason: c.reason },
          geometry: { type: 'Point', coordinates: [c.coord.lng, c.coord.lat] },
        }))
        const fc: FeatureCollection = { type: 'FeatureCollection', features }
        if (map.getSource('corridor-chokes')) {
          ;(map.getSource('corridor-chokes') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('corridor-chokes', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'corridor-chokes-circle',
            type: 'circle',
            source: 'corridor-chokes',
            paint: {
              'circle-radius': 6,
              'circle-color': '#ff0000',
              'circle-stroke-color': '#fff',
              'circle-stroke-width': 2,
            },
          })
        }
      }

      // --- Remains corridor: terminal zone ---
      if (results.corridor && results.corridor.terminalZone) {
        const feature: Feature<Polygon> = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [results.corridor.terminalZone.coords.map((c) => [c.lng, c.lat])] },
        }
        if (map.getSource('corridor-terminal')) {
          ;(map.getSource('corridor-terminal') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [feature] })
        } else {
          map.addSource('corridor-terminal', { type: 'geojson', data: { type: 'FeatureCollection', features: [feature] } })
          map.addLayer({
            id: 'corridor-terminal-fill',
            type: 'fill',
            source: 'corridor-terminal',
            paint: { 'fill-color': '#ff00ff', 'fill-opacity': 0.2 },
          })
          map.addLayer({
            id: 'corridor-terminal-outline',
            type: 'line',
            source: 'corridor-terminal',
            paint: { 'line-color': '#ff00ff', 'line-width': 2, 'line-dasharray': [5, 3] },
          })
        }
      }

      // --- Slope bands (impassable zones) ---
      if (results.slope && results.slope.bands.length > 0) {
        const features: Feature<Polygon>[] = results.slope.bands.map((b) => ({
          type: 'Feature',
          properties: { slopeDeg: b.slopeDeg, class: b.class },
          geometry: { type: 'Polygon', coordinates: [b.coords.map((c) => [c.lng, c.lat])] },
        }))
        const fc: FeatureCollection = { type: 'FeatureCollection', features }
        if (map.getSource('slope-bands')) {
          ;(map.getSource('slope-bands') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('slope-bands', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'slope-bands-fill',
            type: 'fill',
            source: 'slope-bands',
            paint: {
              'fill-color': ['match', ['get', 'class'], 'impassable', '#d93636', 'steep', '#e8893a', '#e8c547'],
              'fill-opacity': 0.3,
            },
          })
          map.addLayer({
            id: 'slope-bands-outline',
            type: 'line',
            source: 'slope-bands',
            paint: { 'line-color': '#d93636', 'line-width': 1, 'line-opacity': 0.5 },
          })
        }
      }

      // --- Anomaly zones ---
      if (results.anomaly && results.anomaly.zones.length > 0) {
        const features: Feature<Polygon>[] = results.anomaly.zones.map((z) => ({
          type: 'Feature',
          properties: { strength: z.strength, type: z.type, sizeM: z.sizeM },
          geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        }))
        const fc: FeatureCollection = { type: 'FeatureCollection', features }
        if (map.getSource('anomaly-zones')) {
          ;(map.getSource('anomaly-zones') as maplibregl.GeoJSONSource).setData(fc)
        } else {
          map.addSource('anomaly-zones', { type: 'geojson', data: fc })
          map.addLayer({
            id: 'anomaly-zones-fill',
            type: 'fill',
            source: 'anomaly-zones',
            paint: {
              'fill-color': ['match', ['get', 'type'], 'depression', '#9b59b6', 'prominence', '#f1c40f', '#888'],
              'fill-opacity': ['interpolate', ['linear'], ['get', 'strength'], 2, 0.15, 5, 0.4],
            },
          })
          map.addLayer({
            id: 'anomaly-zones-outline',
            type: 'line',
            source: 'anomaly-zones',
            paint: { 'line-color': '#ffff00', 'line-width': 1, 'line-opacity': 0.6 },
          })
        }
      }

      // --- Water features (OSM Overpass) ---
      if (results.water && results.water.features.length > 0) {
        const lineFeatures: Feature[] = []
        const polyFeatures: Feature<Polygon>[] = []
        const pointFeatures: Feature<Point>[] = []

        for (const f of results.water.features) {
          if (f.type === 'stream' || f.type === 'river') {
            lineFeatures.push({
              type: 'Feature',
              properties: { type: f.type, name: f.name || '' },
              geometry: { type: 'LineString', coordinates: f.coords.map((c) => [c.lng, c.lat]) },
            })
          } else if (f.type === 'spring') {
            pointFeatures.push({
              type: 'Feature',
              properties: { type: 'spring', name: f.name || '' },
              geometry: { type: 'Point', coordinates: [f.coords[0].lng, f.coords[0].lat] },
            })
          } else {
            // Lakes, ponds, wetlands, reservoirs — polygons
            polyFeatures.push({
              type: 'Feature',
              properties: { type: f.type, name: f.name || '' },
              geometry: { type: 'Polygon', coordinates: [f.coords.map((c) => [c.lng, c.lat])] },
            })
          }
        }

        // Water lines (streams/rivers)
        if (lineFeatures.length > 0) {
          if (map.getSource('water-lines')) {
            ;(map.getSource('water-lines') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: lineFeatures })
          } else {
            map.addSource('water-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeatures } })
            map.addLayer({
              id: 'water-lines-layer',
              type: 'line',
              source: 'water-lines',
              paint: { 'line-color': '#0099ff', 'line-width': 2, 'line-opacity': 0.7 },
            })
          }
        }

        // Water polygons (lakes/ponds)
        if (polyFeatures.length > 0) {
          if (map.getSource('water-polygons')) {
            ;(map.getSource('water-polygons') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: polyFeatures })
          } else {
            map.addSource('water-polygons', { type: 'geojson', data: { type: 'FeatureCollection', features: polyFeatures } })
            map.addLayer({
              id: 'water-polygons-fill',
              type: 'fill',
              source: 'water-polygons',
              paint: { 'fill-color': '#0099ff', 'fill-opacity': 0.4 },
            })
          }
        }

        // Springs (points)
        if (pointFeatures.length > 0) {
          if (map.getSource('water-springs')) {
            ;(map.getSource('water-springs') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: pointFeatures })
          } else {
            map.addSource('water-springs', { type: 'geojson', data: { type: 'FeatureCollection', features: pointFeatures } })
            map.addLayer({
              id: 'water-springs-circle',
              type: 'circle',
              source: 'water-springs',
              paint: { 'circle-radius': 5, 'circle-color': '#00ddff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
            })
          }
        }
      }

      // --- Satellite imagery (NASA GIBS) ---
      // GIBS serves stable XYZ tiles — no scene IDs, no 404s, no error handling needed
      if (results.sentinel && results.sentinel.tileUrl) {
        const sourceId = 'sentinel-imagery'
        if (map.getSource(sourceId)) {
          if (map.getLayer('sentinel-imagery-layer')) map.removeLayer('sentinel-imagery-layer')
          map.removeSource(sourceId)
        }
        map.addSource(sourceId, {
          type: 'raster',
          tiles: [results.sentinel.tileUrl],
          tileSize: 256,
        })
        map.addLayer({
          id: 'sentinel-imagery-layer',
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': 0.75 },
        }, 'satellite-layer')
      }

      // --- Imported KML/KMZ features ---
      if (results.imported && results.imported.features.length > 0) {
        const pointFeatures: Feature<Point>[] = []
        const lineFeatures: Feature[] = []
        const polyFeatures: Feature<Polygon>[] = []

        for (const f of results.imported.features) {
          const color = f.styleColor || '#ff8800'
          if (f.type === 'point') {
            pointFeatures.push({
              type: 'Feature',
              properties: { name: f.name, color },
              geometry: { type: 'Point', coordinates: [f.coords[0].lng, f.coords[0].lat] },
            })
          } else if (f.type === 'line') {
            lineFeatures.push({
              type: 'Feature',
              properties: { name: f.name, color },
              geometry: { type: 'LineString', coordinates: f.coords.map((c) => [c.lng, c.lat]) },
            })
          } else {
            polyFeatures.push({
              type: 'Feature',
              properties: { name: f.name, color },
              geometry: { type: 'Polygon', coordinates: [f.coords.map((c) => [c.lng, c.lat])] },
            })
          }
        }

        if (pointFeatures.length > 0) {
          if (map.getSource('import-points')) {
            ;(map.getSource('import-points') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: pointFeatures })
          } else {
            map.addSource('import-points', { type: 'geojson', data: { type: 'FeatureCollection', features: pointFeatures } })
            map.addLayer({
              id: 'import-points-circle',
              type: 'circle',
              source: 'import-points',
              paint: {
                'circle-radius': 6,
                'circle-color': ['get', 'color'],
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 2,
              },
            })
            // Popup on click
            const popup = new maplibregl.Popup({ closeButton: false, offset: 12 })
            map.on('click', 'import-points-circle', (e) => {
              const f = e.features?.[0]
              if (!f) return
              popup.setHTML('<div style="font-size:11px;padding:4px"><strong>' + f.properties.name + '</strong></div>').setLngLat(e.lngLat).addTo(map)
            })
            map.on('mouseenter', 'import-points-circle', () => { map.getCanvas().style.cursor = 'pointer' })
            map.on('mouseleave', 'import-points-circle', () => { map.getCanvas().style.cursor = '' })
          }
        }

        if (lineFeatures.length > 0) {
          if (map.getSource('import-lines')) {
            ;(map.getSource('import-lines') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: lineFeatures })
          } else {
            map.addSource('import-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeatures } })
            map.addLayer({
              id: 'import-lines-layer',
              type: 'line',
              source: 'import-lines',
              paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.8 },
            })
          }
        }

        if (polyFeatures.length > 0) {
          if (map.getSource('import-polys')) {
            ;(map.getSource('import-polys') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: polyFeatures })
          } else {
            map.addSource('import-polys', { type: 'geojson', data: { type: 'FeatureCollection', features: polyFeatures } })
            map.addLayer({
              id: 'import-polys-fill',
              type: 'fill',
              source: 'import-polys',
              paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 },
            })
            map.addLayer({
              id: 'import-polys-outline',
              type: 'line',
              source: 'import-polys',
              paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.8 },
            })
          }
        }
      }
    }

    window.addEventListener('terrain:analysis-results', renderOverlays)
    return () => window.removeEventListener('terrain:analysis-results', renderOverlays)
  }, [map])

  return null
}
