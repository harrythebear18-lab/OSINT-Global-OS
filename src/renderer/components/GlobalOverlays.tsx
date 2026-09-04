import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMap } from '../hooks/useMap'
import { useClimateData } from '../hooks/useClimateData'
import { useGridData } from '../hooks/useGridData'
import { useNetworkData } from '../hooks/useNetworkData'
import type { FeatureCollection, Feature, Point, LineString, Polygon } from 'geojson'

/**
 * GlobalOverlays — renders all weather-radar domain layers on the MapLibre map.
 *
 * This is the MapLibre equivalent of weather-radar's WeatherMap.tsx (Leaflet).
 * All 19+ layers are rendered as GeoJSON sources + styled MapLibre layers.
 *
 * Layer groups:
 *  1. Climate stations (buoys, Argo, weather, CO2)
 *  2. Lightning strikes (color-coded by age)
 *  3. Storm cells + forecast tracks
 *  4. Seismic (earthquakes, magnitude-scaled)
 *  5. Wildfires (brightness-colored)
 *  6. Vessels (AIS positions)
 *  7. Aircraft (ADS-B, altitude-colored, with density heatmap)
 *  8. Prediction overlays (storm cones, severe weather, SST anomalies, precip forecast)
 *  9. Grid assets (power plants, substations, data centers, etc.)
 * 10. Grid interconnects (power flow lines)
 * 11. Network connections (TCP/UDP arcs + user location)
 *
 * Performance: all point layers use MapLibre's native circle/symbol layers
 * which are WebGL-accelerated — no DOM markers. This handles 10k+ points
 * without the hybrid canvas/SVG approach Leaflet needed.
 */

// ─── Layer visibility state (toggled from GlobalLayerPanel) ───

export interface GlobalLayerState {
  // Climate
  climateStations: boolean
  oceanBuoys: boolean
  argoFloats: boolean
  weatherStations: boolean
  carbonStations: boolean
  lightning: boolean
  stormCells: boolean
  stormTracks: boolean
  severeWeather: boolean
  sstAnomalies: boolean
  precipForecast: boolean
  regionTemps: boolean
  // Hazards
  earthquakes: boolean
  wildfires: boolean
  // Traffic
  vessels: boolean
  aircraft: boolean
  aircraftHeatmap: boolean
  // Grid
  powerPlants: boolean
  substations: boolean
  dataCenters: boolean
  aiCenters: boolean
  renewableFarms: boolean
  batteryStorage: boolean
  gridInterconnects: boolean
  // Network
  networkConnections: boolean
  userLocation: boolean
}

export const DEFAULT_LAYER_STATE: GlobalLayerState = {
  climateStations: false,
  oceanBuoys: true,
  argoFloats: false,
  weatherStations: true,
  carbonStations: false,
  lightning: true,
  stormCells: true,
  stormTracks: true,
  severeWeather: true,
  sstAnomalies: false,
  precipForecast: false,
  regionTemps: false,
  earthquakes: true,
  wildfires: true,
  vessels: false,
  aircraft: false,
  aircraftHeatmap: false,
  powerPlants: false,
  substations: false,
  dataCenters: false,
  aiCenters: false,
  renewableFarms: false,
  batteryStorage: false,
  gridInterconnects: false,
  networkConnections: false,
  userLocation: true,
}

// ─── Color constants (ported from weather-radar mapIcons.ts) ───

const STATION_COLORS: Record<string, string> = {
  buoy: '#00ffcc',
  argo_float: '#4fc3f7',
  bgc_argo_float: '#ffaa00',
  carbon_station: '#ff6600',
  weather_station: '#00aa88',
  storm: '#ff3366',
  lightning: '#ffeb3b',
}

const AIRCRAFT_ALT_COLORS: Array<{ max: number; color: string }> = [
  { max: 0, color: '#10b981' },      // ground
  { max: 5000, color: '#f97316' },   // <5k ft
  { max: 15000, color: '#fbbf24' },  // 5-15k
  { max: 30000, color: '#06b6d4' },  // 15-30k
  { max: Infinity, color: '#3b82f6' }, // >30k
]

