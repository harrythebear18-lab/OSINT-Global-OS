import { useState, useEffect } from 'react'

import { ClimateIntegrityPanel } from './ClimateIntegrityPanel'

import { PredictionPanel } from './PredictionPanel'

import { useClimateData } from '../hooks/useClimateData'

import { useGridData } from '../hooks/useGridData'

import { useNetworkData } from '../hooks/useNetworkData'

import { useMap } from '../hooks/useMap'

import { useForecast } from '../hooks/useAnalysis'

/**

 * RightPanel -the unified right-side dashboard with 16 tabs.

 *

 * Tab layout (2 rows of 8):

 * Row 1: Weather | Stations | Cams | Verify | Ocean | Integ | Predict | Grid

 * Row 2: GridVer | Energy | Net | Health | VPN | Speed | DNS | Traffic

 *

 * The "Verify" and "Integ" tabs both show the ClimateIntegrityPanel

 * (verification/invalidation dashboard). "Verify" also includes the

 * location-based weather verification above it.

 */

type Tab =

 | 'weather' | 'stations' | 'cams' | 'verify' | 'ocean' | 'integ'

 | 'predict' | 'grid' | 'gridVer' | 'energy'

 | 'net' | 'health' | 'vpn' | 'speed' | 'dns' | 'traffic'

const TABS_ROW1: Array<{ id: Tab; label: string; icon: string }> = [
 { id: 'weather', label: 'Weather', icon: '\u2602' },
 { id: 'stations', label: 'Stations', icon: '\u25CE' },
 { id: 'cams', label: 'Cams', icon: '\u25A4' },
 { id: 'verify', label: 'Verify', icon: '\u2713' },
 { id: 'ocean', label: 'Ocean', icon: '\u224B' },
 { id: 'integ', label: 'Integ', icon: '\u26A1' },
 { id: 'predict', label: 'Predict', icon: '\u25C8' },
 { id: 'grid', label: 'Grid', icon: '\u26F5' },
]

const TABS_ROW2: Array<{ id: Tab; label: string; icon: string }> = [
 { id: 'gridVer', label: 'GridVer', icon: '\u2713' },
 { id: 'energy', label: 'Energy', icon: '\u26A1' },
 { id: 'net', label: 'Net', icon: '\u25C9' },
 { id: 'health', label: 'Health', icon: '\u2764' },
 { id: 'vpn', label: 'VPN', icon: '\u2744' },
 { id: 'speed', label: 'Speed', icon: '\u26A1' },
 { id: 'dns', label: 'DNS', icon: '\u2756' },
 { id: 'traffic', label: 'Traffic', icon: '\u25A4' },
]

export function RightPanel() {

 const [tab, setTab] = useState<Tab>('verify')

 const [collapsed, setCollapsed] = useState(false)

 const climate = useClimateData()

 const grid = useGridData()

 const net = useNetworkData()

 if (collapsed) {

 return (

 <aside className="right-panel right-panel-collapsed">

 <button

 className="right-panel-expand-btn"

 onClick={() => setCollapsed(false)}

 title="Show right panel"

 >

 \u2014

 </button>

 </aside>

 )

 }

 return (

 <aside className="right-panel">

 <button

 className="right-panel-collapse-btn"

 onClick={() => setCollapsed(true)}

 title="Hide right panel"

 >
 {'\u25C2'}
 </button>

 {/* Tab selector -2 rows */}

 <div className="rp-tabs">

 <div className="rp-tab-row">

 {TABS_ROW1.map((t) => (

 <TabButton key={t.id} {...t} active={tab === t.id} onClick={() => setTab(t.id)} />

 ))}

 </div>

 <div className="rp-tab-row">

 {TABS_ROW2.map((t) => (

 <TabButton key={t.id} {...t} active={tab === t.id} onClick={() => setTab(t.id)} />

 ))}

 </div>

 </div>

 {/* Tab content */}

 <div className="rp-content">

 {tab === 'weather' && <WeatherTab climate={climate} />}

 {tab === 'stations' && <StationsTab climate={climate} />}

 {tab === 'cams' && <CamsTab />}

 {tab === 'verify' && <VerifyTab climate={climate} />}

 {tab === 'ocean' && <OceanTab climate={climate} />}

 {tab === 'integ' && <IntegTab climate={climate} />}

 {tab === 'predict' && <PredictTab climate={climate} />}

 {tab === 'grid' && <GridTab grid={grid} />}

 {tab === 'gridVer' && <GridVerTab grid={grid} />}

 {tab === 'energy' && <EnergyTab grid={grid} />}

 {tab === 'net' && <NetTab net={net} />}

 {tab === 'health' && <HealthTab net={net} />}

 {tab === 'vpn' && <VPNTab net={net} />}

 {tab === 'speed' && <SpeedTab net={net} />}

 {tab === 'dns' && <DNSTab net={net} />}

 {tab === 'traffic' && <TrafficTab net={net} />}

 </div>

 </aside>

 )

}

function TabButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {

 return (

 <button className={`rp-tab ${active ? 'active' : ''}`} onClick={onClick} title={label}>

 <span className="rp-tab-icon">{icon}</span>

 <span className="rp-tab-label">{label}</span>

 </button>

 )

}

// --- Tab implementations ---

function WeatherTab({ climate }: { climate: ReturnType<typeof useClimateData> }) {

 const { weatherPin, setWeatherPin, setDrawMode, drawMode } = useMap()

 const forecast = useForecast()

 const update = climate.climateUpdate

 // Auto-fetch forecast when a weather pin is placed

 useEffect(() => {

 if (weatherPin) {

 forecast.run(weatherPin)

 }

 }, [weatherPin])

 return (

 <div className="rip-scroll">

 {/* Weather Pin + Forecast section */}

 <div className="rip-section">

 <div className="rip-section-title">Point Forecast</div>

 <div className="rp-weather-pin-controls">

 <button

 className={`rip-btn ${drawMode === 'weather-pin' ? 'rip-btn-toggle active' : ''}`}

 onClick={() => setDrawMode(drawMode === 'weather-pin' ? 'none' : 'weather-pin')}

 >

 {drawMode === 'weather-pin' ? '\u2014 Click map to drop pin...' : 'Drop weather pin'}

 </button>

 {weatherPin && (

 <button className="rip-btn" onClick={() => setWeatherPin(null)}>

 * Clear pin

 </button>

 )}

 </div>

 {weatherPin && (

 <div className="rp-pin-coords">

 {weatherPin.lat.toFixed(4)}\u00B0, {weatherPin.lng.toFixed(4)}\u00B0

 </div>

 )}

 {forecast.loading && <div className="rip-empty-mini">Fetching forecast...</div>}

 {forecast.error && <div className="rp-forecast-error">{forecast.error}</div>}

 {forecast.result && (

 <div className="rp-forecast-display">

 <div className="rp-forecast-current">

 <div className="rp-forecast-temp">

 <strong>{forecast.result.current.temperature.toFixed(0)}\u00B0C</strong>

 <span className="rip-muted"> (feels {forecast.result.current.apparentTemp.toFixed(0)}\u00B0C)</span>

 </div>

 <div className="rp-forecast-desc">{describeWeatherCode(forecast.result.current.weatherCode)}</div>

 <div className="rp-forecast-meta">

 Wind {forecast.result.current.windSpeed.toFixed(0)} km/h \u00B7 Humidity {forecast.result.current.humidity.toFixed(0)}% \u00B7 Precip {forecast.result.current.precipitation.toFixed(1)}mm

 </div>

 </div>

 <div className="rp-forecast-hourly">

 {forecast.result.hourly.slice(0, 12).map((h, i) => (

 <div key={i} className="rp-forecast-hour">

 <span className="rp-fh-time">{h.time}</span>

 <span className="rp-fh-temp">{(h.temp ?? 0).toFixed(0)}\u00B0</span>

 <span className="rp-fh-precip">{(h.precipProb ?? 0).toFixed(0)}%</span>

 </div>

 ))}

 </div>

 </div>

 )}

 {!weatherPin && !forecast.result && (

 <div className="rip-empty-mini">

 Click "Drop weather pin" then click anywhere on the map to get a point forecast.

 </div>

 )}

 </div>

 {/* Global weather conditions */}

 <div className="rip-section">

 <div className="rip-section-title">Global Conditions</div>

 {update?.stats ? (

 <div className="rp-stats-grid">

 <StatCard label="Avg Air Temp" value={`${update.stats.avgAirTemp?.toFixed(1) ?? '-'}\u00B0C`} />

 <StatCard label="Avg Water Temp" value={`${update.stats.avgWaterTemp?.toFixed(1) ?? '-'}\u00B0C`} />

 <StatCard label="Max Water Temp" value={`${update.stats.maxWaterTemp?.toFixed(1) ?? '-'}\u00B0C`} />

 <StatCard label="Min Water Temp" value={`${update.stats.minWaterTemp?.toFixed(1) ?? '-'}\u00B0C`} />

 <StatCard label="Avg Wave Height" value={`${update.stats.avgWaveHeight?.toFixed(1) ?? '-'}m`} />

 <StatCard label="Avg CO" value={`${update.stats.avgCO2?.toFixed(1) ?? '-'} ppm`} />

 <StatCard label="Active Stations" value={update.stats.activeStations ?? '-'} />

 <StatCard label="Anomalies" value={update.stats.anomalies ?? 0} />

 </div>

 ) : (

 <div className="rip-empty-mini">Loading weather data...</div>

 )}

 </div>

 {climate.alerts.length > 0 && (

 <div className="rip-section">

 <div className="rip-subheader"> Active Alerts ({climate.alerts.length})</div>

 <div className="rip-alert-list">

 {climate.alerts.slice(-15).map((alert) => (

 <div key={alert.id} className="rip-alert-item" style={{ borderLeft: `2px solid ${alert.severity === 'critical' ? '#ef4444' : alert.severity === 'warning' ? '#fbbf24' : '#3b82f6'}` }}>

 <div className="rip-alert-body">

 <div className="rip-alert-header">

 <span className="rip-alert-sev" style={{ color: alert.severity === 'critical' ? '#ef4444' : alert.severity === 'warning' ? '#fbbf24' : '#3b82f6' }}>{alert.severity}</span>

 <span className="rip-alert-type">{alert.type.replace(/_/g, ' ')}</span>

 </div>

 <div className="rip-alert-msg">{alert.message}</div>

 <div className="rip-alert-meta">{alert.stationName}</div>

 </div>

 </div>

 ))}

 </div>

 </div>

 )}

 </div>

 )

}

