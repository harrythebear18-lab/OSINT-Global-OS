import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMap } from '../hooks/useMap'
import { confidenceColor } from '../lib/hypothesis'
import type { Hypothesis, HypothesisZone } from '../lib/hypothesis'

interface ExplainabilityOverlayProps {
  hypotheses: Hypothesis[]
}

/**
 * Explainability Overlay — renders AI-suggested zones on the map with
 * color-coded confidence and popup explanations showing *why* each
 * zone was suggested.
 *
 * - Zone polygons are filled with a translucent confidence color
 * - Clicking a zone opens a popup with the full reasoning
 * - Zones update live as hypotheses are updated by the LLM
 */
export function ExplainabilityOverlay({ hypotheses }: ExplainabilityOverlayProps) {
  const { map } = useMap()
  const popupsRef = useRef<maplibregl.Popup[]>([])

  // Collect all suggested zones from active hypotheses
  const allZones: { zone: HypothesisZone; hypothesis: Hypothesis }[] = []
  for (const h of hypotheses) {
    if (h.status !== 'active') continue
    for (const z of h.suggestedZones || []) {
      allZones.push({ zone: z, hypothesis: h })
    }
  }

  useEffect(() => {
    if (!map) return
    const isAlive = (m: maplibregl.Map) => !m._removed

    // Clean up previous popups
    popupsRef.current.forEach((p) => p.remove())
    popupsRef.current = []

    // Remove existing layers/sources
    const existingSource = map.getSource('explainability-zones')
    if (existingSource) {
      ;['explainability-zones-fill', 'explainability-zones-outline', 'explainability-zones-label'].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id)
      })
      map.removeSource('explainability-zones')
    }

    if (allZones.length === 0 || !isAlive(map)) return

    // Build GeoJSON features
    const features = allZones.map(({ zone, hypothesis }) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [zone.coords.map((c) => [c.lng, c.lat])],
      },
      properties: {
        zoneId: zone.id,
        label: zone.label,
        confidence: zone.confidence,
        color: confidenceColor(zone.confidence),
        hypothesisTitle: hypothesis.title,
        reasons: zone.reasons.join('\n• '),
      },
    }))

    const geojson = {
      type: 'FeatureCollection' as const,
      features,
    }

    // Wait for map style to be ready
    const addLayers = () => {
      if (!isAlive(map)) return
      if (map.getSource('explainability-zones')) return // already added

      map.addSource('explainability-zones', {
        type: 'geojson',
        data: geojson,
      })

      // Fill layer (translucent)
      map.addLayer({
        id: 'explainability-zones-fill',
        type: 'fill',
        source: 'explainability-zones',
        layout: {},
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.2,
        },
      })

      // Outline layer
      map.addLayer({
        id: 'explainability-zones-outline',
        type: 'line',
        source: 'explainability-zones',
        layout: {},
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-dasharray': [2, 1],
        },
      })

      // Click handler — show popup with reasoning
      const onClick = (e: maplibregl.MapLayerMouseEvent) => {
        if (!isAlive(map)) return
        const feature = e.features?.[0]
        if (!feature) return
        const props = feature.properties as any
        const reasonsStr = typeof props?.reasons === 'string' ? props.reasons : ''
        const reasonsHtml = reasonsStr
          ? `<ul style="margin:4px 0;padding-left:16px;font-size:11px;">${reasonsStr.split('\n').map((r: string) => `<li>${r}</li>`).join('')}</ul>`
          : ''
        const html = `
          <div class="explain-popup">
            <div class="explain-popup-title">${props?.label || 'Zone'}</div>
            <div class="explain-popup-hyp">From: ${props?.hypothesisTitle || 'Hypothesis'}</div>
            <div class="explain-popup-confidence" style="color:${props?.color || '#4ea1ff'};">Confidence: ${props?.confidence || 0}%</div>
            <div class="explain-popup-reasons-title">Why this zone:</div>
            ${reasonsHtml}
          </div>
        `
        const popup = new maplibregl.Popup({ maxWidth: '320px', closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map)
        popupsRef.current.push(popup)
      }

      map.on('click', 'explainability-zones-fill', onClick)

      // Cursor change on hover
      const onMouseEnter = () => {
        if (isAlive(map)) map.getCanvas().style.cursor = 'pointer'
      }
      const onMouseLeave = () => {
        if (isAlive(map)) map.getCanvas().style.cursor = ''
      }
      map.on('mouseenter', 'explainability-zones-fill', onMouseEnter)
      map.on('mouseleave', 'explainability-zones-fill', onMouseLeave)
    }

    if (map.loaded()) {
      addLayers()
    } else {
      map.once('load', addLayers)
    }

    return () => {
      if (!isAlive(map)) return
      popupsRef.current.forEach((p) => p.remove())
      popupsRef.current = []
      ;['explainability-zones-fill', 'explainability-zones-outline', 'explainability-zones-label'].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id)
      })
      if (map.getSource('explainability-zones')) map.removeSource('explainability-zones')
    }
  }, [map, allZones.length])

  return null // renders only map layers, no DOM
}
