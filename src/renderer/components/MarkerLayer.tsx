import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMap } from '../hooks/useMap'
import type { LngLat } from '../hooks/useMap'
import type { FeatureCollection, Feature, Point } from 'geojson'

/**
 * MarkerLayer — unified marker rendering for all placed/imported points.
 *
 * Renders on top of all analysis layers so markers are always visible:
 *  - LKP (Last Known Point) — blue pin, placed by right-click
 *  - End Point — green pin, placed by shift+click
 *  - Fall Point — red X, placed by clicking on a route
 *  - Weather Pin — cyan pin, placed by weather-pin draw mode
 *  - Custom Markers — orange pins, placed by external events
 *                     (e.g., case profiles, imported KML points)
 *
 * All markers are in a single GeoJSON source so they can be toggled,
 * exported, and queried together. Each marker has a label popup.
 *
 * This replaces the scattered marker rendering that was previously
 * split between MapCanvas (LKP, endPoint, weatherPin) and MapOverlays
 * (fallPoint). Those components still dispatch the placement events;
 * this component listens and renders them all in one place.
 */

interface CustomMarker {
  id: string
  label: string
  coord: LngLat
  color: string
  icon: string
}

/** Shared custom markers (set by external components via window events). */
let customMarkers: CustomMarker[] = []

export function setCustomMarkers(markers: CustomMarker[]) {
  customMarkers = markers
  window.dispatchEvent(new Event('terrain:custom-markers'))
}

export function addCustomMarker(marker: CustomMarker) {
  customMarkers = [...customMarkers, marker]
  window.dispatchEvent(new Event('terrain:custom-markers'))
}

export function clearCustomMarkers() {
  customMarkers = []
  window.dispatchEvent(new Event('terrain:custom-markers'))
}

interface MarkerFeatureProps {
  markerType: 'lkp' | 'endpoint' | 'fallpoint' | 'weather' | 'custom'
  label: string
  color: string
  icon: string
  markerId: string
}

const MARKER_STYLES: Record<MarkerFeatureProps['markerType'], { color: string; icon: string; label: string }> = {
  lkp: { color: '#4ea1ff', icon: 'LKP', label: 'Last Known Point' },
  endpoint: { color: '#22c55e', icon: 'END', label: 'End Point' },
  fallpoint: { color: '#ff0000', icon: 'FALL', label: 'Fall Point' },
  weather: { color: '#06b6d4', icon: 'W', label: 'Weather Pin' },
  custom: { color: '#ff8800', icon: '•', label: 'Marker' },
}

export function MarkerLayer() {
  const { map, lkp, endPoint, fallPoint, weatherPin } = useMap()
  const popupRef = useRef<maplibregl.Popup | null>(null)

  useEffect(() => {
    if (!map) return

    // Create popup once
    if (!popupRef.current) {
      popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 15, className: 'marker-popup' })
    }
    const popup = popupRef.current

    const renderMarkers = () => {
      const features: Feature<Point, MarkerFeatureProps>[] = []

      if (lkp) {
        const s = MARKER_STYLES.lkp
        features.push({
          type: 'Feature',
          properties: { markerType: 'lkp', label: s.label, color: s.color, icon: s.icon, markerId: 'lkp' },
          geometry: { type: 'Point', coordinates: [lkp.lng, lkp.lat] },
        })
      }
      if (endPoint) {
        const s = MARKER_STYLES.endpoint
        features.push({
          type: 'Feature',
          properties: { markerType: 'endpoint', label: s.label, color: s.color, icon: s.icon, markerId: 'endpoint' },
          geometry: { type: 'Point', coordinates: [endPoint.lng, endPoint.lat] },
        })
      }
      if (fallPoint) {
        const s = MARKER_STYLES.fallpoint
        features.push({
          type: 'Feature',
          properties: { markerType: 'fallpoint', label: s.label, color: s.color, icon: s.icon, markerId: 'fallpoint' },
          geometry: { type: 'Point', coordinates: [fallPoint.lng, fallPoint.lat] },
        })
      }
      if (weatherPin) {
        const s = MARKER_STYLES.weather
        features.push({
          type: 'Feature',
          properties: { markerType: 'weather', label: s.label, color: s.color, icon: s.icon, markerId: 'weather' },
          geometry: { type: 'Point', coordinates: [weatherPin.lng, weatherPin.lat] },
        })
      }
      for (const cm of customMarkers) {
        features.push({
          type: 'Feature',
          properties: { markerType: 'custom', label: cm.label, color: cm.color, icon: cm.icon, markerId: cm.id },
          geometry: { type: 'Point', coordinates: [cm.coord.lng, cm.coord.lat] },
        })
      }

      const fc: FeatureCollection<Point, MarkerFeatureProps> = { type: 'FeatureCollection', features }
      const sourceId = 'unified-markers'

      if (map.getSource(sourceId)) {
        ;(map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(fc)
      } else {
        map.addSource(sourceId, { type: 'geojson', data: fc })

        // Outer glow circle (semi-transparent halo)
        map.addLayer({
          id: 'markers-glow',
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': 18,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.15,
          },
        })

        // Main marker circle
        map.addLayer({
          id: 'markers-circle',
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': 9,
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2.5,
          },
        })

        // Inner dot (for visual distinction)
        map.addLayer({
          id: 'markers-inner',
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': 3,
            'circle-color': '#ffffff',
          },
        })

        // Label text (always visible, small)
        map.addLayer({
          id: 'markers-label',
          type: 'symbol',
          source: sourceId,
          layout: {
            'text-field': ['get', 'icon'],
            'text-size': 9,
            'text-anchor': 'center',
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#ffffff',
          },
        })

        // Popup on click
        map.on('click', 'markers-circle', (e) => {
          const f = e.features?.[0]
          if (!f) return
          const props = f.properties as MarkerFeatureProps
          const coord = (f.geometry as Point).coordinates
          const html = `<div style="font-size:11px;padding:4px 8px"><strong style="color:${props.color}">${props.label}</strong><br/><span style="color:#888">${coord[0].toFixed(5)}, ${coord[1].toFixed(5)}</span></div>`
          popup.setHTML(html).setLngLat(e.lngLat).addTo(map)
        })
        map.on('mouseenter', 'markers-circle', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'markers-circle', () => { map.getCanvas().style.cursor = '' })
      }
    }

    renderMarkers()

    // Re-render when any marker changes
    const customHandler = () => renderMarkers()
    window.addEventListener('terrain:custom-markers', customHandler)

    return () => {
      window.removeEventListener('terrain:custom-markers', customHandler)
    }
  }, [map, lkp, endPoint, fallPoint, weatherPin])

  return null
}