// Weather code descriptions (WMO codes)

function describeWeatherCode(code: number): string {

 const map: Record<number, string> = {

 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',

 45: 'Fog', 48: 'Depositing rime fog',

 51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',

 56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',

 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',

 66: 'Light freezing rain', 67: 'Heavy freezing rain',

 71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',

 77: 'Snow grains',

 80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',

 85: 'Slight snow showers', 86: 'Heavy snow showers',

 95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',

 }

 return map[code] ?? `Weather code ${code}`

}

function StationsTab({ climate }: { climate: ReturnType<typeof useClimateData> }) {

 const stations = climate.climateUpdate?.stations ?? []

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">Climate Stations ({stations.length})</div>

 {stations.length === 0 ? (

 <div className="rip-empty-mini">No stations loaded yet...</div>

 ) : (

 <div className="rp-station-list">

 {stations.slice(0, 200).map((s: any) => (

 <div key={s.id} className="rp-station-item">

 <span className="rp-dot" style={{ background: s.type === 'buoy' ? '#00ffcc' : s.type === 'argo_float' ? '#4fc3f7' : s.type === 'weather_station' ? '#00aa88' : s.type === 'carbon_station' ? '#ff6600' : '#c0c8d8' }} />

 <div className="rp-station-info">

 <div className="rp-station-name">{s.name}</div>

 <div className="rp-station-meta">{s.type.replace(/_/g, ' ')} \u00B7 {s.source.replace(/_/g, ' ')}</div>

 </div>

 <div className="rp-station-coords">{s.lat.toFixed(1)}\u00B0, {s.lon.toFixed(1)}\u00B0</div>

 </div>

 ))}

 </div>

 )}

 </div>

 </div>

 )

}

function CamsTab() {

 return (

 <div className="rip-empty">

 <div className="rip-empty-icon"></div>

 <p>Webcam integration coming soon</p>

 <p className="rip-empty-sub">Windy webcam API proxy is wired in the backend</p>

 </div>

 )

}