function aircraftColor(altitudeFt?: number): string {
  if (altitudeFt === undefined) return '#6b7280'
  for (const band of AIRCRAFT_ALT_COLORS) {
    if (altitudeFt <= band.max) return band.color
  }
  return '#3b82f6'
}

const ASSET_TYPE_COLORS: Record<string, string> = {
  power_plant: '#f59e0b',
  substation: '#00ffcc',
  transformer: '#3b82f6',
  renewable: '#10b981',
  battery: '#8b5cf6',
  data_center: '#ec4899',
  ai_center: '#ef4444',
  edge_node: '#84cc16',
}

function wildfireColor(brightness: number): string {
  if (brightness > 350) return '#ef4444'
  if (brightness > 330) return '#f97316'
  return '#fbbf24'
}

function earthquakeColor(mag: number): string {
  if (mag < 3) return '#10b981'
  if (mag < 4.5) return '#fbbf24'
  if (mag < 6) return '#f97316'
  return '#ef4444'
}

function lightningColor(ageSec: number): string {
  if (ageSec < 30) return '#ffffff'
  if (ageSec < 60) return '#ffeb3b'
  if (ageSec < 300) return '#ff9800'
  return '#f44336'
}

function stormIntensityColor(intensity: string): string {
  switch (intensity) {
    case 'light': return '#4fc3f7'
    case 'moderate': return '#ffaa00'
    case 'heavy': return '#ff6600'
    case 'extreme': return '#ff3366'
    default: return '#4fc3f7'
  }
}

// ─── Helper: ensure source exists, update data ───

function isMapAlive(map: maplibregl.Map | null | undefined): map is maplibregl.Map {
  return !!map && !(map as any)._removed
}

function upsertGeoJSONSource(map: maplibregl.Map, id: string, data: FeatureCollection | Feature) {
  if (!isMapAlive(map)) return
  const existing = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  if (existing) {
    existing.setData(data as any)
  } else {
    map.addSource(id, { type: 'geojson', data: data as any })
  }
}

function ensureLayer(map: maplibregl.Map, layer: maplibregl.LayerSpecification, beforeId?: string) {
  if (!isMapAlive(map)) return
  if (!map.getLayer(layer.id)) {
    map.addLayer(layer, beforeId)
  }
}

// ─── Component ───

interface GlobalOverlaysProps {
  layerState: GlobalLayerState
  aircraftAltitudeFilter: { min: number; max: number }
}

