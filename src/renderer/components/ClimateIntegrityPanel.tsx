import { useState } from 'react'

/**
 * ClimateIntegrityPanel — the verification & invalidation dashboard.
 *
 * Ported from weather-radar's ClimateIntegrityPanel.tsx, adapted to plain CSS.
 *
 * Shows:
 *  1. Overall integrity score + 3-layer score bars (sensor, data flow, results)
 *  2. Quick stats (verified/warning/failed/pipelines/cross-source/flags)
 *  3. Snooze + flagged-only controls
 *  4. Climate alerts list with whitelist buttons
 *  5. New sensors detected
 *  6. Sensor Health (expandable, with per-sensor checks)
 *  7. Data Flow Pipeline (expandable, with per-source checks)
 *  8. Cross-Verification (expandable, with physical/statistical/temporal/nearby/cross-source checks)
 *  9. INVALIDATED stations banner
 */

interface Props {
  integrity: any | null
  alerts: any[]
  onSnooze?: (ms: number) => void
  onWhitelist?: (stationId: string) => void
}

function scoreColor(score: number): string {
  if (score >= 80) return '#10b981'
  if (score >= 60) return '#fbbf24'
  if (score >= 40) return '#f97316'
  return '#ef4444'
}

function statusIcon(status: string): string {
  switch (status) {
    case 'verified': return '✓'
    case 'warning': return '⚠'
    case 'failed': return '✕'
    case 'stale': return '◷'
    default: return '●'
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'verified': return '#10b981'
    case 'warning': return '#fbbf24'
    case 'failed': return '#ef4444'
    case 'stale': return '#f97316'
    default: return 'var(--muted)'
  }
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`
  return `${(b / 1048576).toFixed(1)}MB`
}

function flagIcon(severity: string): string {
  switch (severity) {
    case 'critical': return '✕'
    case 'warning': return '⚠'
    default: return 'ℹ'
  }
}

function flagColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#ef4444'
    case 'warning': return '#fbbf24'
    default: return 'var(--accent)'
  }
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
}

function toggleSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function ClimateIntegrityPanel({ integrity, alerts, onSnooze, onWhitelist }: Props) {
  const [showAlerts, setShowAlerts] = useState(true)
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(true)
  const [expandedSensors, setExpandedSensors] = useState<Set<string>>(new Set())
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set())
  const [expandedVers, setExpandedVers] = useState<Set<string>>(new Set())

  if (!integrity || !integrity.summary) {
    return (
      <div className="rip-empty">
        <div className="rip-empty-icon">🛡</div>
        <p>Waiting for integrity data...</p>
      </div>
    )
  }

  const summary = integrity.summary

  // Sensor Health
  const sensors: any[] = (integrity.sensorHealth ?? []).map(([id, h]: [string, any]) => ({ id, ...h }))
  const sortedSensors = sensors.sort((a: any, b: any) => {
    const order: Record<string, number> = { failed: 0, stale: 1, warning: 2, unknown: 3, verified: 4 }
    return (order[a.status] ?? 5) - (order[b.status] ?? 5)
  })
  const flaggedSensors = sortedSensors.filter((s: any) => s.status !== 'verified')
  const displayedSensors = showFlaggedOnly ? flaggedSensors.slice(0, 50) : sortedSensors.slice(0, 100)
  const verifiedCount = sortedSensors.filter((s: any) => s.status === 'verified').length

  // Cross-verification
  const crossVers = integrity.crossVerifications ?? []
  const flaggedVers = crossVers.filter((v: any) => v.flags.length > 0 || v.status === 'invalidated')
  const invalidatedVers = crossVers.filter((v: any) => v.status === 'invalidated')
  const sortedVers = [...(showFlaggedOnly ? flaggedVers : crossVers)].sort((a: any, b: any) => {
    const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    const aMax = a.flags.length > 0 ? Math.min(...a.flags.map((f: any) => sevOrder[f.severity] ?? 3)) : 4
    const bMax = b.flags.length > 0 ? Math.min(...b.flags.map((f: any) => sevOrder[f.severity] ?? 3)) : 4
    return aMax - bMax
  })

  return (
    <div className="rip-scroll">
      {/* Overall Score */}
      <div className="rip-section">
        <div className="rip-section-title">
          <span className="rip-icon">🛡</span>
          Integrity Dashboard
        </div>
        <div className="rip-score-grid">
          <div className="rip-score-cell">
            <div className="rip-score-big" style={{ color: scoreColor(summary.overallScore) }}>
              {summary.overallScore.toFixed(0)}
            </div>
            <div className="rip-score-label">Overall</div>
          </div>
          <div className="rip-score-cell">
            <div className="rip-score-big">{summary.totalSensorsMonitored}</div>
            <div className="rip-score-label">Sensors</div>
          </div>
          <div className="rip-score-cell">
            <div className="rip-score-big">{summary.dataPointsVerified}</div>
            <div className="rip-score-label">Data Pts</div>
          </div>
        </div>
        <div className="rip-scorebars">
          <ScoreBar label="Sensor Layer" score={summary.sensorLayerScore} />
          <ScoreBar label="Data Flow Layer" score={summary.dataFlowLayerScore} />
          <ScoreBar label="Results Layer" score={summary.resultsLayerScore} />
        </div>
      </div>

      {/* Quick Stats */}
      <div className="rip-quickstats">
        <div className="rip-qs-item">
          <span style={{ color: '#10b981' }}>✓</span>
          <span className="rip-qs-label">Verified:</span>
          <span>{summary.sensorsVerified}</span>
        </div>
        <div className="rip-qs-item">
          <span style={{ color: '#fbbf24' }}>⚠</span>
          <span className="rip-qs-label">Warning:</span>
          <span>{summary.sensorsWarning}</span>
        </div>
        <div className="rip-qs-item">
          <span style={{ color: '#ef4444' }}>✕</span>
          <span className="rip-qs-label">Failed:</span>
          <span>{summary.sensorsFailed}</span>
        </div>
        <div className="rip-qs-item">
          <span style={{ color: 'var(--accent)' }}>●</span>
          <span className="rip-qs-label">Pipelines:</span>
          <span>{summary.pipelinesActive}/{summary.pipelinesActive + summary.pipelinesDegraded}</span>
        </div>
        <div className="rip-qs-item">
          <span style={{ color: 'var(--accent)' }}>⇄</span>
          <span className="rip-qs-label">Cross-src:</span>
          <span>{summary.crossSourceMatches}/{summary.crossSourceMatches + summary.crossSourceMismatches}</span>
        </div>
        <div className="rip-qs-item">
          <span style={{ color: '#f97316' }}>⚠</span>
          <span className="rip-qs-label">Flags:</span>
          <span>{summary.totalFlags}</span>
          {summary.criticalFlags > 0 && <span style={{ color: '#ef4444' }}> ({summary.criticalFlags} crit)</span>}
        </div>
      </div>

      {/* Snooze + View controls */}
      <div className="rip-controls">
        {onSnooze && (
          <>
            <button className="rip-btn" onClick={() => onSnooze(30 * 60 * 1000)}>
              🔕 Snooze 30m
            </button>
            <button className="rip-btn" onClick={() => onSnooze(0)}>
              🔔 Resume
            </button>
          </>
        )}
        <button
          className={`rip-btn rip-btn-toggle ${showFlaggedOnly ? 'active' : ''}`}
          onClick={() => setShowFlaggedOnly(!showFlaggedOnly)}
        >
          {showFlaggedOnly ? 'Flagged only' : 'Showing all'}
        </button>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="rip-section">
          <button className="rip-collapse-header" onClick={() => setShowAlerts(!showAlerts)}>
            <span style={{ color: '#ef4444' }}>✕</span>
            <span>Alerts</span>
            <span className="rip-count">{alerts.length}</span>
            <span className="rip-arrow">{showAlerts ? '▾' : '▸'}</span>
          </button>
          {showAlerts && (
            <div className="rip-alert-list">
              {alerts.slice(0, 30).map((alert) => (
                <div
                  key={alert.id}
                  className="rip-alert-item"
                  style={{ borderLeft: `2px solid ${SEVERITY_COLORS[alert.severity] ?? '#6b7280'}` }}
                >
                  <div className="rip-alert-body">
                    <div className="rip-alert-header">
                      <span
                        className="rip-alert-sev"
                        style={{ color: SEVERITY_COLORS[alert.severity] ?? '#6b7280' }}
                      >
                        {alert.severity}
                      </span>
                      <span className="rip-alert-type">{alert.type.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="rip-alert-msg">{alert.message}</div>
                    <div className="rip-alert-meta">
                      {alert.stationName} · {new Date(alert.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  {onWhitelist && (
                    <button
                      className="rip-wl-btn"
                      onClick={() => onWhitelist(alert.stationId)}
                      title="Whitelist station"
                    >
                      WL
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* New Sensors */}
      {integrity.newStations && integrity.newStations.length > 0 && (
        <div className="rip-section">
          <div className="rip-subheader">
            <span className="rip-icon" style={{ color: '#06b6d4' }}>◎</span>
            New Sensors ({integrity.newStations.length})
          </div>
          <div className="rip-new-sensor-list">
            {integrity.newStations.slice(0, 50).map((s: any) => (
              <div key={s.id} className="rip-new-sensor-item">
                <span
                  className="rip-dot"
                  style={{
                    background: s.type === 'argo_float' ? '#06b6d4' : s.type === 'buoy' ? '#00ffcc' :
                      s.type === 'weather_station' ? '#84cc16' : s.type === 'carbon_station' ? '#ec4899' : '#3b82f6'
                  }}
                />
                <div className="rip-ns-info">
                  <div className="rip-ns-name">{s.name}</div>
                  <div className="rip-ns-type">{s.type.replace(/_/g, ' ')} · {s.source.replace(/_/g, ' ')}</div>
                </div>
                <div className="rip-ns-coords">{s.lat.toFixed(1)}°, {s.lon.toFixed(1)}°</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sensor Health */}
      <div className="rip-section">
        <div className="rip-subheader">
          <span className="rip-icon" style={{ color: 'var(--accent)' }}>📡</span>
          Sensor Health
          <span className="rip-count">{verifiedCount}/{sortedSensors.length} verified</span>
        </div>
        {displayedSensors.length === 0 ? (
          <div className="rip-all-ok">
            <span style={{ color: '#10b981' }}>✓</span> All {sortedSensors.length} sensors transmitting normally.
          </div>
        ) : (
          <div className="rip-sensor-list">
            {displayedSensors.map((s: any) => {
              const isExpanded = expandedSensors.has(s.id)
              return (
                <div key={s.id} className="rip-sensor-item">
                  <div
                    className="rip-sensor-header"
                    onClick={() => setExpandedSensors((prev) => toggleSet(prev, s.id))}
                  >
                    <span style={{ color: statusColor(s.status) }}>{statusIcon(s.status)}</span>
                    <div className="rip-sensor-info">
                      <div className="rip-sensor-name">{s.stationId}</div>
                      <div className="rip-sensor-meta">
                        {formatAge(Date.now() - s.lastTransmission)} · {s.transmissionCount} tx
                        {s.driftDetected && ' · drift'}
                        {s.calibrationStatus === 'drift' && ' · needs cal'}
                      </div>
                    </div>
                    <span className="rip-status-badge" style={{ color: statusColor(s.status) }}>
                      {s.status}
                    </span>
                    {s.checks && s.checks.length > 0 && (
                      <span className="rip-arrow">{isExpanded ? '▾' : '▸'}</span>
                    )}
                  </div>
                  {isExpanded && s.checks && s.checks.length > 0 && (
                    <div className="rip-expand-body">
                      <div className="rip-check-grid">
                        <div>Score: <strong>{s.integrityScore.toFixed(0)}</strong></div>
                        <div>Uptime: <strong>{s.uptimePercent.toFixed(1)}%</strong></div>
                        <div>Regularity: <strong>{(s.transmissionRegularity * 100).toFixed(0)}%</strong></div>
                        <div>Missed: <strong>{s.missedTransmissions}</strong></div>
                        {s.fieldsMissing.length > 0 && (
                          <div className="rip-check-warn">Missing: {s.fieldsMissing.join(', ')}</div>
                        )}
                        {s.driftDetails.length > 0 && (
                          <div className="rip-check-warn" style={{ color: '#fbbf24' }}>
                            Drift: {s.driftDetails.join('; ')}
                          </div>
                        )}
                      </div>
                      {s.checks.map((c: any, i: number) => (
                        <div key={i} className="rip-check-row">
                          <span style={{ color: statusColor(c.status) }}>{statusIcon(c.status)}</span>
                          <div>
                            <span>{c.check}</span>
                            {c.value && <span className="rip-muted"> {c.value}</span>}
                            <div className="rip-check-msg">{c.message}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Data Flow Pipeline */}
      <div className="rip-section">
        <div className="rip-subheader">
          <span className="rip-icon" style={{ color: 'var(--accent)' }}>⛓</span>
          Data Flow Pipeline
        </div>
        {(integrity.dataFlowHealth ?? []).length === 0 ? (
          <div className="rip-muted-italic">No pipeline data yet.</div>
        ) : (
          <div className="rip-flow-list">
            {(integrity.dataFlowHealth ?? []).map((flow: any, flowIdx: number) => {
              const key = `${flow.source}-${flowIdx}`
              const isExpanded = expandedFlows.has(key)
              return (
                <div key={key} className="rip-flow-item">
                  <div
                    className="rip-flow-header"
                    onClick={() => setExpandedFlows((prev) => toggleSet(prev, key))}
                  >
                    <span style={{ color: statusColor(flow.status) }}>{statusIcon(flow.status)}</span>
                    <span className="rip-flow-name">{flow.sourceName || flow.source}</span>
                    <span className="rip-status-badge" style={{ color: statusColor(flow.status) }}>
                      {flow.status}
                    </span>
                    {flow.pipelineChecks && flow.pipelineChecks.length > 0 && (
                      <span className="rip-arrow">{isExpanded ? '▾' : '▸'}</span>
                    )}
                  </div>
                  <div className="rip-flow-stats">
                    <div><strong>{formatLatency(flow.fetchLatencyMs)}</strong> latency</div>
                    <div><strong>{flow.stationsReceived}</strong> stations</div>
                    <div><strong>{formatBytes(flow.payloadSizeBytes)}</strong></div>
                  </div>
                  {(flow.duplicateCount > 0 || flow.outOfOrderCount > 0 || flow.missingFieldCount > 0) && (
                    <div className="rip-flow-warns">
                      {flow.duplicateCount > 0 && <span>{flow.duplicateCount} dups</span>}
                      {flow.outOfOrderCount > 0 && <span>{flow.outOfOrderCount} reordered</span>}
                      {flow.missingFieldCount > 0 && <span>{flow.missingFieldCount} missing</span>}
                    </div>
                  )}
                  <div className="rip-scorebar-mini">
                    <div
                      style={{
                        width: `${Math.min(flow.pipelineScore, 100)}%`,
                        background: scoreColor(flow.pipelineScore),
                      }}
                    />
                  </div>
                  {isExpanded && flow.pipelineChecks && flow.pipelineChecks.length > 0 && (
                    <div className="rip-expand-body">
                      <div className="rip-check-grid">
                        <div>Expected: <strong>{flow.stationsExpected}</strong></div>
                        <div>Received: <strong>{flow.stationsReceived}</strong></div>
                        <div>Completeness: <strong>{flow.completenessPercent.toFixed(1)}%</strong></div>
                        <div>Avg: <strong>{formatLatency(flow.avgLatencyMs)}</strong></div>
                        <div>Packets: <strong>{flow.totalPackets}</strong></div>
                        <div>Dropped: <strong style={{ color: flow.droppedPackets > 0 ? '#f97316' : 'inherit' }}>{flow.droppedPackets}</strong></div>
                      </div>
                      {flow.pipelineChecks.map((c: any, i: number) => (
                        <div key={i} className="rip-check-row">
                          <span style={{ color: statusColor(c.status) }}>{statusIcon(c.status)}</span>
                          <div>
                            <span>{c.check}</span>
                            <div className="rip-check-msg">{c.message}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Cross-Verification */}
      <div className="rip-section">
        <div className="rip-subheader">
          <span className="rip-icon" style={{ color: 'var(--accent)' }}>⇄</span>
          Cross-Verification
          <span className="rip-count">{crossVers.length - flaggedVers.length}/{crossVers.length} clean</span>
        </div>

        {invalidatedVers.length > 0 && (
          <div className="rip-invalidated-banner">
            <div className="rip-invalidated-msg">
              {invalidatedVers.length} station{invalidatedVers.length !== 1 ? 's' : ''} auto-invalidated — awaiting next data transmission to re-verify
            </div>
            {invalidatedVers.slice(0, 10).map((v: any) => (
              <div key={v.stationId} className="rip-invalidated-item">
                <span style={{ color: '#ef4444' }}>✕</span>
                <span className="rip-iv-name">{v.stationName || v.stationId}</span>
                <span className="rip-iv-badge">INVALIDATED</span>
              </div>
            ))}
          </div>
        )}

        {sortedVers.length === 0 ? (
          <div className="rip-all-ok">
            <span style={{ color: '#10b981' }}>✓</span> All {crossVers.length} measurements pass verification.
          </div>
        ) : (
          <div className="rip-cv-list">
            {sortedVers.slice(0, 50).map((v: any) => {
              const isExpanded = expandedVers.has(v.stationId)
              return (
                <div key={v.stationId} className="rip-cv-item">
                  <div
                    className="rip-cv-header"
                    onClick={() => setExpandedVers((prev) => toggleSet(prev, v.stationId))}
                  >
                    <span className="rip-cv-name">{v.stationName || v.stationId}</span>
                    {v.status === 'invalidated' && <span className="rip-iv-badge">INVALIDATED</span>}
                    <span className="rip-cv-score">{v.verificationScore.toFixed(0)}/100</span>
                    <span className="rip-arrow">{isExpanded ? '▾' : '▸'}</span>
                  </div>

                  {v.flags.map((f: any, i: number) => (
                    <div key={i} className="rip-flag-row">
                      <span style={{ color: flagColor(f.severity) }}>{flagIcon(f.severity)}</span>
                      <div>
                        <span className="rip-flag-type" style={{ color: flagColor(f.severity) }}>
                          {f.type.replace(/_/g, ' ')}
                        </span>
                        {f.field && <span className="rip-muted"> · {f.field}</span>}
                        <div className="rip-flag-msg">{f.message}</div>
                      </div>
                    </div>
                  ))}

                  {isExpanded && (
                    <div className="rip-cv-detail">
                      {/* Physical Plausibility */}
                      {v.physicalPlausibility && v.physicalPlausibility.length > 0 && (
                        <div className="rip-cv-subsection">
                          <div className="rip-cv-subheader">Physical Bounds</div>
                          {v.physicalPlausibility.map((p: any, i: number) => (
                            <div key={i} className="rip-cv-check-row">
                              <span style={{ color: p.passed ? '#10b981' : '#ef4444' }}>{p.passed ? '✓' : '✕'}</span>
                              <span className="rip-muted">{p.field}</span>
                              <span style={{ color: p.passed ? 'inherit' : '#ef4444' }}>{p.value.toFixed(2)}</span>
                              <span className="rip-muted">[{p.min}, {p.max}]</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Statistical Outlier */}
                      {v.statisticalOutlier && (
                        <div className="rip-cv-subsection">
                          <div className="rip-cv-subheader">Statistical Outlier</div>
                          <div className="rip-cv-stats-row">
                            z-score: <strong style={{ color: Math.abs(v.statisticalOutlier.zScore) > 3 ? '#ef4444' : Math.abs(v.statisticalOutlier.zScore) > 2 ? '#fbbf24' : 'inherit' }}>{v.statisticalOutlier.zScore.toFixed(2)}</strong>
                            <span> mean: <strong>{v.statisticalOutlier.mean.toFixed(2)}</strong></span>
                            <span> σ: <strong>{v.statisticalOutlier.stdDev.toFixed(2)}</strong></span>
                            <span> n: <strong>{v.statisticalOutlier.sampleSize}</strong></span>
                          </div>
                          <div className="rip-muted-italic">{v.statisticalOutlier.message}</div>
                        </div>
                      )}

                      {/* Temporal Consistency */}
                      {v.temporalConsistency && (
                        <div className="rip-cv-subsection">
                          <div className="rip-cv-subheader">Temporal Consistency</div>
                          <div className="rip-cv-stats-row">
                            rate: <strong style={{ color: Math.abs(v.temporalConsistency.rateOfChange) > v.temporalConsistency.maxExpectedRate ? '#ef4444' : 'inherit' }}>{v.temporalConsistency.rateOfChange.toFixed(2)}/s</strong>
                            <span> max: <strong>{v.temporalConsistency.maxExpectedRate}/s</strong></span>
                            {v.temporalConsistency.previousValue !== undefined && (
                              <span> prev: <strong>{v.temporalConsistency.previousValue.toFixed(2)}</strong></span>
                            )}
                            <span> curr: <strong>{v.temporalConsistency.currentValue.toFixed(2)}</strong></span>
                          </div>
                          <div className="rip-muted-italic">{v.temporalConsistency.message}</div>
                        </div>
                      )}

                      {/* Nearby Comparisons */}
                      {v.nearbyComparisons && v.nearbyComparisons.length > 0 && (
                        <div className="rip-cv-subsection">
                          <div className="rip-cv-subheader">Nearby Comparisons ({v.nearbyComparisons.length})</div>
                          {v.nearbyComparisons.slice(0, 8).map((nc: any, i: number) => (
                            <div key={i} className="rip-cv-check-row">
                              <span style={{ color: nc.withinTolerance ? '#10b981' : '#fbbf24' }}>{nc.withinTolerance ? '✓' : '⚠'}</span>
                              <span className="rip-muted">{nc.stationName}</span>
                              <span className="rip-muted">{nc.field}</span>
                              <span>{nc.ourValue.toFixed(1)}</span>
                              <span className="rip-muted">vs</span>
                              <span>{nc.theirValue.toFixed(1)}</span>
                              <span style={{ color: nc.withinTolerance ? '#10b981' : '#fbbf24' }}>Δ{nc.delta.toFixed(1)}</span>
                              <span className="rip-muted">{nc.distanceKm.toFixed(0)}km</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Cross-Source Agreement */}
                      {v.crossSourceAgreement && v.crossSourceAgreement.length > 0 && (
                        <div className="rip-cv-subsection">
                          <div className="rip-cv-subheader">Cross-Source Agreement</div>
                          {v.crossSourceAgreement.map((cs: any, i: number) => (
                            <div key={i} className="rip-cv-check-row">
                              <span style={{ color: cs.agreement ? '#10b981' : '#ef4444' }}>{cs.agreement ? '✓' : '✕'}</span>
                              <span className="rip-muted">{cs.field}</span>
                              <span>{cs.sources.join(' vs ')}</span>
                              <span style={{ color: cs.agreement ? '#10b981' : '#ef4444' }}>
                                {cs.agreement ? 'match' : `Δ${cs.spread.toFixed(1)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="rip-scorebar">
      <div className="rip-scorebar-label">
        <span className="rip-muted">{label}</span>
        <span style={{ color: scoreColor(score) }}>{score.toFixed(1)}</span>
      </div>
      <div className="rip-scorebar-track">
        <div
          className="rip-scorebar-fill"
          style={{ width: `${Math.min(score, 100)}%`, background: scoreColor(score) }}
        />
      </div>
    </div>
  )
}