function VerifyTab({ climate }: { climate: ReturnType<typeof useClimateData> }) {

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">Weather Verification</div>

 <div className="rip-muted-italic" style={{ padding: '8px' }}>

 Location-based weather verification compares multiple sources for the selected point.

 The climate integrity verification runs continuously below.

 </div>

 </div>

 <ClimateIntegrityPanel

 integrity={climate.integrity}

 alerts={climate.alerts}

 onSnooze={(ms) => climate.snoozeAlerts(ms)}

 onWhitelist={(id) => climate.whitelistStation(id)}

 />

 </div>

 )

}

function OceanTab({ climate }: { climate: ReturnType<typeof useClimateData> }) {

 const stats = climate.climateUpdate?.stats

 const vessels = climate.integrity?.vessels ?? []

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">Ocean & Climate</div>

 {stats ? (

 <div className="rp-stats-grid">

 <StatCard label="Total Stations" value={stats.totalStations} />

 <StatCard label="Active" value={stats.activeStations} />

 <StatCard label="Buoys" value={stats.buoys} />

 <StatCard label="Argo Floats" value={stats.argoFloats} />

 <StatCard label="BGC-Argo" value={stats.bgcArgoFloats} />

 <StatCard label="CO Stations" value={stats.carbonStations} />

 <StatCard label="Weather Stns" value={stats.weatherStations} />

 <StatCard label="Anomalies" value={stats.anomalies} />

 </div>

 ) : <div className="rip-empty-mini">Loading ocean data...</div>}

 </div>

 {stats?.regionalAverages && stats.regionalAverages.length > 0 && (

 <div className="rip-section">

 <div className="rip-subheader">Regional Averages</div>

 <div className="rp-region-list">

 {stats.regionalAverages.map((r: any) => (

 <div key={r.regionId} className="rp-region-item">

 <div className="rp-region-name">{r.name}</div>

 <div className="rp-region-temp">{r.avgTemp.toFixed(1)}\u00B0C</div>

 <div className="rp-region-meta">{r.stationCount} stations</div>

 </div>

 ))}

 </div>

 </div>

 )}

 {vessels.length > 0 && (

 <div className="rip-section">

 <div className="rip-subheader"> Vessels ({vessels.length})</div>

 <div className="rp-station-list">

 {vessels.slice(0, 100).map((v: any) => (

 <div key={v.imo} className="rp-station-item">

 <span className="rp-dot" style={{ background: '#00aa88' }} />

 <div className="rp-station-info">

 <div className="rp-station-name">{v.name}</div>

 <div className="rp-station-meta">{v.vesselType || 'vessel'} \u00B7 {v.flag || ''} \u00B7 {v.speed?.toFixed(1) || 0}kt</div>

 </div>

 </div>

 ))}

 </div>

 </div>

 )}

 </div>

 )

}

function IntegTab({ climate }: { climate: ReturnType<typeof useClimateData> }) {

 return (

 <ClimateIntegrityPanel

 integrity={climate.integrity}

 alerts={climate.alerts}

 onSnooze={(ms) => climate.snoozeAlerts(ms)}

 onWhitelist={(id) => climate.whitelistStation(id)}

 />

 )

}

function PredictTab({ climate }: { climate: ReturnType<typeof useClimateData> }) {

 return <PredictionPanel prediction={climate.predictions} />

}

function GridTab({ grid }: { grid: ReturnType<typeof useGridData> }) {

 const assets = grid.gridUpdate?.assets ?? []

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">Power Grid Assets ({assets.length})</div>

 <div className="rp-cross-domain">

 <label className="rp-toggle-label">

 <input

 type="checkbox"

 checked={grid.crossDomain}

 onChange={(e) => grid.setCrossDomain(e.target.checked)}

 />

 Weather + Grid cross-domain

 </label>

 </div>

 {grid.alerts.length > 0 && (

 <div className="rip-subheader" style={{ marginTop: '8px' }}> Grid Alerts ({grid.alerts.length})</div>

 )}

 {assets.length === 0 ? (

 <div className="rip-empty-mini">Loading grid data...</div>

 ) : (

 <div className="rp-station-list">

 {assets.slice(0, 200).map((a: any) => (

 <div key={a.id} className="rp-station-item">

 <span className="rp-dot" style={{ background: a.type === 'power_plant' ? '#f59e0b' : a.type === 'substation' ? '#00ffcc' : a.type === 'data_center' ? '#ec4899' : a.type === 'ai_center' ? '#ef4444' : a.type === 'renewable' ? '#10b981' : a.type === 'battery' ? '#8b5cf6' : '#c0c8d8' }} />

 <div className="rp-station-info">

 <div className="rp-station-name">{a.name}</div>

 <div className="rp-station-meta">{a.type.replace(/_/g, ' ')} \u00B7 {a.owner || ''}</div>

 </div>

 </div>

 ))}

 </div>

 )}

 </div>

 </div>

 )

}

