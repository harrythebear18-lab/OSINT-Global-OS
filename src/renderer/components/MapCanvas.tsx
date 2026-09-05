import { useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { useMap, type SelectionEvent } from '../hooks/useMap'

/**
 * Phase 1 — Base Map + Area Selection.
 *
 * Mounts MapLibre with Esri World Imagery satellite basemap (free, no key).
 * CRS: Web Mercator (EPSG:3857) — MapLibre default.
 *
 * Drawing modes:
 *  - bbox:    click-drag to draw a bounding box
 *  - polygon: click to add vertices, double-click to finish
 *  - line:    click to add vertices, double-click to finish
 *
 * Selection is emitted via context and rendered as map layers.
 */
export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hudRef = useRef<HTMLDivElement>(null)

  // Drawing state (refs so we don't re-render on every mouse move)
  const isDrawingRef = useRef(false)
  const startPointRef = useRef<maplibregl.LngLat | null>(null)
  const polygonPointsRef = useRef<maplibregl.LngLat[]>([])

  const { drawMode, setDrawMode, clearSelection, registerMap } = useMap()

  /* ---------------------------------------------------------------- */
  /* Selection rendering helpers                                       */
  /* ---------------------------------------------------------------- */

  const renderBbox = useCallback((map: maplibregl.Map, sw: maplibregl.LngLat, ne: maplibregl.LngLat) => {
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [
      [sw.lng, sw.lat],
      [ne.lng, sw.lat],
      [ne.lng, ne.lat],
      [sw.lng, ne.lat],
    ]
    if (map.getSource('selection-bbox')) {
      ;(map.getSource('selection-bbox') as maplibregl.GeoJSONSource).setData({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
        properties: {},
      })
    } else {
      map.addSource('selection-bbox', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
          properties: {},
        },
      })
      map.addLayer({
        id: 'selection-bbox-fill',
        type: 'fill',
        source: 'selection-bbox',
        paint: { 'fill-color': '#4ea1ff', 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'selection-bbox-outline',
        type: 'line',
        source: 'selection-bbox',
        paint: { 'line-color': '#4ea1ff', 'line-width': 2 },
      })
    }
  }, [])

  const renderPolyline = useCallback(
    (map: maplibregl.Map, points: maplibregl.LngLat[], type: 'polygon' | 'line') => {
      const sourceId = `selection-${type}`
      const coords = points.map((p) => [p.lng, p.lat] as [number, number])
      const geometry =
        type === 'polygon'
          ? { type: 'Polygon' as const, coordinates: [[...coords, coords[0]]] }
          : { type: 'LineString' as const, coordinates: coords }

      if (map.getSource(sourceId)) {
        ;(map.getSource(sourceId) as maplibregl.GeoJSONSource).setData({
          type: 'Feature',
          geometry,
          properties: {},
        })
      } else {
        map.addSource(sourceId, { type: 'geojson', data: { type: 'Feature', geometry, properties: {} } })
        if (type === 'polygon') {
          map.addLayer({
            id: `${sourceId}-fill`,
            type: 'fill',
            source: sourceId,
            paint: { 'fill-color': '#ff8c42', 'fill-opacity': 0.15 },
          })
        }
        map.addLayer({
          id: `${sourceId}-outline`,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#ff8c42', 'line-width': 2 },
        })
      }
    },
    [],
  )

  /* ---------------------------------------------------------------- */
  /* Map init                                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          esri_imagery: {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            attribution: '&copy; Esri, Maxar, Earthstar Geographics',
            maxzoom: 19,
          },
          // Esri reference overlay — roads, place labels, boundaries
          // Designed to sit on top of World Imagery. Transparent background.
          esri_reference: {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 19,
          },
          // Esri transportation overlay — roads, highways, rail
          esri_transportation: {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 19,
          },
        },
        layers: [
          {
            id: 'satellite-layer',
            type: 'raster',
            source: 'esri_imagery',
            paint: {},
          },
          // Roads + highways (below labels so labels are readable)
          {
            id: 'reference-transportation',
            type: 'raster',
            source: 'esri_transportation',
            paint: { 'raster-opacity': 0.9 },
          },
          // Boundaries + place names on top
          {
            id: 'reference-labels',
            type: 'raster',
            source: 'esri_reference',
            paint: { 'raster-opacity': 0.9 },
          },
        ],
      },
      center: [-116.5, 33.8],
      zoom: 9,
      maxZoom: 18, // ~15-20m on scale bar — slightly closer before imagery pixelates
      maxTileCacheSize: 1000,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.addControl(new maplibregl.FullscreenControl(), 'top-right')

    // Add terrain source — AWS Terrarium terrain-rgb (free, no key, PNG-encoded)
    // MapLibre can decode PNG raster-dem. Esri Terrain3D serves LERC which MapLibre can't decode.
    // Terrarium goes to z15 (~1m at equator). Encoding: 'terrarium' (R*256 + G + B/256 - 32768)
    map.on('load', () => {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: [
          'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 15,
        encoding: 'terrarium',
      })
      // Hillshade from Terrarium (better for 2D shading)
      map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.4, position: [1.5, 210, 30] })
    })

    const updateHud = () => {
      const c = map.getCenter()
      const z = map.getZoom().toFixed(2)
      if (hudRef.current) {
        hudRef.current.textContent = `center: ${c.lng.toFixed(5)}, ${c.lat.toFixed(5)}  |  zoom: ${z}`
      }
    }

    map.on('move', updateHud)
    map.on('load', updateHud)

    // Right-click to place LKP (Last Known Point)
    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault()
      const point = { lng: e.lngLat.lng, lat: e.lngLat.lat }
      window.dispatchEvent(new CustomEvent('terrain:lkp', { detail: point }))
      // Marker rendering handled by MarkerLayer component
    }
    map.on('contextmenu', onContextMenu)

    // Shift+click to place end point (for route planning)
    // Disable MapLibre's built-in box zoom (shift+drag) so it doesn't
    // interfere with shift+click endpoint placement.
    map.boxZoom.disable()
    const onShiftClick = (e: maplibregl.MapMouseEvent) => {
      if (!e.originalEvent.shiftKey) return
      e.preventDefault()
      e.originalEvent.stopPropagation()
      const point = { lng: e.lngLat.lng, lat: e.lngLat.lat }
      window.dispatchEvent(new CustomEvent('terrain:endpoint', { detail: point }))
    }
    map.on('click', onShiftClick)

    mapRef.current = map
    registerMap(map)

    return () => {
      map.off('contextmenu', onContextMenu)
      map.off('click', onShiftClick)
      map.remove()
      mapRef.current = null
      registerMap(null)
    }
  }, [registerMap])

  /* ---------------------------------------------------------------- */
  /* Marker rendering is now handled by the unified MarkerLayer        */
  /* component. MapCanvas only dispatches placement events.           */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /* Drawing event handlers — re-attach when drawMode changes          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const canvas = map.getCanvas()
    canvas.style.cursor = drawMode !== 'none' ? 'crosshair' : ''

    // Remove previous handlers
    const cleanup = () => {
      isDrawingRef.current = false
      startPointRef.current = null
      polygonPointsRef.current = []
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      map.off('click', onClick)
      map.off('click', onWeatherClick)
      map.off('dblclick', onDblClick)
    }

    /* --- Bounding box: click-drag --- */
    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (drawMode !== 'bbox') return
      e.preventDefault()
      isDrawingRef.current = true
      startPointRef.current = e.lngLat
      // Clear previous bbox
      clearSelection()
    }

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (drawMode !== 'bbox' || !isDrawingRef.current || !startPointRef.current) return
      e.preventDefault()
      // Normalize to SW/NE regardless of drag direction
      const sw = {
        lng: Math.min(startPointRef.current.lng, e.lngLat.lng),
        lat: Math.min(startPointRef.current.lat, e.lngLat.lat),
      } as maplibregl.LngLat
      const ne = {
        lng: Math.max(startPointRef.current.lng, e.lngLat.lng),
        lat: Math.max(startPointRef.current.lat, e.lngLat.lat),
      } as maplibregl.LngLat
      renderBbox(map, sw, ne)
    }

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
      if (drawMode !== 'bbox' || !isDrawingRef.current || !startPointRef.current) return
      e.preventDefault()
      isDrawingRef.current = false
      const start = startPointRef.current
      const end = e.lngLat
      // Reject zero-area bboxes (accidental click without dragging)
      const dLng = Math.abs(end.lng - start.lng)
      const dLat = Math.abs(end.lat - start.lat)
      if (dLng < 0.001 && dLat < 0.001) {
        // Too small — treat as a click, not a drag. Don't create a selection.
        setDrawMode('none')
        return
      }
      // Compute proper SW/NE regardless of drag direction
      const sw: maplibregl.LngLat = {
        lng: Math.min(start.lng, end.lng),
        lat: Math.min(start.lat, end.lat),
      } as maplibregl.LngLat
      const ne: maplibregl.LngLat = {
        lng: Math.max(start.lng, end.lng),
        lat: Math.max(start.lat, end.lat),
      } as maplibregl.LngLat
      renderBbox(map, sw, ne)
      const selection: SelectionEvent = {
        type: 'bbox',
        coords: [
          { lng: sw.lng, lat: sw.lat },
          { lng: ne.lng, lat: sw.lat },
          { lng: ne.lng, lat: ne.lat },
          { lng: sw.lng, lat: ne.lat },
        ],
      }
      // Emit selection via a custom event (context doesn't have setter for selection here)
      window.dispatchEvent(new CustomEvent('terrain:selection', { detail: selection }))
      setDrawMode('none')
    }

    /* --- Polygon / Line: click to add, dblclick to finish --- */
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (drawMode !== 'polygon' && drawMode !== 'line') return
      if (e.originalEvent.shiftKey) return // shift-click is for endpoint placement
      e.preventDefault()
      polygonPointsRef.current.push(e.lngLat)
      renderPolyline(map, polygonPointsRef.current, drawMode)
    }

    /* --- Weather pin: click to drop a point for forecasting --- */
    const onWeatherClick = (e: maplibregl.MapMouseEvent) => {
      if (drawMode !== 'weather-pin') return
      if (e.originalEvent.shiftKey) return // shift-click is for endpoint placement
      e.preventDefault()
      const point = { lng: e.lngLat.lng, lat: e.lngLat.lat }
      window.dispatchEvent(new CustomEvent('terrain:weather-pin', { detail: point }))
      // Marker rendering handled by MarkerLayer component
      setDrawMode('none')
    }

    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      if (drawMode !== 'polygon' && drawMode !== 'line') return
      e.preventDefault()
      // dblclick also fires a click first; the last point is a duplicate — remove it
      if (polygonPointsRef.current.length > 1) {
        polygonPointsRef.current.pop()
      }
      const points = [...polygonPointsRef.current]
      if (points.length < (drawMode === 'polygon' ? 3 : 2)) {
        cleanup()
        return
      }
      renderPolyline(map, points, drawMode)
      const selection: SelectionEvent = {
        type: drawMode,
        coords: points.map((p) => ({ lng: p.lng, lat: p.lat })),
      }
      window.dispatchEvent(new CustomEvent('terrain:selection', { detail: selection }))
      setDrawMode('none')
    }

    if (drawMode === 'bbox') {
      map.on('mousedown', onMouseDown)
      map.on('mousemove', onMouseMove)
      map.on('mouseup', onMouseUp)
      // Disable drag-pan while drawing bbox
      map.dragPan.disable()
    } else if (drawMode === 'polygon' || drawMode === 'line') {
      map.on('click', onClick)
      map.on('dblclick', onDblClick)
      map.doubleClickZoom.disable()
    } else if (drawMode === 'weather-pin') {
      map.on('click', onWeatherClick)
      map.doubleClickZoom.disable()
    } else {
      map.dragPan.enable()
      map.doubleClickZoom.enable()
    }

    return () => {
      cleanup()
      if (drawMode === 'bbox') map.dragPan.enable()
      if (drawMode === 'polygon' || drawMode === 'line' || drawMode === 'weather-pin') map.doubleClickZoom.enable()
    }
  }, [drawMode, renderBbox, renderPolyline, clearSelection, setDrawMode])

  return (
    <div className="map-canvas-wrap">
      <div ref={containerRef} className="map-canvas" />
      <div ref={hudRef} className="dev-hud" />
    </div>
  )
}
