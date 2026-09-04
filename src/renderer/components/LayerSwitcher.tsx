import { useState, useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useMap } from '../hooks/useMap'

function isMapAlive(map: maplibregl.Map | null | undefined): map is maplibregl.Map {
  return !!map && !(map as any)._removed
}

/**
 * Layer switcher — toggle visibility and adjust opacity of map layers.
 *
 * Layers managed:
 *  - satellite (Esri World Imagery basemap)
 *  - hillshade (terrain shading)
 *  - 3D terrain (pitch + exaggeration)
 *  - sentinel (Sentinel-2 overlay, if loaded)
 *  - water (OSM water features, if loaded)
 *  - slope bands (if loaded)
 *  - anomaly zones (if loaded)
 */
export function LayerSwitcher() {
  const { terrain3d, toggleTerrain3d, hillshade, toggleHillshade, map } = useMap()
  const [satelliteOpacity, setSatelliteOpacity] = useState(1.0)
  const [sentinelOpacity, setSentinelOpacity] = useState(0.7)
  const [waterVisible, setWaterVisible] = useState(true)
  const [slopeVisible, setSlopeVisible] = useState(true)
  const [anomalyVisible, setAnomalyVisible] = useState(true)
  const [routeVisible, setRouteVisible] = useState(true)
  const [roadsVisible, setRoadsVisible] = useState(true)
  const [labelsVisible, setLabelsVisible] = useState(true)

  // Apply satellite opacity
  useEffect(() => {
    if (!isMapAlive(map)) return
    if (map.getLayer('satellite-layer')) {
      map.setPaintProperty('satellite-layer', 'raster-opacity', satelliteOpacity)
    }
  }, [satelliteOpacity, map])

  // Apply sentinel opacity
  useEffect(() => {
    if (!isMapAlive(map)) return
    if (map.getLayer('sentinel-imagery-layer')) {
      map.setPaintProperty('sentinel-imagery-layer', 'raster-opacity', sentinelOpacity)
    }
  }, [sentinelOpacity, map])

  // Toggle water layers
  useEffect(() => {
    if (!isMapAlive(map)) return
    const layers = ['water-lines-layer', 'water-polygons-fill', 'water-springs-circle']
    for (const l of layers) {
      if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', waterVisible ? 'visible' : 'none')
    }
  }, [waterVisible, map])

  // Toggle slope layers
  useEffect(() => {
    if (!isMapAlive(map)) return
    const layers = ['slope-bands-fill', 'slope-bands-outline']
    for (const l of layers) {
      if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', slopeVisible ? 'visible' : 'none')
    }
  }, [slopeVisible, map])

  // Toggle anomaly layers
  useEffect(() => {
    if (!isMapAlive(map)) return
    const layers = ['anomaly-zones-fill', 'anomaly-zones-outline']
    for (const l of layers) {
      if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', anomalyVisible ? 'visible' : 'none')
    }
  }, [anomalyVisible, map])

  // Toggle route layers
  useEffect(() => {
    if (!isMapAlive(map)) return
    const layers = ['route-primary-line', 'route-alt-line']
    for (const l of layers) {
      if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', routeVisible ? 'visible' : 'none')
    }
  }, [routeVisible, map])

  // Toggle roads/transportation overlay
  useEffect(() => {
    if (!isMapAlive(map)) return
    if (map.getLayer('reference-transportation')) {
      map.setLayoutProperty('reference-transportation', 'visibility', roadsVisible ? 'visible' : 'none')
    }
  }, [roadsVisible, map])

  // Toggle place labels + boundaries overlay
  useEffect(() => {
    if (!isMapAlive(map)) return
    if (map.getLayer('reference-labels')) {
      map.setLayoutProperty('reference-labels', 'visibility', labelsVisible ? 'visible' : 'none')
    }
  }, [labelsVisible, map])

  return (
    <section className="panel layer-switcher-panel">
      <h2>Layers</h2>
      <div className="layer-switcher">
        <label className="layer-row">
          <input type="checkbox" checked={hillshade} onChange={toggleHillshade} />
          <span className="layer-name">Hillshade</span>
        </label>
        <label className="layer-row">
          <input type="checkbox" checked={terrain3d} onChange={toggleTerrain3d} />
          <span className="layer-name">3D Terrain</span>
        </label>
        <label className="layer-row">
          <input
            type="checkbox"
            checked={satelliteOpacity > 0}
            onChange={(e) => setSatelliteOpacity(e.target.checked ? 1.0 : 0.0)}
          />
          <span className="layer-name">Satellite</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={satelliteOpacity}
            onChange={(e) => setSatelliteOpacity(parseFloat(e.target.value))}
          />
        </label>
        <label className="layer-row">
          <input
            type="checkbox"
            checked={sentinelOpacity > 0}
            onChange={(e) => setSentinelOpacity(e.target.checked ? 0.7 : 0.0)}
          />
          <span className="layer-name">Sentinel-2</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={sentinelOpacity}
            onChange={(e) => setSentinelOpacity(parseFloat(e.target.value))}
          />
        </label>
        <label className="layer-row">
          <input type="checkbox" checked={waterVisible} onChange={(e) => setWaterVisible(e.target.checked)} />
          <span className="layer-name">Water</span>
        </label>
        <label className="layer-row">
          <input type="checkbox" checked={slopeVisible} onChange={(e) => setSlopeVisible(e.target.checked)} />
          <span className="layer-name">Slope</span>
        </label>
        <label className="layer-row">
          <input type="checkbox" checked={anomalyVisible} onChange={(e) => setAnomalyVisible(e.target.checked)} />
          <span className="layer-name">Anomalies</span>
        </label>
        <label className="layer-row">
          <input type="checkbox" checked={routeVisible} onChange={(e) => setRouteVisible(e.target.checked)} />
          <span className="layer-name">Route</span>
        </label>
        <label className="layer-row">
          <input type="checkbox" checked={roadsVisible} onChange={(e) => setRoadsVisible(e.target.checked)} />
          <span className="layer-name">Roads</span>
        </label>
        <label className="layer-row">
          <input type="checkbox" checked={labelsVisible} onChange={(e) => setLabelsVisible(e.target.checked)} />
          <span className="layer-name">Labels</span>
        </label>
      </div>
    </section>
  )
}
