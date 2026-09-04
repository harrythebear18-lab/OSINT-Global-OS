import { useState, useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useMap } from '../hooks/useMap'
import { useRadar, useForecast } from '../hooks/useAnalysis'
import { buildRadarTileUrl, buildSatelliteTileUrl } from '../../main/services/weather-service'
import { describeWeatherCode } from '../../main/services/weather-service'

/**
 * Weather panel — radar overlay + forecast.
 *
 * Brings weather-radar project data into Terrain Scout:
 *  - RainViewer animated radar/satellite tiles
 *  - Open-Meteo current weather + 24h forecast for LKP
 */
export function WeatherPanel() {
  const { lkp, map } = useMap()
  const radarHook = useRadar()
  const forecastHook = useForecast()
  const [showRadar, setShowRadar] = useState(false)
  const [showSatellite, setShowSatellite] = useState(false)
  const [frameIdx, setFrameIdx] = useState(0)

  // Fetch radar data on mount
  useEffect(() => {
    radarHook.run()
  }, [])

  // Reset weather state when "Clear Map" is pressed
  useEffect(() => {
    const handler = () => {
      setShowRadar(false)
      setShowSatellite(false)
      setFrameIdx(0)
    }
    window.addEventListener('terrain:clear-all', handler)
    return () => window.removeEventListener('terrain:clear-all', handler)
  }, [])

  // Auto-advance frames when radar is showing
  useEffect(() => {
    if (!showRadar || !radarHook.result) return
    const allFrames = [...radarHook.result.radarPast, ...radarHook.result.radarNowcast]
    if (allFrames.length === 0) return
    const interval = setInterval(() => {
      setFrameIdx((i) => (i + 1) % allFrames.length)
    }, 800)
    return () => clearInterval(interval)
  }, [showRadar, radarHook.result])

  // Render radar tiles on map
  useEffect(() => {
    if (!map || !radarHook.result) return
    const allFrames = [...radarHook.result.radarPast, ...radarHook.result.radarNowcast]
    if (allFrames.length === 0) return
    const frame = allFrames[frameIdx % allFrames.length]
    const url = buildRadarTileUrl(radarHook.result.host, frame)

    if (showRadar) {
      const existing = map.getSource('radar-tiles') as maplibregl.RasterTileSource | undefined
      if (existing) {
        // Update tiles in-place — avoids remove/add flicker and the
        // GeoJSONSource.setData() bug (raster sources have no setData).
        existing.setTiles([url])
      } else {
        map.addSource('radar-tiles', { type: 'raster', tiles: [url], tileSize: 256 })
        map.addLayer({ id: 'radar-tiles-layer', type: 'raster', source: 'radar-tiles', paint: { 'raster-opacity': 0.6 } })
      }
    } else {
      if (map.getLayer('radar-tiles-layer')) map.removeLayer('radar-tiles-layer')
      if (map.getSource('radar-tiles')) map.removeSource('radar-tiles')
    }
  }, [showRadar, frameIdx, radarHook.result, map])

  // Render satellite tiles on map
  useEffect(() => {
    if (!map || !radarHook.result) return
    const frames = radarHook.result.satellite
    if (frames.length === 0) return
    const frame = frames[0]
    const url = buildSatelliteTileUrl(radarHook.result.host, frame)

    if (showSatellite) {
      if (map.getSource('sat-tiles')) {
        map.removeLayer('sat-tiles-layer')
        map.removeSource('sat-tiles')
      }
      map.addSource('sat-tiles', { type: 'raster', tiles: [url], tileSize: 256 })
      map.addLayer({ id: 'sat-tiles-layer', type: 'raster', source: 'sat-tiles', paint: { 'raster-opacity': 0.5 } })
    } else {
      if (map.getLayer('sat-tiles-layer')) map.removeLayer('sat-tiles-layer')
      if (map.getSource('sat-tiles')) map.removeSource('sat-tiles')
    }
  }, [showSatellite, radarHook.result, map])

  const fetchForecast = async () => {
    if (!lkp) return
    await forecastHook.run(lkp)
  }

  const allFrames = radarHook.result ? [...radarHook.result.radarPast, ...radarHook.result.radarNowcast] : []

  return (
    <div className="weather-panel">
      <h3>Radar & Weather</h3>

      {/* Radar toggles */}
      <div className="layer-switcher">
        <label className="layer-row">
          <input type="checkbox" checked={showRadar} onChange={(e) => setShowRadar(e.target.checked)} />
          <span className="layer-name">Radar (animated)</span>
        </label>
        <label className="layer-row">
          <input type="checkbox" checked={showSatellite} onChange={(e) => setShowSatellite(e.target.checked)} />
          <span className="layer-name">Satellite (IR)</span>
        </label>
      </div>

      {/* Frame timeline */}
      {showRadar && allFrames.length > 0 && (
        <div className="radar-timeline">
          <input
            type="range"
            min="0"
            max={allFrames.length - 1}
            value={frameIdx}
            onChange={(e) => setFrameIdx(parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
          <p className="muted" style={{ fontSize: '9px' }}>
            Frame {frameIdx + 1}/{allFrames.length} — {new Date(allFrames[frameIdx].time * 1000).toLocaleTimeString()}
          </p>
        </div>
      )}

      {/* Forecast */}
      <div style={{ marginTop: '8px' }}>
        <div className="analysis-row">
          <span className={lkp ? '' : 'muted'}>Forecast at LKP</span>
          <button className="run-btn" onClick={fetchForecast} disabled={!lkp || forecastHook.loading}>
            {forecastHook.loading ? '...' : 'Get'}
          </button>
        </div>
        {!lkp && <p className="analysis-hint muted">Right-click to place LKP first</p>}
        {forecastHook.error && <p className="analysis-error">{forecastHook.error}</p>}
        {forecastHook.result && (
          <div className="forecast-display">
            <div className="forecast-current">
              <strong>{forecastHook.result.current.temperature.toFixed(0)}°C</strong>
              <span className="muted"> (feels {forecastHook.result.current.apparentTemp.toFixed(0)}°C)</span>
              <br />
              <span>{describeWeatherCode(forecastHook.result.current.weatherCode)}</span>
              <br />
              <span className="muted" style={{ fontSize: '10px' }}>
                Wind {forecastHook.result.current.windSpeed.toFixed(0)} km/h · Humidity {forecastHook.result.current.humidity.toFixed(0)}% · Precip {forecastHook.result.current.precipitation.toFixed(1)}mm
              </span>
            </div>
            <div className="forecast-hourly">
              {forecastHook.result.hourly.slice(0, 8).map((h, i) => (
                <div key={i} className="forecast-hour">
                  <span className="muted">{new Date(h.time).getHours()}:00</span>
                  <span>{h.temp.toFixed(0)}°</span>
                  <span className="muted">{h.precipProb.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
