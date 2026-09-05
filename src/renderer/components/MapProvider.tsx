import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import maplibregl from 'maplibre-gl'
import { MapContext, type DrawMode, type SelectionEvent, type LngLat } from '../hooks/useMap'

interface MapProviderProps {
  children: ReactNode
}

/**
 * Owns the MapLibre map instance reference and exposes it via context.
 * Manages: draw mode, selection (area boundary), and LKP (Last Known Point).
 *
 * - Selection = bounding box / polygon / line drawn on map (the search area)
 * - LKP = a pin placed by right-click (where the person was last seen)
 *   Falls back to map center if no pin is placed.
 */
export function MapProvider({ children }: MapProviderProps) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [drawMode, setDrawModeState] = useState<DrawMode>('none')
  const [selection, setSelection] = useState<SelectionEvent | null>(null)
  const [selections, setSelections] = useState<SelectionEvent[]>([])
  const [lkp, setLkpState] = useState<LngLat | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [terrain3d, setTerrain3d] = useState(false)
  const [hillshade, setHillshade] = useState(false)
  const [endPoint, setEndPointState] = useState<LngLat | null>(null)
  const [fallPoint, setFallPointState] = useState<LngLat | null>(null)
  const [weatherPin, setWeatherPinState] = useState<LngLat | null>(null)

  const registerMap = useCallback((map: maplibregl.Map | null) => {
    mapRef.current = map
    setMapReady(!!map)
  }, [])

  const setDrawMode = useCallback((mode: DrawMode) => {
    setDrawModeState(mode)
  }, [])

  /** Add a selection to the multi-selection list (for multi-box analysis). */
  const addSelection = useCallback((sel: SelectionEvent) => {
    setSelections((prev) => [...prev, sel])
  }, [])

  const setLkp = useCallback((point: LngLat | null) => {
    setLkpState(point)
  }, [])

  const setEndPoint = useCallback((point: LngLat | null) => {
    setEndPointState(point)
  }, [])

  const setFallPoint = useCallback((point: LngLat | null) => {
    setFallPointState(point)
  }, [])

  const setWeatherPin = useCallback((point: LngLat | null) => {
    setWeatherPinState(point)
  }, [])

  const toggleTerrain3d = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const next = !terrain3d
    setTerrain3d(next)
    if (next) {
      // Enable 3D terrain with exaggeration and tilt the camera so you can see it
      map.setTerrain({ source: 'terrain-dem', exaggeration: 2.0 })
      // Ease to an oblique view — pitch 75° gives a dramatic 3D perspective toward the horizon
      map.easeTo({ pitch: 75, duration: 800 })
    } else {
      map.setTerrain(null)
      // Return to top-down
      map.easeTo({ pitch: 0, duration: 800 })
    }
  }, [terrain3d])

  const toggleHillshade = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const next = !hillshade
    setHillshade(next)
    if (next) {
      if (!map.getSource('hillshade')) {
        map.addSource('hillshade', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 15,
          encoding: 'terrarium',
        })
      }
      if (!map.getLayer('hillshade-layer')) {
        map.addLayer({
          id: 'hillshade-layer',
          type: 'hillshade',
          source: 'hillshade',
          paint: {
            'hillshade-shadow-color': '#1a1a2e',
            'hillshade-highlight-color': '#ffffff',
            'hillshade-exaggeration': 0.8,
          },
        }, 'satellite-layer') // below satellite so imagery shows on top with shading
      }
    } else {
      if (map.getLayer('hillshade-layer')) map.removeLayer('hillshade-layer')
    }
  }, [hillshade])

  const clearSelection = useCallback(() => {
    setSelection(null)
    setSelections([])
    const map = mapRef.current
    if (map) {
      ;['selection-bbox', 'selection-polygon', 'selection-line', 'multi-selection-bbox', 'multi-selection-polygon'].forEach((id) => {
        if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`)
        if (map.getLayer(`${id}-outline`)) map.removeLayer(`${id}-outline`)
        if (map.getSource(id)) map.removeSource(id)
      })
    }
  }, [])

  // Sources that belong to the base map and must NOT be removed on clear.
  // Everything else (markers, analysis overlays, weather tiles, imports) is
  // considered user-added and gets wiped.
  const BASE_SOURCES = new Set(['esri_imagery', 'esri_reference', 'esri_transportation', 'terrain-dem', 'hillshade'])
  const BASE_LAYERS = new Set(['satellite-layer', 'reference-transportation', 'reference-labels', 'hillshade-layer'])

  const clearMap = useCallback(() => {
    const map = mapRef.current

    // 1. Reset all React point/selection state
    setSelection(null)
    setSelections([])
    setLkpState(null)
    setEndPointState(null)
    setFallPointState(null)
    setWeatherPinState(null)
    setDrawModeState('none')

    // 2. Strip every non-base layer and source from the map
    if (map) {
      // Remove layers first (can't remove a source while a layer uses it)
      const layers = map.getStyle()?.layers ?? []
      for (const layer of layers) {
        if (!BASE_LAYERS.has(layer.id)) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id)
        }
      }
      // Then remove sources
      const sources = Object.keys(map.getStyle()?.sources ?? {})
      for (const src of sources) {
        if (!BASE_SOURCES.has(src)) {
          if (map.getSource(src)) map.removeSource(src)
        }
      }
    }

    // 3. Notify panels to reset their own hook state
    window.dispatchEvent(new Event('terrain:clear-all'))
  }, [])

  // Listen for selection events from MapCanvas
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SelectionEvent>).detail
      setSelection(detail)
      // Also add to multi-selection list (for multi-box analysis)
      if (detail) addSelection(detail)
    }
    window.addEventListener('terrain:selection', handler)
    return () => window.removeEventListener('terrain:selection', handler)
  }, [addSelection])

  // Listen for LKP placement events from MapCanvas (right-click)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LngLat>).detail
      setLkpState(detail)
    }
    window.addEventListener('terrain:lkp', handler)
    return () => window.removeEventListener('terrain:lkp', handler)
  }, [])

  // Listen for end point placement (shift+click)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LngLat>).detail
      setEndPointState(detail)
    }
    window.addEventListener('terrain:endpoint', handler)
    return () => window.removeEventListener('terrain:endpoint', handler)
  }, [])

  // Listen for fall point placement (click on route)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LngLat>).detail
      setFallPointState(detail)
    }
    window.addEventListener('terrain:fallpoint', handler)
    return () => window.removeEventListener('terrain:fallpoint', handler)
  }, [])

  // Listen for weather pin placement (click in weather-pin mode)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LngLat>).detail
      setWeatherPinState(detail)
    }
    window.addEventListener('terrain:weather-pin', handler)
    return () => window.removeEventListener('terrain:weather-pin', handler)
  }, [])

  // Listen for elevation profile hover — move a marker on the map
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LngLat | null>).detail
      const map = mapRef.current
      if (!map) return
      if (detail) {
        if (map.getSource('profile-hover-marker')) {
          ;(map.getSource('profile-hover-marker') as maplibregl.GeoJSONSource).setData({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [detail.lng, detail.lat] },
            properties: {},
          })
        } else {
          map.addSource('profile-hover-marker', {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'Point', coordinates: [detail.lng, detail.lat] }, properties: {} },
          })
          map.addLayer({
            id: 'profile-hover-marker-circle',
            type: 'circle',
            source: 'profile-hover-marker',
            paint: { 'circle-radius': 8, 'circle-color': '#ff8c42', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
          })
        }
      } else {
        if (map.getSource('profile-hover-marker')) {
          ;(map.getSource('profile-hover-marker') as maplibregl.GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: [],
          })
        }
      }
    }
    window.addEventListener('terrain:profile-hover', handler)
    return () => window.removeEventListener('terrain:profile-hover', handler)
  }, [])

  return (
    <MapContext.Provider
      value={{
        map: mapRef.current,
        drawMode,
        setDrawMode,
        selection,
        selections,
        addSelection,
        clearSelection,
        clearMap,
        registerMap,
        lkp,
        setLkp,
        endPoint,
        setEndPoint,
        fallPoint,
        setFallPoint,
        weatherPin,
        setWeatherPin,
        terrain3d,
        toggleTerrain3d,
        hillshade,
        toggleHillshade,
      }}
    >
      {children}
    </MapContext.Provider>
  )
}
