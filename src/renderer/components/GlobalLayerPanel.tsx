import { useState } from 'react'
import type { GlobalLayerState } from './GlobalOverlays'
import { DEFAULT_LAYER_STATE } from './GlobalOverlays'

/**
 * GlobalLayerPanel — toggle controls for all weather-radar domain layers.
 *
 * Organized into collapsible sections:
 *  - Weather & Climate (stations, lightning, storms, predictions)
 *  - Hazards (earthquakes, wildfires)
 *  - Traffic (vessels, aircraft)
 *  - Power Grid (assets, interconnects)
 *  - Network (connections, user location)
 */
interface GlobalLayerPanelProps {
  layerState: GlobalLayerState
  setLayerState: (state: GlobalLayerState) => void
  aircraftAltitudeFilter: { min: number; max: number }
  setAircraftAltitudeFilter: (filter: { min: number; max: number }) => void
}

export function GlobalLayerPanel({ layerState, setLayerState, aircraftAltitudeFilter, setAircraftAltitudeFilter }: GlobalLayerPanelProps) {
  const [openSection, setOpenSection] = useState<string>('Weather & Climate')

  const toggle = (key: keyof GlobalLayerState) => {
    setLayerState({ ...layerState, [key]: !layerState[key] })
  }

  const toggleSection = (section: string) => {
    setOpenSection(openSection === section ? '' : section)
  }

  const allOff = Object.values(layerState).every((v) => !v)
  const resetAll = () => setLayerState({ ...DEFAULT_LAYER_STATE })

  return (
    <div className="global-layer-panel">
      <div className="layer-panel-header">
        <h3>Global Overlays</h3>
        {allOff ? (
          <button className="layer-enable-all" onClick={resetAll}>Enable defaults</button>
        ) : (
          <button className="layer-clear-all" onClick={() => {
            const off = {} as GlobalLayerState
            for (const k of Object.keys(layerState) as (keyof GlobalLayerState)[]) off[k] = false
            setLayerState(off)
          }}>All off</button>
        )}
      </div>

      {/* Weather & Climate */}
      <LayerSection title="Weather & Climate" open={openSection === 'Weather & Climate'} onToggle={() => toggleSection('Weather & Climate')}>
        <LayerToggle label="Ocean Buoys" checked={layerState.oceanBuoys} onChange={() => toggle('oceanBuoys')} color="#00ffcc" />
        <LayerToggle label="ARGO Floats" checked={layerState.argoFloats} onChange={() => toggle('argoFloats')} color="#4fc3f7" />
        <LayerToggle label="Land Weather" checked={layerState.weatherStations} onChange={() => toggle('weatherStations')} color="#00aa88" />
        <LayerToggle label="CO₂ Stations" checked={layerState.carbonStations} onChange={() => toggle('carbonStations')} color="#ff6600" />
        <LayerToggle label="Lightning" checked={layerState.lightning} onChange={() => toggle('lightning')} color="#ffeb3b" />
        <LayerToggle label="Storm Cells" checked={layerState.stormCells} onChange={() => toggle('stormCells')} color="#ff3366" />
        <LayerToggle label="Storm Tracks" checked={layerState.stormTracks} onChange={() => toggle('stormTracks')} color="#ff6600" />
        <LayerToggle label="Severe Weather" checked={layerState.severeWeather} onChange={() => toggle('severeWeather')} color="#ff0044" />
        <LayerToggle label="SST Anomalies" checked={layerState.sstAnomalies} onChange={() => toggle('sstAnomalies')} color="#0099ff" />
        <LayerToggle label="Precip Forecast" checked={layerState.precipForecast} onChange={() => toggle('precipForecast')} color="#4fc3f7" />
        <LayerToggle label="Region Temps" checked={layerState.regionTemps} onChange={() => toggle('regionTemps')} color="#ffaa00" />
      </LayerSection>

      {/* Hazards */}
      <LayerSection title="Hazards" open={openSection === 'Hazards'} onToggle={() => toggleSection('Hazards')}>
        <LayerToggle label="Earthquakes" checked={layerState.earthquakes} onChange={() => toggle('earthquakes')} color="#ef4444" />
        <LayerToggle label="Wildfires" checked={layerState.wildfires} onChange={() => toggle('wildfires')} color="#f97316" />
      </LayerSection>

      {/* Traffic */}
      <LayerSection title="Traffic" open={openSection === 'Traffic'} onToggle={() => toggleSection('Traffic')}>
        <LayerToggle label="Vessels (AIS)" checked={layerState.vessels} onChange={() => toggle('vessels')} color="#00aa88" />
        <LayerToggle label="Aircraft (ADS-B)" checked={layerState.aircraft} onChange={() => toggle('aircraft')} color="#3b82f6" />
        <LayerToggle label="Aircraft Heatmap" checked={layerState.aircraftHeatmap} onChange={() => toggle('aircraftHeatmap')} color="#06b6d4" />
        {layerState.aircraft && (
          <div className="altitude-filter">
            <label className="param-label">Altitude filter (ft)</label>
            <div className="altitude-range">
              <input
                type="number"
                value={aircraftAltitudeFilter.min}
                onChange={(e) => setAircraftAltitudeFilter({ ...aircraftAltitudeFilter, min: parseInt(e.target.value) || 0 })}
                min={0}
                max={60000}
                step={1000}
              />
              <span>—</span>
              <input
                type="number"
                value={aircraftAltitudeFilter.max}
                onChange={(e) => setAircraftAltitudeFilter({ ...aircraftAltitudeFilter, max: parseInt(e.target.value) || 60000 })}
                min={0}
                max={60000}
                step={1000}
              />
            </div>
          </div>
        )}
      </LayerSection>

      {/* Power Grid */}
      <LayerSection title="Power Grid" open={openSection === 'Power Grid'} onToggle={() => toggleSection('Power Grid')}>
        <LayerToggle label="Power Plants" checked={layerState.powerPlants} onChange={() => toggle('powerPlants')} color="#f59e0b" />
        <LayerToggle label="Substations" checked={layerState.substations} onChange={() => toggle('substations')} color="#00ffcc" />
        <LayerToggle label="Data Centers" checked={layerState.dataCenters} onChange={() => toggle('dataCenters')} color="#ec4899" />
        <LayerToggle label="AI Centers" checked={layerState.aiCenters} onChange={() => toggle('aiCenters')} color="#ef4444" />
        <LayerToggle label="Renewable Farms" checked={layerState.renewableFarms} onChange={() => toggle('renewableFarms')} color="#10b981" />
        <LayerToggle label="Battery Storage" checked={layerState.batteryStorage} onChange={() => toggle('batteryStorage')} color="#8b5cf6" />
        <LayerToggle label="Grid Interconnects" checked={layerState.gridInterconnects} onChange={() => toggle('gridInterconnects')} color="#00ffcc" />
      </LayerSection>

      {/* Network */}
      <LayerSection title="Network" open={openSection === 'Network'} onToggle={() => toggleSection('Network')}>
        <LayerToggle label="Net Connections" checked={layerState.networkConnections} onChange={() => toggle('networkConnections')} color="#00aaff" />
        <LayerToggle label="User Location" checked={layerState.userLocation} onChange={() => toggle('userLocation')} color="#00ff88" />
      </LayerSection>
    </div>
  )
}

function LayerSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="layer-section">
      <button className="layer-section-header" onClick={onToggle}>
        <span className="layer-section-arrow">{open ? '▼' : '▶'}</span>
        <span className="layer-section-title">{title}</span>
      </button>
      {open && <div className="layer-section-content">{children}</div>}
    </div>
  )
}

function LayerToggle({ label, checked, onChange, color }: { label: string; checked: boolean; onChange: () => void; color: string }) {
  return (
    <label className="layer-row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="layer-color-dot" style={{ background: color }} />
      <span className="layer-name">{label}</span>
    </label>
  )
}
