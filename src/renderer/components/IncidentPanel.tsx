import { useEffect } from 'react'
import { useMap } from '../hooks/useMap'
import { useRoutePlan, useFallRisk, useRemainsCorridor } from '../hooks/useAnalysis'
import { setAnalysisResults } from './MapOverlays'
import type { LngLat, TripParams } from '@shared/types'
import { isWithinBounds, computeBounds } from '@shared/types'

interface IncidentPanelProps {
  tripParams: TripParams
}

/**
 * Incident Analysis Mode — the Fall -> Flow -> Find pipeline.
 *
 * Sub-tools:
 *  1. Route Planning: terrain-aware path from start to end (where would they walk?)
 *  2. Fall Risk Map: where are they likely to fall along that route?
 *  3. Remains Corridor: downhill-only search from a fall point (where do they end up?)
 *
 * All analysis is constrained to the drawn bounding area.
 * Points placed outside the area are flagged and analysis is blocked.
 */
export function IncidentPanel({ tripParams }: IncidentPanelProps) {
  const { selection, map, lkp, endPoint, fallPoint } = useMap()
  const routeHook = useRoutePlan()
  const fallRiskHook = useFallRisk()
  const corridorHook = useRemainsCorridor()

  // Reset all incident analysis state when "Clear Map" is pressed
  useEffect(() => {
    const handler = () => {
      routeHook.clear()
      fallRiskHook.clear()
      corridorHook.clear()
    }
    window.addEventListener('terrain:clear-all', handler)
    return () => window.removeEventListener('terrain:clear-all', handler)
  }, [])

  const hasArea = (selection?.type === 'bbox' || selection?.type === 'polygon') && selection.coords.length >= 3

  const getBounds = (): [LngLat, LngLat] | null => {
    if (!selection || selection.coords.length < 2) return null
    return computeBounds(selection.coords)
  }

  const bounds = getBounds()

  // Validate points are within the drawn area (with small tolerance for edge clicks)
  const tolerance = 0.01
  const expandedBounds: [LngLat, LngLat] | null = bounds
    ? [
        { lng: bounds[0].lng - tolerance, lat: bounds[0].lat - tolerance },
        { lng: bounds[1].lng + tolerance, lat: bounds[1].lat + tolerance },
      ]
    : null
  const startInBounds = lkp && expandedBounds ? isWithinBounds(lkp, expandedBounds) : false
  const endInBounds = endPoint && expandedBounds ? isWithinBounds(endPoint, expandedBounds) : false
  const fallInBounds = fallPoint && expandedBounds ? isWithinBounds(fallPoint, expandedBounds) : false

  // Start = LKP (right-click pin), End = shift+click point
  const getStart = (): LngLat => {
    if (lkp) return lkp
    if (map) { const c = map.getCenter(); return { lng: c.lng, lat: c.lat } }
    return { lng: 0, lat: 0 }
  }

  const getEnd = (): LngLat => {
    if (endPoint) return endPoint
    if (map) { const c = map.getCenter(); return { lng: c.lng, lat: c.lat } }
    return { lng: 0, lat: 0 }
  }

  const runRoute = async () => {
    if (!bounds) return
    const res = await routeHook.run({
      start: getStart(),
      end: getEnd(),
      bounds,
      tripParams,
      includeAlternatives: true,
    })
    if (res) setAnalysisResults({ route: res })
  }

  const runFallRisk = async () => {
    if (!bounds) return
    const res = await fallRiskHook.run({ bounds, tripParams })
    if (res) setAnalysisResults({ fallRisk: res })
  }

  const runCorridor = async () => {
    if (!bounds) return
    const fp = fallPoint ?? getStart()
    const res = await corridorHook.run({ fallPoint: fp, bounds, rainfallMm: 0 })
    if (res) setAnalysisResults({ corridor: res })
  }

  // Can run route only if both start and end are within bounds (or fall back to center)
  const canRunRoute = hasArea && (!!startInBounds || !lkp) && (!!endInBounds || !endPoint)
  const canRunCorridor = hasArea && (!!fallInBounds || !fallPoint) && (!!startInBounds || !lkp || !!fallPoint)

  return (
    <section className="panel incident-panel">
      <h2>Incident Analysis</h2>
      <p className="incident-tagline">Fall {'->'} Flow {'->'} Find pipeline</p>

      {/* Analysis area status */}
      <div className={'area-status ' + (hasArea ? 'active' : 'warning')}>
        {hasArea
          ? 'Analysis area set (' + selection?.type + ')'
          : 'Draw a bounding box or polygon first'}
      </div>

      {/* Start / End / Fall point status */}
      <div className="incident-points">
        <div className="point-status">
          <span className="point-label">Start (LKP):</span>
          <span className={lkp ? (startInBounds ? 'active' : 'warning') : 'muted'}>
            {lkp
              ? startInBounds
                ? lkp.lng.toFixed(4) + ', ' + lkp.lat.toFixed(4)
                : 'outside area!'
              : 'right-click to set'}
          </span>
        </div>
        <div className="point-status">
          <span className="point-label">End point:</span>
          <span className={endPoint ? (endInBounds ? 'active' : 'warning') : 'muted'}>
            {endPoint
              ? endInBounds
                ? endPoint.lng.toFixed(4) + ', ' + endPoint.lat.toFixed(4)
                : 'outside area!'
              : 'shift+click to set'}
          </span>
        </div>
        <div className="point-status">
          <span className="point-label">Fall point:</span>
          <span className={fallPoint ? (fallInBounds ? 'active danger' : 'warning') : 'muted'}>
            {fallPoint
              ? fallInBounds
                ? fallPoint.lng.toFixed(4) + ', ' + fallPoint.lat.toFixed(4)
                : 'outside area!'
              : 'click route to set'}
          </span>
        </div>
      </div>

      {/* Route Planning */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={canRunRoute ? '' : 'muted'}>1. Plan Route</span>
          <button className="run-btn" onClick={runRoute} disabled={!canRunRoute || routeHook.loading}>
            {routeHook.loading ? '...' : 'Run'}
          </button>
        </div>
        <p className="analysis-hint muted">Terrain-aware path within analysis area</p>
        {lkp && !startInBounds && <p className="analysis-warning">Start point is outside the drawn area</p>}
        {endPoint && !endInBounds && <p className="analysis-warning">End point is outside the drawn area</p>}
        {routeHook.error && <p className="analysis-error">{routeHook.error}</p>}
        {routeHook.result && (
          <div className="route-stats">
            <span>{(routeHook.result.primary.totalDistanceM / 1000).toFixed(1)} km</span>
            <span>{routeHook.result.primary.estimatedHours.toFixed(1)}h</span>
            <span className={routeHook.result.primary.hasDangerSections ? 'danger' : ''}>
              {routeHook.result.primary.hasDangerSections ? 'danger sections' : 'safe'}
            </span>
            <span>{routeHook.result.alternatives.length} alternatives</span>
          </div>
        )}
      </div>

      {/* Fall Risk Map */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={hasArea ? '' : 'muted'}>2. Fall Risk Map</span>
          <button className="run-btn" onClick={runFallRisk} disabled={!hasArea || fallRiskHook.loading}>
            {fallRiskHook.loading ? '...' : 'Run'}
          </button>
        </div>
        <p className="analysis-hint muted">Analyzes terrain within drawn area only</p>
        {fallRiskHook.error && <p className="analysis-error">{fallRiskHook.error}</p>}
        {fallRiskHook.result && (
          <p className="analysis-result">
            {fallRiskHook.result.zones.length} risk zones
          </p>
        )}
      </div>

      {/* Remains Corridor */}
      <div className="analysis-item">
        <div className="analysis-row">
          <span className={canRunCorridor ? '' : 'muted'}>3. Remains Corridor</span>
          <button className="run-btn" onClick={runCorridor} disabled={!canRunCorridor || corridorHook.loading}>
            {corridorHook.loading ? '...' : 'Run'}
          </button>
        </div>
        <p className="analysis-hint muted">
          Downhill-only from {fallPoint ? 'fall point' : 'LKP'} - stays within area
        </p>
        {fallPoint && !fallInBounds && <p className="analysis-warning">Fall point is outside the drawn area</p>}
        {corridorHook.error && <p className="analysis-error">{corridorHook.error}</p>}
        {corridorHook.result && (
          <p className="analysis-result">
            {corridorHook.result.paths.length} paths, {corridorHook.result.depositionZones.length} deposition zones
          </p>
        )}
      </div>
    </section>
  )
}
