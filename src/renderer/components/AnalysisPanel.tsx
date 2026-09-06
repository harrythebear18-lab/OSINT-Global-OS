import { useState, useEffect } from 'react'
import { useMap } from '../hooks/useMap'
import { useDemProfile, useSearchZones, useRestPoints, useRunoff, useSlopeAnalysis, useAnomalyAnalysis, useExport, useWater, useSentinel, useImportKml, useCanopy, useBehaviorEngine } from '../hooks/useAnalysis'
import { setAnalysisResults, clearAnalysisLayer } from './MapOverlays'
import type { LngLat, TripParams, AnalysisMode } from '@shared/types'
import { computeBounds } from '@shared/types'

interface AnalysisPanelProps {
  tripParams: TripParams
  /** Global analysis mode — drives all analysis tools */
  mode?: AnalysisMode
}

/**
 * Analysis panel — sidebar controls to run each analysis type.
 *
 * Model:
 *  - Selection (bbox/polygon) = the search area boundary. Analysis runs within it.
 *  - LKP = Last Known Point, placed by right-click on map.
 *    Falls back to map center if no pin placed.
 *  - TripParams = timeframe + hike parameters that drive all models.
 *  - Line = for elevation profiles (not area-based).
 */
export function AnalysisPanel({ tripParams, mode = 'active-sar' }: AnalysisPanelProps) {
  const { selection, selections, map, lkp, endPoint } = useMap()
  const profileHook = useDemProfile()
  const zonesHook = useSearchZones()
  const restHook = useRestPoints()
  const runoffHook = useRunoff()
  const slopeHook = useSlopeAnalysis()
  const anomalyHook = useAnomalyAnalysis()
  const exportHook = useExport()
  const waterHook = useWater()
  const sentinelHook = useSentinel()
  const importHook = useImportKml()
  const canopyHook = useCanopy()
  const behaviorHook = useBehaviorEngine()
  const [rainfallMm, setRainfallMm] = useState(50)
  const [activityProfile, setActivityProfile] = useState<'hiking' | 'scrambling' | 'sar'>('hiking')
  const [gibsLayerId, setGibsLayerId] = useState('modis-true-color')
  const [canopyHeightOverride, setCanopyHeightOverride] = useState<string>('')
  const [behaviorAgents, setBehaviorAgents] = useState(500)
  const [behaviorLiveTick, setBehaviorLiveTick] = useState(false)

  /** Clear a single analysis layer without resetting the rest of the map */
  const clearLayer = (key: string, hookClear?: () => void) => {
    clearAnalysisLayer(key as any)
    hookClear?.()
  }

  // Reset all analysis state when "Clear Map" is pressed
  useEffect(() => {
    const handler = () => {
      profileHook.clear()
      zonesHook.clear()
      restHook.clear()
      runoffHook.clear()
      slopeHook.clear()
      anomalyHook.clear()
      waterHook.clear()
      sentinelHook.clear()
      importHook.clear()
    }
    window.addEventListener('terrain:clear-all', handler)
    return () => window.removeEventListener('terrain:clear-all', handler)
  }, [])

  const hasLine = selection?.type === 'line' && selection.coords.length >= 2
  const hasArea = (selection?.type === 'bbox' || selection?.type === 'polygon') && selection.coords.length >= 3
  const multiBoxCount = selections.filter(s => (s.type === 'bbox' || s.type === 'polygon') && s.coords.length >= 3).length

  // LKP: use placed pin, or fall back to map center
  const getLkp = (): LngLat => {
    if (lkp) return lkp
    if (map) {
      const c = map.getCenter()
      return { lng: c.lng, lat: c.lat }
    }
    return { lng: 0, lat: 0 }
  }

  const runProfile = async () => {
    if (!hasLine || !selection) return
    await profileHook.run({ coords: selection.coords })
  }

  const runZones = async () => {
    const lkpPoint = getLkp()
    const res = await zonesHook.run({ lkp: lkpPoint, radii: [500, 1000, 3000, 5000], tripParams })
    if (res) setAnalysisResults({ zones: res })
  }

  const runRestPoints = async () => {
    const lkpPoint = getLkp()
    const bnds = getBounds()
    const res = await restHook.run({ lkp: lkpPoint, maxHours: tripParams.hoursSinceLastSeen, tripParams, bounds: bnds ?? undefined, mode })
    if (res) setAnalysisResults({ restPoints: res })
  }

  const getBounds = (): [LngLat, LngLat] | null => {
    if (!selection || selection.coords.length < 2) return null
    return computeBounds(selection.coords)
  }

  /** Get bounds for ALL drawn selections (multi-box support). */
  const getAllBounds = (): [LngLat, LngLat][] => {
    const allSels = selection ? [selection, ...selections.filter(s => s !== selection)] : selections
    return allSels
      .filter(s => (s.type === 'bbox' || s.type === 'polygon') && s.coords.length >= 3)
      .map(s => computeBounds(s.coords))
      .filter((b): b is [LngLat, LngLat] => b !== null)
  }

  const runRunoff = async () => {
    const allBounds = getAllBounds()
    if (allBounds.length === 0) return
    // Run on each bounding box and merge results
    const allResults: any[] = []
    for (const bounds of allBounds) {
      const res = await runoffHook.run({ bounds, rainfallMm })
      if (res) {
        allResults.push(res)
      }
    }
    if (allResults.length > 0) {
      // Merge: combine all flow paths, pooling areas, etc.
      const merged = {
        flowPaths: allResults.flatMap(r => r.flowPaths || []),
        poolingAreas: allResults.flatMap(r => r.poolingAreas || []),
        watershedDivides: allResults.flatMap(r => r.watershedDivides || []),
        floodRiskZones: allResults.flatMap(r => r.floodRiskZones || []),
      }
      setAnalysisResults({ runoff: merged })
    }
  }

  const runSlope = async () => {
    const allBounds = getAllBounds()
    if (allBounds.length === 0) return
    const allResults: any[] = []
    for (const bounds of allBounds) {
      const res = await slopeHook.run({ bounds, profile: activityProfile })
      if (res) allResults.push(res)
    }
    if (allResults.length > 0) {
      const merged = {
        bands: allResults.flatMap(r => r.bands || []),
        legend: allResults[0].legend || [],
      }
      setAnalysisResults({ slope: merged })
    }
  }

  const runAnomaly = async () => {
    const allBounds = getAllBounds()
    if (allBounds.length === 0) return
    const allResults: any[] = []
    for (const bounds of allBounds) {
      const res = await anomalyHook.run({ bounds })
      if (res) allResults.push(res)
    }
    if (allResults.length > 0) {
      const merged = {
        zones: allResults.flatMap(r => r.zones || []),
      }
      setAnalysisResults({ anomaly: merged })
    }
  }

  const runWater = async () => {
    const allBounds = getAllBounds()
    if (allBounds.length === 0) return
    const allResults: any[] = []
    for (const bounds of allBounds) {
      const res = await waterHook.run({ bounds })
      if (res) allResults.push(res)
    }
    if (allResults.length > 0) {
      const merged = {
        features: allResults.flatMap(r => r.features || []),
      }
      setAnalysisResults({ water: merged })
    }
  }

  const runSentinel = async () => {
    const bounds = getBounds()
    if (!bounds) return
    const res = await sentinelHook.run({ bounds, layerId: gibsLayerId })
    if (res && res.best) {
      setAnalysisResults({ sentinel: {
        tileUrl: res.best.tileUrl,
        id: res.best.id,
        maxZoom: res.best.maxZoom,
      } })
    }
  }

  const runCanopy = async () => {
    const bounds = getBounds()
    if (!bounds) return
    const override = canopyHeightOverride ? parseFloat(canopyHeightOverride) : undefined
    const res = await canopyHook.run({ bounds, mode, regionalCanopyHeightM: override })
    if (res) {
      setAnalysisResults({ canopy: res })
    }
  }

  const runBehavior = async () => {
    const bounds = getBounds()
    if (!bounds) return
    const sourcePoints: LngLat[] = []
    if (lkp) sourcePoints.push(lkp)
    const res = await behaviorHook.run({
      bounds,
      sourcePoints: sourcePoints.length > 0 ? sourcePoints : undefined,
      destination: endPoint ?? undefined,
      agentCount: behaviorAgents,
      tripParams,
      mode,
    })
    if (res) {
      setAnalysisResults({ behavior: res })
    }
  }

  // SAR mode: slow operational tick that re-runs the engine every 3 seconds
  // Legacy mode: single-shot, no tick
  useEffect(() => {
    if (!behaviorLiveTick) return
    if (mode !== 'active-sar') return
    if (!behaviorHook.result) return
    const interval = setInterval(() => {
      runBehavior()
    }, 3000)
    return () => clearInterval(interval)
  }, [behaviorLiveTick, mode, behaviorHook.result, behaviorAgents])

  const runImport = async () => {
    const res = await importHook.run()
    if (res) {
      setAnalysisResults({ imported: { features: res.features } })
      // Fly to the imported area
      if (map && res.features.length > 0) {
        const [sw, ne] = res.bounds
        map.fitBounds([[sw.lng, sw.lat], [ne.lng, ne.lat]], { padding: 50, duration: 2000 })
      }
    }
  }

  const doExportGeoJSON = async () => {
    await exportHook.exportGeoJSON(currentResults())
  }

  const doExportKML = async () => {
    await exportHook.exportKML(currentResults())
  }

  const doExportPng = async () => {
    await window.terrain.exportPng()
  }

  // Collect all current analysis results for export
  const currentResults = (): Record<string, unknown> => {
    const r: Record<string, unknown> = {}
    if (zonesHook.zones) r.zones = zonesHook.zones
    if (restHook.points) r.restPoints = restHook.points
    if (runoffHook.result) r.runoff = runoffHook.result
    if (slopeHook.result) r.slope = slopeHook.result
    if (anomalyHook.result) r.anomaly = anomalyHook.result
    return r
  }

  return (
    <section className="panel analysis-panel">
      <h2>Analysis</h2>

      {/* LKP status */}
      <div className="lkp-status">
        <span className={lkp ? 'active' : 'muted'}>
          {lkp ? `LKP: ${lkp.lng.toFixed(4)}, ${lkp.lat.toFixed(4)}` : 'No LKP pin — right-click to place'}
        </span>
        {hasArea && multiBoxCount > 1 && (
          <p className="analysis-hint active">
            {multiBoxCount} search areas drawn — analysis runs on all.
          </p>
        )}
        {!hasArea && (
          <p className="analysis-hint muted">
            Draw a bounding box or polygon to define the search area. Draw multiple for wider coverage.
          </p>
        )}
      </div>

      {/* Elevation profile */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={hasLine ? '' : 'muted'}>Elevation Profile</span>
          <button
            className="run-btn"
            onClick={runProfile}
            disabled={!hasLine || profileHook.loading}
          >
            {profileHook.loading ? '...' : 'Run'}
          </button>
          {profileHook.profile && <button className="clear-layer-btn" onClick={() => clearLayer('profile', profileHook.clear)}>✕</button>}
        </div>
        <p className="analysis-hint muted">Draw a line, then run</p>
        {profileHook.error && <p className="analysis-error">{profileHook.error}</p>}
      </div>

      {/* Search zones */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span>Search Zones</span>
          <button
            className="run-btn"
            onClick={runZones}
            disabled={zonesHook.loading}
          >
            {zonesHook.loading ? '...' : 'Run'}
          </button>
          {zonesHook.zones && <button className="clear-layer-btn" onClick={() => clearLayer('zones', zonesHook.clear)}>✕</button>}
        </div>
        <p className="analysis-hint muted">
          Auto-rings from {lkp ? 'LKP pin' : 'map center'} based on {tripParams.pace} pace, {tripParams.weather} weather
        </p>
        {zonesHook.error && <p className="analysis-error">{zonesHook.error}</p>}
        {zonesHook.zones && (
          <p className="analysis-result">
            {zonesHook.zones.zones.length} zones generated
          </p>
        )}
      </div>

      {/* Rest points */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span>Likely Rest Points</span>
          <button
            className="run-btn"
            onClick={runRestPoints}
            disabled={restHook.loading}
          >
            {restHook.loading ? '...' : 'Run'}
          </button>
          {restHook.points && <button className="clear-layer-btn" onClick={() => clearLayer('restPoints', restHook.clear)}>✕</button>}
        </div>
        <p className="analysis-hint muted">
          {mode === 'active-sar'
            ? `Within ${tripParams.hoursSinceLastSeen}h walk of ${lkp ? 'LKP pin' : 'map center'} (${tripParams.experience})`
            : `Terrain-based across search area. LKP used as reference only.`}
        </p>
        {restHook.error && <p className="analysis-error">{restHook.error}</p>}
        {restHook.points && (
          <p className="analysis-result">
            {restHook.points.points.length} candidates found
          </p>
        )}
      </div>

      {/* Rainfall runoff */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={hasArea ? '' : 'muted'}>Rainfall Runoff</span>
          <button
            className="run-btn"
            onClick={runRunoff}
            disabled={!hasArea || runoffHook.loading}
          >
            {runoffHook.loading ? '...' : 'Run'}
          </button>
          {runoffHook.result && <button className="clear-layer-btn" onClick={() => clearLayer('runoff', runoffHook.clear)}>✕</button>}
        </div>
        <div className="rainfall-slider">
          <label className="param-label">Rainfall: {rainfallMm}mm</label>
          <input
            type="range"
            min={0}
            max={200}
            value={rainfallMm}
            onChange={(e) => setRainfallMm(parseInt(e.target.value))}
            className="param-slider"
          />
          <div className="slider-ticks">
            <span>0</span>
            <span>50</span>
            <span>100</span>
            <span>200mm</span>
          </div>
        </div>
        <p className="analysis-hint muted">Flow paths, pooling, flood risk, watersheds</p>
        {runoffHook.error && <p className="analysis-error">{runoffHook.error}</p>}
        {runoffHook.result && (
          <p className="analysis-result">
            {runoffHook.result.flowPaths.length} flows, {runoffHook.result.poolingAreas.length} pools, {runoffHook.result.floodRiskZones.length} flood zones
          </p>
        )}
      </div>

      {/* Slope analysis */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={hasArea ? '' : 'muted'}>Slope Analysis</span>
          <button className="run-btn" onClick={runSlope} disabled={!hasArea || slopeHook.loading}>
            {slopeHook.loading ? '...' : 'Run'}
          </button>
          {slopeHook.result && <button className="clear-layer-btn" onClick={() => clearLayer('slope', slopeHook.clear)}>✕</button>}
        </div>
        <div className="btn-group" style={{ marginTop: '4px' }}>
          {(['hiking', 'scrambling', 'sar'] as const).map((p) => (
            <button
              key={p}
              className={'opt-btn ' + (activityProfile === p ? 'active' : '')}
              onClick={() => setActivityProfile(p)}
            >
              {p === 'sar' ? 'SAR' : p}
            </button>
          ))}
        </div>
        <p className="analysis-hint muted">Hillshade + impassable bands (Horn's method)</p>
        {slopeHook.error && <p className="analysis-error">{slopeHook.error}</p>}
        {slopeHook.result && (
          <>
            <p className="analysis-result">
              {slopeHook.result.bands.length} slope bands found
            </p>
            <div className="slope-legend">
              {slopeHook.result.legend.map((l) => (
                <div key={l.deg} className="legend-item">
                  <span className="legend-swatch" style={{ background: l.color }} />
                  <span className="legend-label">{l.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Terrain anomalies */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={hasArea ? '' : 'muted'}>Terrain Anomalies</span>
          <button className="run-btn" onClick={runAnomaly} disabled={!hasArea || anomalyHook.loading}>
            {anomalyHook.loading ? '...' : 'Run'}
          </button>
          {anomalyHook.result && <button className="clear-layer-btn" onClick={() => clearLayer('anomaly', anomalyHook.clear)}>✕</button>}
        </div>
        <p className="analysis-hint muted">Depressions + prominences (caves, sinkholes, ridges)</p>
        {anomalyHook.error && <p className="analysis-error">{anomalyHook.error}</p>}
        {anomalyHook.result && (
          <p className="analysis-result">
            {anomalyHook.result.zones.length} anomalies found
          </p>
        )}
      </div>

      {/* Water features */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={hasArea ? '' : 'muted'}>Water Features</span>
          <button className="run-btn" onClick={runWater} disabled={!hasArea || waterHook.loading}>
            {waterHook.loading ? '...' : 'Show'}
          </button>
          {waterHook.result && <button className="clear-layer-btn" onClick={() => clearLayer('water', waterHook.clear)}>✕</button>}
        </div>
        <p className="analysis-hint muted">OSM streams, lakes, springs (Overpass API)</p>
        {waterHook.error && <p className="analysis-error">{waterHook.error}</p>}
        {waterHook.result && (
          <p className="analysis-result">
            {waterHook.result.features.length} water features
          </p>
        )}
      </div>

      {/* Satellite imagery (NASA GIBS) */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={hasArea ? '' : 'muted'}>Satellite Imagery</span>
          <button className="run-btn" onClick={runSentinel} disabled={!hasArea || sentinelHook.loading}>
            {sentinelHook.loading ? '...' : 'Show'}
          </button>
          {sentinelHook.result && <button className="clear-layer-btn" onClick={() => clearLayer('sentinel', sentinelHook.clear)}>✕</button>}
        </div>
        <select
          className="analysis-select"
          value={gibsLayerId}
          onChange={(e) => setGibsLayerId(e.target.value)}
        >
          {sentinelHook.result?.layers?.length
            ? sentinelHook.result.layers.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.temporalResolution})</option>
              ))
            : <option value="modis-true-color">MODIS True Color (Daily)</option>
          }
        </select>
        <p className="analysis-hint muted">NASA GIBS — stable tiles, no scene IDs, no 404s</p>
        {sentinelHook.error && <p className="analysis-error">{sentinelHook.error}</p>}
        {sentinelHook.result && sentinelHook.result.best && (
          <p className="analysis-result">
            {sentinelHook.result.layers.length} layers available. Showing: {sentinelHook.result.best.id}, {sentinelHook.result.best.date}
          </p>
        )}
      </div>

      {/* Canopy Intelligence Layer */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span>Canopy Intelligence</span>
          <button className="run-btn" onClick={runCanopy} disabled={!hasArea || canopyHook.loading}>
            {canopyHook.loading ? '...' : 'Run'}
          </button>
          {canopyHook.result && <button className="clear-layer-btn" onClick={() => clearLayer('canopy', canopyHook.clear)}>✕</button>}
        </div>
        <p className="analysis-hint muted">
          Defoliation, dead trees, ground height correction. Auto-detects regional canopy height via geolocation + web search.
        </p>
        <div className="analysis-row" style={{ marginTop: '4px' }}>
          <input
            type="text"
            placeholder="Override canopy height (m) — leave blank for auto"
            value={canopyHeightOverride}
            onChange={(e) => setCanopyHeightOverride(e.target.value)}
            style={{
              flex: 1, padding: '4px 8px', fontSize: 11,
              background: 'var(--bg-input, #1a1a1a)',
              border: '1px solid var(--border, #333)',
              color: 'var(--text, #ccc)',
              borderRadius: 4,
            }}
          />
        </div>
        {canopyHook.error && <p className="analysis-error">{canopyHook.error}</p>}
        {canopyHook.result && (
          <div className="analysis-result" style={{ fontSize: 11, lineHeight: 1.5 }}>
            <strong>Region:</strong> {canopyHook.result.regionName}<br/>
            <strong>Biome:</strong> {canopyHook.result.biomeDescription}<br/>
            <strong>Canopy height:</strong> {canopyHook.result.regionalCanopyHeightM}m ({canopyHook.result.canopyHeightSource})<br/>
            <strong>Zones:</strong> {canopyHook.result.zones.length} found<br/>
            {canopyHook.result.zones.filter(z => z.type === 'defoliation').length > 0 && (
              <span style={{ color: '#e74c3c' }}>
                {canopyHook.result.zones.filter(z => z.type === 'defoliation').length} defoliation zones<br/>
              </span>
            )}
            {canopyHook.result.zones.filter(z => z.type === 'dead-trees').length > 0 && (
              <span style={{ color: '#8b6914' }}>
                {canopyHook.result.zones.filter(z => z.type === 'dead-trees').length} dead tree clusters<br/>
              </span>
            )}
            {canopyHook.result.zones.filter(z => z.type === 'clearing').length > 0 && (
              <span style={{ color: '#4ea1ff' }}>
                {canopyHook.result.zones.filter(z => z.type === 'clearing').length} clearings<br/>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Behavior Engine */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={hasArea ? '' : 'muted'}>Behavior Engine</span>
          <button className="run-btn" onClick={runBehavior} disabled={!hasArea || behaviorHook.loading}>
            {behaviorHook.loading ? '...' : 'Run'}
          </button>
          {behaviorHook.result && <button className="clear-layer-btn" onClick={() => { setBehaviorLiveTick(false); clearLayer('behavior', behaviorHook.clear) }}>✕</button>}
        </div>
        <p className="analysis-hint muted">
          Terrain-driven behavior simulation. Predicts group paths, decision points, density zones, and probability fields.
        </p>
        <div className="rainfall-slider">
          <label className="param-label">Agents: {behaviorAgents}</label>
          <input
            type="range"
            min="50"
            max="5000"
            step="50"
            value={behaviorAgents}
            onChange={(e) => setBehaviorAgents(parseInt(e.target.value))}
          />
        </div>
        {lkp && <p className="analysis-hint">Source: LKP</p>}
        {endPoint && <p className="analysis-hint">Destination: End point</p>}
        {!endPoint && <p className="analysis-hint muted">No destination set — agents will follow terrain corridors</p>}
        {mode === 'active-sar' && behaviorHook.result && (
          <div className="rest-mode-toggle">
            <button
              className={`mode-btn ${behaviorLiveTick ? 'active' : ''}`}
              onClick={() => setBehaviorLiveTick(!behaviorLiveTick)}
              title="SAR mode: refresh predictions every 3 seconds as terrain state evolves"
            >
              {behaviorLiveTick ? 'Live tick ON' : 'Live tick OFF'}
            </button>
          </div>
        )}
        {mode === 'legacy-research' && (
          <p className="analysis-hint muted">Legacy mode: single-shot prediction (no live tick)</p>
        )}
        {behaviorHook.error && <p className="analysis-error">{behaviorHook.error}</p>}
        {behaviorHook.result && (
          <p className="analysis-result">
            {behaviorHook.result.paths.length} paths | {behaviorHook.result.decisionPoints.length} decision points | {behaviorHook.result.densityZones.length} density zones | {behaviorHook.result.probabilityField.length} probability cells
          </p>
        )}
      </div>

      {/* Import KML/KMZ */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span>Import Project</span>
          <button className="run-btn" onClick={runImport} disabled={importHook.loading}>
            {importHook.loading ? '...' : 'Open'}
          </button>
        </div>
        <p className="analysis-hint muted">Load KML/KMZ from Google Earth (waypoints, tracks, polygons)</p>
        {importHook.error && <p className="analysis-error">{importHook.error}</p>}
        {importHook.result && (
          <p className="analysis-result">
            {importHook.result.fileName}: {importHook.result.featureCount} features loaded
          </p>
        )}
      </div>

      {/* Export */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span>Export Results</span>
        </div>
        <div className="btn-group" style={{ marginTop: '4px' }}>
          <button
            className="opt-btn"
            onClick={doExportGeoJSON}
            disabled={exportHook.exporting}
          >
            {exportHook.exporting ? '...' : 'GeoJSON'}
          </button>
          <button
            className="opt-btn"
            onClick={doExportKML}
            disabled={exportHook.exporting}
          >
            {exportHook.exporting ? '...' : 'KML'}
          </button>
          <button
            className="opt-btn"
            onClick={doExportPng}
          >
            PNG
          </button>
        </div>
        <p className="analysis-hint muted">Export all analysis layers for QGIS / Google Earth / screenshot</p>
      </div>
    </section>
  )
}