function GridVerTab({ grid }: { grid: ReturnType<typeof useGridData> }) {

 const integrity = grid.integrity

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">Grid Integrity Verification</div>

 {integrity?.summary ? (

 <div className="rp-stats-grid">

 <StatCard label="Overall Score" value={integrity.summary.overallScore?.toFixed(0) ?? '-'} />

 <StatCard label="Sensors" value={integrity.summary.totalSensorsMonitored ?? '-'} />

 <StatCard label="Verified" value={integrity.summary.sensorsVerified ?? 0} />

 <StatCard label="Failed" value={integrity.summary.sensorsFailed ?? 0} />

 <StatCard label="Flags" value={integrity.summary.totalFlags ?? 0} />

 <StatCard label="Critical" value={integrity.summary.criticalFlags ?? 0} />

 </div>

 ) : (

 <div className="rip-empty-mini">Loading grid integrity...</div>

 )}

 </div>

 {integrity?.assetHealth && integrity.assetHealth.length > 0 && (

 <div className="rip-section">

 <div className="rip-subheader">Asset Health ({integrity.assetHealth.length})</div>

 <div className="rip-sensor-list">

 {integrity.assetHealth.slice(0, 50).map(([id, h]: [string, any]) => (

 <div key={id} className="rip-sensor-item">

 <div className="rip-sensor-header">

 <span style={{ color: h.status === 'verified' ? '#10b981' : h.status === 'warning' ? '#fbbf24' : h.status === 'failed' ? '#ef4444' : '#f97316' }}>

 {h.status === 'verified' ? '' : h.status === 'warning' ? ' ' : h.status === 'failed' ? '*' : '\u2014\u00B7'}

 </span>

 <div className="rip-sensor-info">

 <div className="rip-sensor-name">{id}</div>

 <div className="rip-sensor-meta">Score: {h.integrityScore?.toFixed(0) ?? '-'}</div>

 </div>

 </div>

 </div>

 ))}

 </div>

 </div>

 )}

 </div>

 )

}

function EnergyTab({ grid }: { grid: ReturnType<typeof useGridData> }) {

 const assets = grid.gridUpdate?.assets ?? []

 const measurements = grid.gridUpdate?.measurements ?? {}

 const byType: Record<string, number> = {}

 let totalGen = 0

 let totalLoad = 0

 for (const a of assets) {

 byType[a.type] = (byType[a.type] || 0) + 1

 const m = measurements[a.id]

 if (m?.generationMW) totalGen += m.generationMW

 if (m?.loadMW) totalLoad += m.loadMW

 }

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">Energy Mix</div>

 <div className="rp-stats-grid">

 <StatCard label="Total Assets" value={assets.length} />

 <StatCard label="Total Gen" value={`${totalGen.toFixed(0)}MW`} />

 <StatCard label="Total Load" value={`${totalLoad.toFixed(0)}MW`} />

 <StatCard label="Balance" value={`${(totalGen - totalLoad).toFixed(0)}MW`} />

 </div>

 </div>

 <div className="rip-section">

 <div className="rip-subheader">Assets by Type</div>

 <div className="rp-type-list">

 {Object.entries(byType).map(([type, count]) => (

 <div key={type} className="rp-type-item">

 <span className="rp-dot" style={{ background: type === 'power_plant' ? '#f59e0b' : type === 'substation' ? '#00ffcc' : type === 'data_center' ? '#ec4899' : type === 'ai_center' ? '#ef4444' : type === 'renewable' ? '#10b981' : type === 'battery' ? '#8b5cf6' : '#c0c8d8' }} />

 <span>{type.replace(/_/g, ' ')}</span>

 <strong>{count}</strong>

 </div>

 ))}

 </div>

 </div>

 </div>

 )

}

