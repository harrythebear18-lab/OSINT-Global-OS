import { useState } from 'react'

/**
 * PredictionPanel — 7-model prediction engine display.
 *
 * Ported from weather-radar's PredictionPanel.tsx, adapted to plain CSS.
 *
 * Shows:
 *  1. Summary stats (total, high risk, critical, avg confidence)
 *  2. Radar Nowcast (confidence, trend, precipitation intensity)
 *  3. Storm Track Predictions (expandable, with track points)
 *  4. Climate Anomaly Predictions (expandable, SST/pressure/etc.)
 *  5. Sensor Failure Predictions (expandable, failure probability)
 *  6. Ocean-Atmosphere Coupling (expandable, coupled patterns)
 *  7. Severe Weather Alerts (expandable, severity/radius/area)
 *  8. Precipitation Forecast (expandable, probability/intensity grid)
 */

interface Props {
  prediction: any | null
}

function riskColor(risk: string): string {
  switch (risk) {
    case 'critical': return '#ef4444'
    case 'high': return '#f97316'
    case 'moderate': return '#fbbf24'
    case 'low': return '#3b82f6'
    default: return 'var(--muted)'
  }
}

function confidenceColor(conf: string): string {
  switch (conf) {
    case 'high': return '#10b981'
    case 'medium': return '#fbbf24'
    case 'low': return '#ef4444'
    default: return 'var(--muted)'
  }
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

function toggleSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function PredictionPanel({ prediction }: Props) {
  const [expandedStorms, setExpandedStorms] = useState<Set<string>>(new Set())
  const [expandedAnomalies, setExpandedAnomalies] = useState<Set<string>>(new Set())
  const [expandedFailures, setExpandedFailures] = useState<Set<string>>(new Set())
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set())
  const [expandedCoupling, setExpandedCoupling] = useState(false)
  const [expandedPrecip, setExpandedPrecip] = useState(false)

  if (!prediction) {
    return (
      <div className="rip-empty">
        <div className="rip-empty-icon">🧠</div>
        <p>Waiting for prediction data...</p>
        <p className="rip-empty-sub">Engine starts ~5s after climate data loads</p>
      </div>
    )
  }

  const { summary, radarNowcast, stormTracks, climateAnomalies, sensorFailures, oceanAtmosphereCoupling, severeWeather, precipitationForecast } = prediction

  return (
    <div className="rip-scroll">
      {/* Header */}
      <div className="rip-pred-header">
        <span className="rip-icon">🧠</span>
        <span className="rip-pred-title">Predictions</span>
        <span className="rip-pred-time">{timeAgo(prediction.timestamp)}</span>
      </div>

      {/* Summary Stats */}
      <div className="rip-pred-summary">
        <div className="rip-pred-stat">
          <div className="rip-pred-stat-val">{summary.totalPredictions}</div>
          <div className="rip-pred-stat-label">Total</div>
        </div>
        <div className="rip-pred-stat">
          <div className="rip-pred-stat-val" style={{ color: '#f97316' }}>{summary.highRiskCount}</div>
          <div className="rip-pred-stat-label">High Risk</div>
        </div>
        <div className="rip-pred-stat">
          <div className="rip-pred-stat-val" style={{ color: '#ef4444' }}>{summary.criticalRiskCount}</div>
          <div className="rip-pred-stat-label">Critical</div>
        </div>
        <div className="rip-pred-stat">
          <div className="rip-pred-stat-val" style={{ color: 'var(--accent)' }}>{summary.avgConfidence.toFixed(0)}%</div>
          <div className="rip-pred-stat-label">Confidence</div>
        </div>
      </div>

      {/* Radar Nowcast */}
      {radarNowcast && (
        <div className="rip-section">
          <div className="rip-subheader">
            <span className="rip-icon" style={{ color: 'var(--accent)' }}>📡</span>
            Radar Nowcast
          </div>
          <div className="rip-pred-card">
            <div className="rip-pred-card-row">
              <span className="rip-muted">Confidence:</span>
              <strong style={{ color: confidenceColor(radarNowcast.confidence) }}>
                {radarNowcast.confidence?.toUpperCase() ?? 'N/A'}
              </strong>
            </div>
            {radarNowcast.trend && (
              <div className="rip-pred-card-row">
                <span className="rip-muted">Trend:</span>
                <strong>{radarNowcast.trend}</strong>
              </div>
            )}
            {radarNowcast.precipIntensity !== undefined && (
              <div className="rip-pred-card-row">
                <span className="rip-muted">Precip intensity:</span>
                <strong>{radarNowcast.precipIntensity.toFixed(2)} mm/h</strong>
              </div>
            )}
            {radarNowcast.estimatedArrivalMin !== undefined && (
              <div className="rip-pred-card-row">
                <span className="rip-muted">Est. arrival:</span>
                <strong>{radarNowcast.estimatedArrivalMin} min</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Storm Tracks */}
      {stormTracks && stormTracks.length > 0 && (
        <div className="rip-section">
          <div className="rip-subheader">
            <span className="rip-icon" style={{ color: '#ff6600' }}>🌀</span>
            Storm Tracks ({stormTracks.length})
          </div>
          <div className="rip-pred-list">
            {stormTracks.map((st: any) => {
              const id = st.stormId || st.name || Math.random().toString()
              const isExpanded = expandedStorms.has(id)
              return (
                <div key={id} className="rip-pred-item" style={{ borderColor: riskColor(st.riskLevel) + '40' }}>
                  <div className="rip-pred-item-header" onClick={() => setExpandedStorms((p) => toggleSet(p, id))}>
                    <span className="rip-pred-item-name">{st.stormName || st.name || 'Unknown'}</span>
                    <span className="rip-risk-badge" style={{ color: riskColor(st.riskLevel) }}>{st.riskLevel}</span>
                    <span className="rip-conf-badge" style={{ color: confidenceColor(st.confidence) }}>{st.confidence?.toUpperCase()}</span>
                    <span className="rip-arrow">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div className="rip-expand-body">
                      {st.currentPosition && (
                        <div className="rip-pred-card-row">
                          <span className="rip-muted">Current:</span>
                          <strong>{st.currentPosition.lat?.toFixed(1)}°, {st.currentPosition.lon?.toFixed(1)}°</strong>
                        </div>
                      )}
                      {st.predictedTrack && st.predictedTrack.length > 0 && (
                        <div className="rip-cv-subsection">
                          <div className="rip-cv-subheader">Predicted Track ({st.predictedTrack.length} points)</div>
                          {st.predictedTrack.slice(0, 8).map((pt: any, i: number) => (
                            <div key={i} className="rip-cv-check-row">
                              <span className="rip-muted">+{pt.hoursFromNow || i}h</span>
                              <span>{pt.lat?.toFixed(1)}°, {pt.lon?.toFixed(1)}°</span>
                              {pt.windSpeedKt && <span className="rip-muted">{pt.windSpeedKt}kt</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {st.reasoning && <div className="rip-muted-italic">{st.reasoning}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Climate Anomalies */}
      {climateAnomalies && climateAnomalies.length > 0 && (
        <div className="rip-section">
          <div className="rip-subheader">
            <span className="rip-icon" style={{ color: '#ff6600' }}>📈</span>
            Climate Anomalies ({climateAnomalies.length})
          </div>
          <div className="rip-pred-list">
            {climateAnomalies.map((a: any, i: number) => {
              const id = a.id || `anom-${i}`
              const isExpanded = expandedAnomalies.has(id)
              return (
                <div key={id} className="rip-pred-item" style={{ borderColor: riskColor(a.severity) + '40' }}>
                  <div className="rip-pred-item-header" onClick={() => setExpandedAnomalies((p) => toggleSet(p, id))}>
                    <span className="rip-pred-item-name">{a.type?.replace(/_/g, ' ') || 'Anomaly'}</span>
                    <span className="rip-risk-badge" style={{ color: riskColor(a.severity) }}>{a.severity}</span>
                    <span className="rip-conf-badge" style={{ color: confidenceColor(a.confidence) }}>{a.confidence?.toUpperCase()}</span>
                    <span className="rip-arrow">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div className="rip-expand-body">
                      {a.region && <div className="rip-pred-card-row"><span className="rip-muted">Region:</span><strong>{a.region}</strong></div>}
                      {a.value !== undefined && <div className="rip-pred-card-row"><span className="rip-muted">Value:</span><strong>{a.value.toFixed(2)}</strong></div>}
                      {a.expected !== undefined && <div className="rip-pred-card-row"><span className="rip-muted">Expected:</span><strong>{a.expected.toFixed(2)}</strong></div>}
                      {a.deviation !== undefined && <div className="rip-pred-card-row"><span className="rip-muted">Deviation:</span><strong style={{ color: Math.abs(a.deviation) > 2 ? '#ef4444' : 'inherit' }}>{a.deviation.toFixed(2)}σ</strong></div>}
                      {a.description && <div className="rip-muted-italic">{a.description}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sensor Failures */}
      {sensorFailures && sensorFailures.length > 0 && (
        <div className="rip-section">
          <div className="rip-subheader">
            <span className="rip-icon" style={{ color: '#fbbf24' }}>⚠</span>
            Sensor Failure Predictions ({sensorFailures.length})
          </div>
          <div className="rip-pred-list">
            {sensorFailures.map((sf: any, i: number) => {
              const id = sf.stationId || `sf-${i}`
              const isExpanded = expandedFailures.has(id)
              return (
                <div key={id} className="rip-pred-item" style={{ borderColor: riskColor(sf.riskLevel) + '40' }}>
                  <div className="rip-pred-item-header" onClick={() => setExpandedFailures((p) => toggleSet(p, id))}>
                    <span className="rip-pred-item-name">{sf.stationName || sf.stationId}</span>
                    <span className="rip-risk-badge" style={{ color: riskColor(sf.riskLevel) }}>{sf.riskLevel}</span>
                    <span className="rip-conf-badge" style={{ color: confidenceColor(sf.confidence) }}>{sf.confidence?.toUpperCase()}</span>
                    <span className="rip-arrow">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div className="rip-expand-body">
                      {sf.failureProbability !== undefined && (
                        <div className="rip-pred-card-row">
                          <span className="rip-muted">Failure prob:</span>
                          <strong style={{ color: sf.failureProbability > 0.5 ? '#ef4444' : '#fbbf24' }}>
                            {(sf.failureProbability * 100).toFixed(0)}%
                          </strong>
                        </div>
                      )}
                      {sf.timeHorizon && (
                        <div className="rip-pred-card-row"><span className="rip-muted">Horizon:</span><strong>{sf.timeHorizon}</strong></div>
                      )}
                      {sf.affectedFields && sf.affectedFields.length > 0 && (
                        <div className="rip-pred-card-row"><span className="rip-muted">Fields:</span><strong>{sf.affectedFields.join(', ')}</strong></div>
                      )}
                      {sf.reasoning && <div className="rip-muted-italic">{sf.reasoning}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Ocean-Atmosphere Coupling */}
      {oceanAtmosphereCoupling && (
        <div className="rip-section">
          <div className="rip-subheader">
            <span className="rip-icon" style={{ color: '#06b6d4' }}>🌊</span>
            Ocean-Atmosphere Coupling
          </div>
          <div className="rip-pred-card">
            {oceanAtmosphereCoupling.pattern && (
              <div className="rip-pred-card-row">
                <span className="rip-muted">Pattern:</span><strong>{oceanAtmosphereCoupling.pattern}</strong>
              </div>
            )}
            {oceanAtmosphereCoupling.couplingStrength !== undefined && (
              <div className="rip-pred-card-row">
                <span className="rip-muted">Coupling:</span>
                <strong>{(oceanAtmosphereCoupling.couplingStrength * 100).toFixed(0)}%</strong>
              </div>
            )}
            {oceanAtmosphereCoupling.sstAnomalies && oceanAtmosphereCoupling.sstAnomalies.length > 0 && (
              <button
                className="rip-collapse-header"
                onClick={() => setExpandedCoupling(!expandedCoupling)}
              >
                <span>SST Anomalies ({oceanAtmosphereCoupling.sstAnomalies.length})</span>
                <span className="rip-arrow">{expandedCoupling ? '▾' : '▸'}</span>
              </button>
            )}
            {expandedCoupling && oceanAtmosphereCoupling.sstAnomalies && (
              <div className="rip-pred-list">
                {oceanAtmosphereCoupling.sstAnomalies.map((a: any, i: number) => (
                  <div key={i} className="rip-pred-card-row">
                    <span className="rip-muted">{a.region || `${a.lat?.toFixed(0)}°,${a.lon?.toFixed(0)}°`}</span>
                    <strong style={{ color: a.anomaly > 0 ? '#ff6600' : '#0099ff' }}>
                      {a.anomaly > 0 ? '+' : ''}{a.anomaly?.toFixed(2)}°C
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Severe Weather Alerts */}
      {severeWeather && severeWeather.alerts && severeWeather.alerts.length > 0 && (
        <div className="rip-section">
          <div className="rip-subheader">
            <span className="rip-icon" style={{ color: '#ef4444' }}>🚨</span>
            Severe Weather Alerts ({severeWeather.alerts.length})
          </div>
          {severeWeather.globalRisk !== undefined && (
            <div className="rip-pred-card-row" style={{ padding: '4px 8px' }}>
              <span className="rip-muted">Global risk:</span>
              <strong style={{ color: riskColor(severeWeather.globalRisk > 70 ? 'critical' : severeWeather.globalRisk > 40 ? 'high' : 'low') }}>
                {severeWeather.globalRisk}%
              </strong>
            </div>
          )}
          <div className="rip-pred-list">
            {severeWeather.alerts.map((alert: any, i: number) => {
              const id = alert.id || `alert-${i}`
              const isExpanded = expandedAlerts.has(id)
              return (
                <div key={id} className="rip-pred-item" style={{ borderColor: riskColor(alert.severity) + '40' }}>
                  <div className="rip-pred-item-header" onClick={() => setExpandedAlerts((p) => toggleSet(p, id))}>
                    <span className="rip-pred-item-name">{alert.title || alert.severity}</span>
                    <span className="rip-risk-badge" style={{ color: riskColor(alert.severity) }}>{alert.severity}</span>
                    {alert.radiusKm && <span className="rip-muted">{alert.radiusKm}km</span>}
                    <span className="rip-arrow">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div className="rip-expand-body">
                      {alert.lat !== undefined && (
                        <div className="rip-pred-card-row">
                          <span className="rip-muted">Center:</span>
                          <strong>{alert.lat?.toFixed(1)}°, {alert.lon?.toFixed(1)}°</strong>
                        </div>
                      )}
                      {alert.radiusKm && (
                        <div className="rip-pred-card-row"><span className="rip-muted">Radius:</span><strong>{alert.radiusKm} km</strong></div>
                      )}
                      {alert.timeframe && (
                        <div className="rip-pred-card-row"><span className="rip-muted">Timeframe:</span><strong>{alert.timeframe}</strong></div>
                      )}
                      {alert.description && <div className="rip-muted-italic">{alert.description}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Precipitation Forecast */}
      {precipitationForecast && (
        <div className="rip-section">
          <div className="rip-subheader">
            <span className="rip-icon" style={{ color: '#3b82f6' }}>🌧</span>
            Precipitation Forecast
          </div>
          <div className="rip-pred-card">
            {precipitationForecast.maxIntensity !== undefined && (
              <div className="rip-pred-card-row">
                <span className="rip-muted">Max intensity:</span>
                <strong>{precipitationForecast.maxIntensity.toFixed(1)} mm/h</strong>
              </div>
            )}
            {precipitationForecast.cells && precipitationForecast.cells.length > 0 && (
              <button
                className="rip-collapse-header"
                onClick={() => setExpandedPrecip(!expandedPrecip)}
              >
                <span>Cells ({precipitationForecast.cells.length})</span>
                <span className="rip-arrow">{expandedPrecip ? '▾' : '▸'}</span>
              </button>
            )}
            {expandedPrecip && precipitationForecast.cells && (
              <div className="rip-pred-list">
                {precipitationForecast.cells.filter((c: any) => c.hoursFromNow === 1).slice(0, 20).map((c: any, i: number) => (
                  <div key={i} className="rip-pred-card-row">
                    <span className="rip-muted">{c.lat?.toFixed(1)}°, {c.lon?.toFixed(1)}°</span>
                    <strong style={{ color: c.probability > 0.6 ? '#3b82f6' : '#4fc3f7' }}>
                      {(c.probability * 100).toFixed(0)}%
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