export function GlobalOverlays({ layerState, aircraftAltitudeFilter }: GlobalOverlaysProps) {
  const { map } = useMap()
  const climate = useClimateData()
  const grid = useGridData()
  const net = useNetworkData()
  const initialized = useRef(false)

  // Report viewport to backend on map move (for aircraft/vessel culling)
  useEffect(() => {
    if (!isMapAlive(map)) return
    const onMove = () => {
      const b = map.getBounds()
      climate.setViewport({
        n: b.getNorth(),
        s: b.getSouth(),
        e: b.getEast(),
        w: b.getWest(),
      })
    }
    map.on('moveend', onMove)
    onMove() // initial
    return () => { map.off('moveend', onMove) }
  }, [map])

  // ─── Climate stations (buoys, Argo, weather, CO2) ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const update = climate.climateUpdate
    if (!update?.stations) return

    const stations = update.stations as any[]
    const measurements = update.measurements || {}

    const features: Feature<Point>[] = stations.slice(0, 5000).map((s: any) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        type: s.type,
        color: STATION_COLORS[s.type] || '#c0c8d8',
        active: s.active,
        waterTemp: measurements[s.id]?.waterTemp,
        airTemp: measurements[s.id]?.airTemp,
        windSpeed: measurements[s.id]?.windSpeed,
        pressure: measurements[s.id]?.pressure,
      },
    }))

    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    upsertGeoJSONSource(map, 'climate-stations', fc)

    const visible = layerState.climateStations || layerState.oceanBuoys || layerState.argoFloats ||
      layerState.weatherStations || layerState.carbonStations

    if (visible) {
      // Build filter expression based on which sub-toggles are on
      const allowedTypes: string[] = []
      if (layerState.oceanBuoys) allowedTypes.push('buoy')
      if (layerState.argoFloats) allowedTypes.push('argo_float', 'bgc_argo_float')
      if (layerState.weatherStations) allowedTypes.push('weather_station')
      if (layerState.carbonStations) allowedTypes.push('carbon_station')
      if (layerState.climateStations) allowedTypes.push('buoy', 'argo_float', 'bgc_argo_float', 'weather_station', 'carbon_station')

      const filter: any = ['in', ['get', 'type'], ['literal', allowedTypes]]

      ensureLayer(map, {
        id: 'climate-stations-circle',
        type: 'circle',
        source: 'climate-stations',
        filter: allowedTypes.length > 0 ? filter : ['literal', false],
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#000',
          'circle-stroke-width': 1,
          'circle-opacity': 0.8,
        },
      })
      map.setLayoutProperty('climate-stations-circle', 'visibility', 'visible')
    } else if (map.getLayer('climate-stations-circle')) {
      map.setLayoutProperty('climate-stations-circle', 'visibility', 'none')
    }
  }, [map, climate.climateUpdate, layerState.climateStations, layerState.oceanBuoys, layerState.argoFloats, layerState.weatherStations, layerState.carbonStations])

  // ─── Lightning strikes ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const strikes = climate.integrity?.lightningStrikes as any[] | undefined
    if (!strikes) return

    const now = Date.now()
    const features: Feature<Point>[] = strikes.slice(0, 5000).map((s: any) => {
      const ageSec = (now - s.timestamp) / 1000
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          id: s.id,
          color: lightningColor(ageSec),
          ageSec,
          amplitude: s.amplitude || 0,
        },
      }
    })

    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    upsertGeoJSONSource(map, 'lightning-strikes', fc)

    if (layerState.lightning) {
      ensureLayer(map, {
        id: 'lightning-circle',
        type: 'circle',
        source: 'lightning-strikes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'ageSec'], 0, 8, 60, 6, 300, 4, 600, 3],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.9,
          'circle-blur': ['interpolate', ['linear'], ['get', 'ageSec'], 0, 0.5, 60, 0, 600, 0],
        },
      })
      map.setLayoutProperty('lightning-circle', 'visibility', 'visible')
    } else if (map.getLayer('lightning-circle')) {
      map.setLayoutProperty('lightning-circle', 'visibility', 'none')
    }
  }, [map, climate.integrity?.lightningStrikes, layerState.lightning])

  // ─── Storm cells + forecast tracks ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const storms = climate.integrity?.storms as any[] | undefined
    if (!storms) return

    // Storm cell points
    const pointFeatures: Feature<Point>[] = storms.map((s: any) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        classification: s.classification,
        intensity: s.intensity || 'moderate',
        color: stormIntensityColor(s.intensity || 'moderate'),
        windSpeedKt: s.windSpeedKt || 0,
        pressureMB: s.pressureMB || 0,
      },
    }))

    // Forecast track lines
    const lineFeatures: Feature<LineString>[] = storms
      .filter((s: any) => s.forecastTrack && s.forecastTrack.length > 1)
      .map((s: any) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: s.forecastTrack.map((t: any) => [t.lon, t.lat]),
        },
        properties: { id: s.id, name: s.name },
      }))

    upsertGeoJSONSource(map, 'storm-cells', { type: 'FeatureCollection', features: pointFeatures })
    upsertGeoJSONSource(map, 'storm-tracks', { type: 'FeatureCollection', features: lineFeatures })

    if (layerState.stormCells) {
      ensureLayer(map, {
        id: 'storm-circle',
        type: 'circle',
        source: 'storm-cells',
        paint: {
          'circle-radius': 10,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.6,
        },
      })
      map.setLayoutProperty('storm-circle', 'visibility', 'visible')
    } else if (map.getLayer('storm-circle')) {
      map.setLayoutProperty('storm-circle', 'visibility', 'none')
    }

    if (layerState.stormTracks) {
      ensureLayer(map, {
        id: 'storm-track-line',
        type: 'line',
        source: 'storm-tracks',
        paint: {
          'line-color': '#ff6600',
          'line-width': 2,
          'line-opacity': 0.7,
          'line-dasharray': [8, 4],
        },
      })
      map.setLayoutProperty('storm-track-line', 'visibility', 'visible')
    } else if (map.getLayer('storm-track-line')) {
      map.setLayoutProperty('storm-track-line', 'visibility', 'none')
    }
  }, [map, climate.integrity?.storms, layerState.stormCells, layerState.stormTracks])

  // ─── Seismic (earthquakes) ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const quakes = climate.integrity?.earthquakes as any[] | undefined
    if (!quakes) return

    const features: Feature<Point>[] = quakes.map((q: any) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [q.lon, q.lat] },
      properties: {
        id: q.id,
        mag: q.mag,
        color: earthquakeColor(q.mag),
        place: q.place,
        depth: q.depth,
        tsunami: q.tsunami,
        url: q.url,
      },
    }))

    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    upsertGeoJSONSource(map, 'earthquakes', fc)

    if (layerState.earthquakes) {
      ensureLayer(map, {
        id: 'earthquake-circle',
        type: 'circle',
        source: 'earthquakes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 2, 4, 5, 12, 7, 25],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#000',
          'circle-stroke-width': 1,
          'circle-opacity': 0.7,
        },
      })
      // Outer ring for M >= 5
      ensureLayer(map, {
        id: 'earthquake-ring',
        type: 'circle',
        source: 'earthquakes',
        filter: ['>=', ['get', 'mag'], 5],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 5, 20, 7, 40],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'color'],
          'circle-opacity': 0.05,
          'circle-stroke-opacity': 0.4,
        },
      })
      map.setLayoutProperty('earthquake-circle', 'visibility', 'visible')
      map.setLayoutProperty('earthquake-ring', 'visibility', 'visible')
    } else {
      if (map.getLayer('earthquake-circle')) map.setLayoutProperty('earthquake-circle', 'visibility', 'none')
      if (map.getLayer('earthquake-ring')) map.setLayoutProperty('earthquake-ring', 'visibility', 'none')
    }
  }, [map, climate.integrity?.earthquakes, layerState.earthquakes])

  // ─── Wildfires ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const fires = climate.integrity?.wildfires as any[] | undefined
    if (!fires) return

    const features: Feature<Point>[] = fires.slice(0, 5000).map((f: any) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: {
        id: f.id,
        brightness: f.brightness,
        color: wildfireColor(f.brightness),
        frp: f.frp,
        confidence: f.confidence,
        satellite: f.satellite,
      },
    }))

    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    upsertGeoJSONSource(map, 'wildfires', fc)

    if (layerState.wildfires) {
      ensureLayer(map, {
        id: 'wildfire-circle',
        type: 'circle',
        source: 'wildfires',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'brightness'], 300, 4, 350, 8, 400, 12],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.8,
        },
      })
      map.setLayoutProperty('wildfire-circle', 'visibility', 'visible')
    } else if (map.getLayer('wildfire-circle')) {
      map.setLayoutProperty('wildfire-circle', 'visibility', 'none')
    }
  }, [map, climate.integrity?.wildfires, layerState.wildfires])

  // ─── Vessels (AIS) ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const vessels = climate.integrity?.vessels as any[] | undefined
    if (!vessels) return

    const features: Feature<Point>[] = vessels.slice(0, 10000).map((v: any) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      properties: {
        imo: v.imo,
        name: v.name,
        speed: v.speed || 0,
        course: v.course || 0,
        vesselType: v.vesselType || '',
        flag: v.flag || '',
      },
    }))

    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    upsertGeoJSONSource(map, 'vessels', fc)

    if (layerState.vessels) {
      ensureLayer(map, {
        id: 'vessel-circle',
        type: 'circle',
        source: 'vessels',
        paint: {
          'circle-radius': 4,
          'circle-color': '#00aa88',
          'circle-stroke-color': '#000',
          'circle-stroke-width': 0.5,
          'circle-opacity': 0.8,
        },
      })
      map.setLayoutProperty('vessel-circle', 'visibility', 'visible')
    } else if (map.getLayer('vessel-circle')) {
      map.setLayoutProperty('vessel-circle', 'visibility', 'none')
    }
  }, [map, climate.integrity?.vessels, layerState.vessels])

  // ─── Aircraft (ADS-B) ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const aircraft = climate.integrity?.aircraft as any[] | undefined
    if (!aircraft) return

    // Filter by altitude
    const filtered = aircraft.filter((a: any) => {
      const alt = a.altitudeFt ?? 0
      return alt >= aircraftAltitudeFilter.min && alt <= aircraftAltitudeFilter.max
    })

    const features: Feature<Point>[] = filtered.slice(0, 10000).map((a: any) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        icao24: a.icao24,
        callsign: a.callsign,
        altitudeFt: a.altitudeFt ?? 0,
        heading: a.heading ?? 0,
        velocityMs: a.velocityMs ?? 0,
        onGround: a.onGround,
        color: aircraftColor(a.altitudeFt),
      },
    }))

    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    upsertGeoJSONSource(map, 'aircraft', fc)

    if (layerState.aircraft) {
      ensureLayer(map, {
        id: 'aircraft-circle',
        type: 'circle',
        source: 'aircraft',
        paint: {
          'circle-radius': 4,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#000',
          'circle-stroke-width': 0.5,
          'circle-opacity': 0.85,
        },
      })
      map.setLayoutProperty('aircraft-circle', 'visibility', 'visible')
    } else if (map.getLayer('aircraft-circle')) {
      map.setLayoutProperty('aircraft-circle', 'visibility', 'none')
    }

    // Density heatmap
    if (layerState.aircraftHeatmap && features.length > 0) {
      ensureLayer(map, {
        id: 'aircraft-heatmap',
        type: 'heatmap',
        source: 'aircraft',
        maxzoom: 9,
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, '#06b6d4',
            0.5, '#fbbf24',
            0.8, '#ef4444',
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 10, 9, 40],
          'heatmap-opacity': 0.5,
        },
      })
      map.setLayoutProperty('aircraft-heatmap', 'visibility', 'visible')
    } else if (map.getLayer('aircraft-heatmap')) {
      map.setLayoutProperty('aircraft-heatmap', 'visibility', 'none')
    }
  }, [map, climate.integrity?.aircraft, layerState.aircraft, layerState.aircraftHeatmap, aircraftAltitudeFilter])

  // ─── Prediction overlays ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const pred = climate.predictions
    if (!pred) return

    // Severe weather alert circles
    if (pred.severeWeather?.alerts) {
      const features: Feature<Point>[] = pred.severeWeather.alerts.map((a: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: {
          id: a.id,
          severity: a.severity,
          color: a.severity === 'critical' ? '#ff0044' : a.severity === 'high' ? '#ff6600' : a.severity === 'moderate' ? '#ffaa00' : '#4fc3f7',
          radiusKm: a.radiusKm,
          title: a.title || a.severity,
        },
      }))
      upsertGeoJSONSource(map, 'severe-weather', { type: 'FeatureCollection', features })

      if (layerState.severeWeather) {
        ensureLayer(map, {
          id: 'severe-weather-circle',
          type: 'circle',
          source: 'severe-weather',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'radiusKm'], 10, 15, 100, 50, 500, 150],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.06,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.5,
          },
        })
        map.setLayoutProperty('severe-weather-circle', 'visibility', 'visible')
      } else if (map.getLayer('severe-weather-circle')) {
        map.setLayoutProperty('severe-weather-circle', 'visibility', 'none')
      }
    }

    // SST anomaly markers
    if (pred.oceanAtmosphereCoupling?.sstAnomalies) {
      const features: Feature<Point>[] = pred.oceanAtmosphereCoupling.sstAnomalies.map((a: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: {
          color: a.anomaly > 0 ? '#ff6600' : '#0099ff',
          anomaly: a.anomaly,
          region: a.region || '',
        },
      }))
      upsertGeoJSONSource(map, 'sst-anomalies', { type: 'FeatureCollection', features })

      if (layerState.sstAnomalies) {
        ensureLayer(map, {
          id: 'sst-anomaly-circle',
          type: 'circle',
          source: 'sst-anomalies',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['abs', ['get', 'anomaly']], 0.5, 10, 3, 30],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.08,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 1,
          },
        })
        map.setLayoutProperty('sst-anomaly-circle', 'visibility', 'visible')
      } else if (map.getLayer('sst-anomaly-circle')) {
        map.setLayoutProperty('sst-anomaly-circle', 'visibility', 'none')
      }
    }

    // Precipitation forecast cells
    if (pred.precipitationForecast?.cells) {
      const cells = pred.precipitationForecast.cells.filter((c: any) => c.hoursFromNow === 1 && c.probability >= 0.3)
      const features: Feature<Point>[] = cells.map((c: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
          color: c.probability > 0.6 ? '#0099ff' : '#4fc3f7',
          probability: c.probability,
        },
      }))
      upsertGeoJSONSource(map, 'precip-forecast', { type: 'FeatureCollection', features })

      if (layerState.precipForecast) {
        ensureLayer(map, {
          id: 'precip-forecast-circle',
          type: 'circle',
          source: 'precip-forecast',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'probability'], 0.3, 8, 1, 25],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.3,
          },
        })
        map.setLayoutProperty('precip-forecast-circle', 'visibility', 'visible')
      } else if (map.getLayer('precip-forecast-circle')) {
        map.setLayoutProperty('precip-forecast-circle', 'visibility', 'none')
      }
    }
  }, [map, climate.predictions, layerState.severeWeather, layerState.sstAnomalies, layerState.precipForecast])

  // ─── Grid assets ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const update = grid.gridUpdate
    if (!update?.assets) return

    const assets = update.assets as any[]
    const measurements = update.measurements || {}

    const features: Feature<Point>[] = assets.map((a: any) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        id: a.id,
        name: a.name,
        type: a.type,
        color: ASSET_TYPE_COLORS[a.type] || '#c0c8d8',
        owner: a.owner || '',
        capacity: a.capacity || 0,
        healthScore: measurements[a.id]?.healthScore ?? 0,
      },
    }))

    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    upsertGeoJSONSource(map, 'grid-assets', fc)

    const assetTypeMap: Record<string, boolean> = {
      power_plant: layerState.powerPlants,
      substation: layerState.substations,
      transformer: layerState.substations,
      renewable: layerState.renewableFarms,
      battery: layerState.batteryStorage,
      data_center: layerState.dataCenters,
      ai_center: layerState.aiCenters,
      edge_node: layerState.dataCenters,
    }

    const visibleTypes = Object.entries(assetTypeMap).filter(([, v]) => v).map(([k]) => k)
    const anyVisible = visibleTypes.length > 0

    if (anyVisible) {
      ensureLayer(map, {
        id: 'grid-asset-circle',
        type: 'circle',
        source: 'grid-assets',
        filter: ['in', ['get', 'type'], ['literal', visibleTypes]],
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#000',
          'circle-stroke-width': 1,
          'circle-opacity': 0.85,
        },
      })
      map.setLayoutProperty('grid-asset-circle', 'visibility', 'visible')
    } else if (map.getLayer('grid-asset-circle')) {
      map.setLayoutProperty('grid-asset-circle', 'visibility', 'none')
    }
  }, [map, grid.gridUpdate, layerState.powerPlants, layerState.substations, layerState.dataCenters, layerState.aiCenters, layerState.renewableFarms, layerState.batteryStorage])

  // ─── Grid interconnects ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const update = grid.gridUpdate
    if (!update?.interconnects) return

    const assets = update.assets || []
    const assetMap = new Map(assets.map((a: any) => [a.id, a]))
    const interconnects = update.interconnects as any[]

    const features: Feature<LineString>[] = interconnects
      .filter((ic: any) => assetMap.has(ic.fromAssetId) && assetMap.has(ic.toAssetId))
      .map((ic: any) => {
        const from = assetMap.get(ic.fromAssetId) as any
        const to = assetMap.get(ic.toAssetId) as any
        return {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] },
          properties: {
            id: ic.id,
            type: ic.type,
            color: ic.type === 'fiber' ? '#ec4899' : ic.type === 'dc_line' ? '#8b5cf6' : '#00ffcc',
          },
        }
      })

    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    upsertGeoJSONSource(map, 'grid-interconnects', fc)

    if (layerState.gridInterconnects) {
      ensureLayer(map, {
        id: 'grid-interconnect-line',
        type: 'line',
        source: 'grid-interconnects',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-opacity': 0.6,
          'line-dasharray': ['case', ['==', ['get', 'type'], 'fiber'], ['literal', [2, 3]], ['==', ['get', 'type'], 'dc_line'], ['literal', [8, 4]], ['literal', [1, 0]]],
        },
      })
      map.setLayoutProperty('grid-interconnect-line', 'visibility', 'visible')
    } else if (map.getLayer('grid-interconnect-line')) {
      map.setLayoutProperty('grid-interconnect-line', 'visibility', 'none')
    }
  }, [map, grid.gridUpdate, layerState.gridInterconnects])

  // ─── Network connections ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const update = net.netUpdate
    if (!update?.connections) return

    const userLoc = net.userLocation
    if (!userLoc) return

    const connections = update.connections as any[]
    // Dedupe by remote IP, cap at 500
    const seen = new Set<string>()
    const unique = connections.filter((c: any) => {
      const key = c.remoteAddress
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 500)

    const lineFeatures: Feature<LineString>[] = unique
      .filter((c: any) => c.geoLocation)
      .map((c: any) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [userLoc.lon, userLoc.lat],
            [c.geoLocation.lon, c.geoLocation.lat],
          ],
        },
        properties: {
          color: c.protocol === 'UDP' ? '#f59e0b' : '#00aaff',
          protocol: c.protocol,
          remoteAddress: c.remoteAddress,
        },
      }))

    const pointFeatures: Feature<Point>[] = unique
      .filter((c: any) => c.geoLocation)
      .map((c: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.geoLocation.lon, c.geoLocation.lat] },
        properties: {
          color: c.protocol === 'UDP' ? '#f59e0b' : '#00aaff',
          remoteAddress: c.remoteAddress,
        },
      }))

    upsertGeoJSONSource(map, 'net-connections', { type: 'FeatureCollection', features: lineFeatures })
    upsertGeoJSONSource(map, 'net-endpoints', { type: 'FeatureCollection', features: pointFeatures })

    if (layerState.networkConnections) {
      ensureLayer(map, {
        id: 'net-connection-line',
        type: 'line',
        source: 'net-connections',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1,
          'line-opacity': 0.4,
        },
      })
      ensureLayer(map, {
        id: 'net-endpoint-circle',
        type: 'circle',
        source: 'net-endpoints',
        paint: {
          'circle-radius': 3,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.7,
        },
      })
      map.setLayoutProperty('net-connection-line', 'visibility', 'visible')
      map.setLayoutProperty('net-endpoint-circle', 'visibility', 'visible')
    } else {
      if (map.getLayer('net-connection-line')) map.setLayoutProperty('net-connection-line', 'visibility', 'none')
      if (map.getLayer('net-endpoint-circle')) map.setLayoutProperty('net-endpoint-circle', 'visibility', 'none')
    }
  }, [map, net.netUpdate, net.userLocation, layerState.networkConnections])

  // ─── User location marker ───
  useEffect(() => {
    if (!isMapAlive(map)) return
    const loc = net.userLocation
    if (!loc) return

    const feature: Feature<Point> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
      properties: { color: '#00ff88' },
    }
    upsertGeoJSONSource(map, 'user-location', { type: 'FeatureCollection', features: [feature] })

    if (layerState.userLocation) {
      ensureLayer(map, {
        id: 'user-location-circle',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': 8,
          'circle-color': '#00ff88',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      })
      map.setLayoutProperty('user-location-circle', 'visibility', 'visible')
    } else if (map.getLayer('user-location-circle')) {
      map.setLayoutProperty('user-location-circle', 'visibility', 'none')
    }
  }, [map, net.userLocation, layerState.userLocation])

  return null // pure side-effect component
}