function NetTab({ net }: { net: ReturnType<typeof useNetworkData> }) {

 const connections = net.netUpdate?.connections ?? []

 const stats = net.netUpdate?.stats

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">Network Connections</div>

 {stats && (

 <div className="rp-stats-grid">

 <StatCard label="Total" value={stats.total ?? connections.length} />

 <StatCard label="Active" value={stats.active ?? 0} />

 <StatCard label="Countries" value={stats.countries ?? 0} />

 <StatCard label="Unique IPs" value={stats.uniqueIPs ?? 0} />

 </div>

 )}

 {net.alerts.length > 0 && (

 <div className="rip-subheader" style={{ marginTop: '8px' }}> Net Alerts ({net.alerts.length})</div>

 )}

 <div className="rp-station-list">

 {connections.slice(0, 200).map((c: any, i: number) => (

 <div key={i} className="rp-station-item">

 <span className="rp-dot" style={{ background: c.protocol === 'UDP' ? '#f59e0b' : '#00aaff' }} />

 <div className="rp-station-info">

 <div className="rp-station-name">{c.remoteAddress}:{c.remotePort}</div>

 <div className="rp-station-meta">{c.protocol} \u00B7 {c.processName || 'unknown'} \u00B7 {c.state || ''}</div>

 </div>

 {c.geoLocation && (

 <div className="rp-station-coords">{c.geoLocation.city}, {c.geoLocation.country}</div>

 )}

 </div>

 ))}

 </div>

 </div>

 </div>

 )

}

function HealthTab({ net }: { net: ReturnType<typeof useNetworkData> }) {

 const h = net.health

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">\u2764 Network Health</div>

 {h ? (

 <div className="rp-stats-grid">

 <StatCard label="Latency" value={`${h.latency?.toFixed(0) ?? '-'}ms`} />

 <StatCard label="Jitter" value={`${h.jitter?.toFixed(1) ?? '-'}ms`} />

 <StatCard label="Packet Loss" value={`${h.packetLoss?.toFixed(1) ?? '-'}%`} />

 <StatCard label="Medium" value={h.medium || '-'} />

 </div>

 ) : <div className="rip-empty-mini">Loading network health...</div>}

 </div>

 {net.outages.length > 0 && (

 <div className="rip-section">

 <div className="rip-subheader"> Outages ({net.outages.length})</div>

 <div className="rip-alert-list">

 {net.outages.slice(-15).map((o: any, i: number) => (

 <div key={i} className="rip-alert-item" style={{ borderLeft: '2px solid #ef4444' }}>

 <div className="rip-alert-body">

 <div className="rip-alert-header">

 <span className="rip-alert-sev" style={{ color: '#ef4444' }}>OUTAGE</span>

 </div>

 <div className="rip-alert-msg">{o.description || o.type || 'Network outage'}</div>

 <div className="rip-alert-meta">{new Date(o.startTime).toLocaleString()}</div>

 </div>

 </div>

 ))}

 </div>

 </div>

 )}

 </div>

 )

}

function VPNTab({ net }: { net: ReturnType<typeof useNetworkData> }) {

 const v = net.vpn
 const [refreshing, setRefreshing] = useState(false)

 const refresh = async () => {
   setRefreshing(true)
   try { await net.refreshVPN() } finally { setRefreshing(false) }
 }

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">

 VPN Status

 <button className="rip-btn" style={{ marginLeft: '8px' }} onClick={refresh} disabled={refreshing}>
   {refreshing ? 'Refreshing...' : '+ Refresh'}
 </button>

 </div>

 {v ? (

 <div className="rp-vpn-info">

 <div className="rip-pred-card-row"><span className="rip-muted">Connected:</span><strong style={{ color: v.connected ? '#10b981' : '#ef4444' }}>{v.connected ? 'YES' : 'NO'}</strong></div>

 {v.publicIP && <div className="rip-pred-card-row"><span className="rip-muted">Public IP:</span><strong>{v.publicIP}</strong></div>}

 {v.isp && <div className="rip-pred-card-row"><span className="rip-muted">ISP:</span><strong>{v.isp}</strong></div>}

 {v.country && <div className="rip-pred-card-row"><span className="rip-muted">Country:</span><strong>{v.country}</strong></div>}

 {v.adapter && <div className="rip-pred-card-row"><span className="rip-muted">Adapter:</span><strong>{v.adapter}</strong></div>}

 </div>

 ) : <div className="rip-empty-mini">Loading VPN status...</div>}

 </div>

 </div>

 )

}

function SpeedTab({ net }: { net: ReturnType<typeof useNetworkData> }) {

 const [result, setResult] = useState<any>(null)
 const [running, setRunning] = useState(false)
 const [error, setError] = useState<string | null>(null)

 const runTest = async () => {
   setRunning(true)
   setError(null)
   try {
     const res = await net.runSpeedTest()
     setResult(res)
   } catch (e: any) {
     setError(e?.message || 'Speed test failed')
   } finally {
     setRunning(false)
   }
 }

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">

 Speed Test

 <button className="rip-btn" style={{ marginLeft: '8px' }} onClick={runTest} disabled={running}>
   {running ? 'Running...' : 'Run Test'}
 </button>

 </div>

 {(running || net.speedTestProgress > 0) && net.speedTestProgress < 100 && (

 <div className="rip-scorebar-track">

 <div className="rip-scorebar-fill" style={{ width: `${net.speedTestProgress}%`, background: 'var(--accent)' }} />

 </div>

 )}

 {error && <div className="rp-forecast-error">{error}</div>}

 {result && (

 <div className="rp-stats-grid">

 <StatCard label="Download" value={`${result.downloadSpeed ?? 0} Mbps`} />

 <StatCard label="Upload" value={`${result.uploadSpeed ?? 0} Mbps`} />

 <StatCard label="Latency" value={`${result.latency ?? 0} ms`} />

 <StatCard label="Jitter" value={`${result.jitter ?? 0} ms`} />

 </div>

 )}

 {!result && !running && !error && (

 <div className="rip-muted-italic" style={{ padding: '8px' }}>

 Click "Run Test" to measure latency, jitter, and download/upload speeds.

 </div>

 )}

 </div>

 </div>

 )

}

function DNSTab({ net }: { net: ReturnType<typeof useNetworkData> }) {

 const [results, setResults] = useState<any[]>([])
 const [running, setRunning] = useState(false)
 const [error, setError] = useState<string | null>(null)

 const runTest = async () => {
   setRunning(true)
   setError(null)
   try {
     const res = await net.runDNSTest()
     setResults(Array.isArray(res) ? res : [])
   } catch (e: any) {
     setError(e?.message || 'DNS test failed')
   } finally {
     setRunning(false)
   }
 }

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">

 \u2014 DNS Test

 <button className="rip-btn" style={{ marginLeft: '8px' }} onClick={runTest} disabled={running}>
   {running ? 'Running...' : 'Run Test'}
 </button>

 </div>

 {error && <div className="rp-forecast-error">{error}</div>}

 {results.length > 0 && (

 <div className="rp-station-list">

 {results.map((r: any, i: number) => (

 <div key={i} className="rp-station-item">

 <span className="rp-dot" style={{ background: r.success ? '#10b981' : '#ef4444' }} />

 <div className="rp-station-info">

 <div className="rp-station-name">{r.server}</div>

 <div className="rp-station-meta">{r.ip} \u00B7 {r.latency}ms</div>

 </div>

 </div>

 ))}

 </div>

 )}

 {!results.length && !running && !error && (

 <div className="rip-muted-italic" style={{ padding: '8px' }}>

 Click "Run Test" to check DNS resolution latency against default servers.

 </div>

 )}

 </div>

 </div>

 )

}

function TrafficTab({ net }: { net: ReturnType<typeof useNetworkData> }) {

 const traffic = net.traffic

 return (

 <div className="rip-scroll">

 <div className="rip-section">

 <div className="rip-section-title">Network Traffic</div>

 {traffic.length > 0 ? (

 <div className="rp-traffic-list">

 {traffic.slice(-30).map((t: any, i: number) => (

 <div key={i} className="rp-traffic-item">

 <span className="rip-muted">{new Date(t.timestamp).toLocaleTimeString()}</span>

 <span>Total: <strong>{t.totalConnections ?? t.total ?? '-'}</strong></span>

 <span>Active: <strong>{t.activeConnections ?? t.active ?? '-'}</strong></span>

 </div>

 ))}

 </div>

 ) : <div className="rip-empty-mini">Loading traffic data...</div>}

 </div>

 </div>

 )

}

// --- Shared small components ---

function StatCard({ label, value }: { label: string; value: any }) {

 return (

 <div className="rp-stat-card">

 <div className="rp-stat-val">{value}</div>

 <div className="rp-stat-label">{label}</div>

 </div>

 )

}

