import { useState, useEffect } from 'react'
import { MapProvider } from './components/MapProvider'
import { MapCanvas } from './components/MapCanvas'
import { Sidebar } from './components/Sidebar'
import { SearchBox } from './components/SearchBox'
import { DrawTools } from './components/DrawTools'
import { ElevationProfile } from './components/ElevationProfile'
import { MapOverlays } from './components/MapOverlays'
import { MarkerLayer } from './components/MarkerLayer'
import { AnalysisPanel } from './components/AnalysisPanel'
import { TripParamsPanel } from './components/TripParamsPanel'
import { IncidentPanel } from './components/IncidentPanel'
import { CaseProfilePanel } from './components/CaseProfilePanel'
import { LayerSwitcher } from './components/LayerSwitcher'
import { SettingsPanel } from './components/SettingsPanel'
import { WeatherPanel } from './components/WeatherPanel'
import { CollapsiblePanel } from './components/CollapsiblePanel'
import { GlobalOverlays, DEFAULT_LAYER_STATE, type GlobalLayerState } from './components/GlobalOverlays'
import { GlobalLayerPanel } from './components/GlobalLayerPanel'
import { RightPanel } from './components/RightPanel'
import { AIChatPanel } from './components/AIChatPanel'
import { HypothesisPanel } from './components/HypothesisPanel'
import { ExplainabilityOverlay } from './components/ExplainabilityOverlay'
import type { Hypothesis, HypothesisZone } from './lib/hypothesis'
import { useDemProfile } from './hooks/useAnalysis'
import type { TripParams, AnalysisMode } from '@shared/types'

// Default trip params match the backend defaults
const DEFAULT_TRIP_PARAMS: TripParams = {
  hoursSinceLastSeen: 12,
  day: 1,
  pace: 'normal',
  packWeight: 'medium',
  experience: 'experienced',
  weather: 'clear',
  temperatureC: 20,
  timeOfDay: 'midday',
  ageGroup: 'adult',
  fitness: 'average',
}

export default function App() {
  const profileHook = useDemProfile()
  const [units] = useState<'meters' | 'feet'>('meters')
  const [tripParams, setTripParams] = useState<TripParams>(DEFAULT_TRIP_PARAMS)
  const [globalLayers, setGlobalLayers] = useState<GlobalLayerState>(DEFAULT_LAYER_STATE)
  const [aircraftAltitudeFilter, setAircraftAltitudeFilter] = useState({ min: 0, max: 60000 })
  const [aiAnalysisResults, setAiAnalysisResults] = useState<Record<string, unknown>>({})
  const [aiActiveLayers, setAiActiveLayers] = useState<string[]>([])
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('active-sar')

  // Track analysis results for AI context injection
  useEffect(() => {
    const handler = () => {
      // Read from the shared MapOverlays state via a custom event
      window.dispatchEvent(new CustomEvent('ai:request-results'))
    }
    window.addEventListener('terrain:analysis-results', handler)
    return () => window.removeEventListener('terrain:analysis-results', handler)
  }, [])

  // Listen for results response
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) setAiAnalysisResults(detail)
    }
    window.addEventListener('ai:results-response', handler)
    return () => window.removeEventListener('ai:results-response', handler)
  }, [])

  // Track active global layers for AI context
  useEffect(() => {
    const layers: string[] = []
    for (const [key, val] of Object.entries(globalLayers)) {
      if (val === true) layers.push(key)
    }
    setAiActiveLayers(layers)
  }, [globalLayers])

  // Clear elevation profile when "Clear Map" is pressed
  useEffect(() => {
    const handler = () => profileHook.clear()
    window.addEventListener('terrain:clear-all', handler)
    return () => window.removeEventListener('terrain:clear-all', handler)
  }, [])

  return (
    <MapProvider>
      <div className="app-shell app-shell-3col">
        <Sidebar>
          <CollapsiblePanel title="Global Overlays" defaultOpen={true}>
            <GlobalLayerPanel
              layerState={globalLayers}
              setLayerState={setGlobalLayers}
              aircraftAltitudeFilter={aircraftAltitudeFilter}
              setAircraftAltitudeFilter={setAircraftAltitudeFilter}
            />
          </CollapsiblePanel>
          <CollapsiblePanel title="Case Profiles" defaultOpen={false}>
            <CaseProfilePanel />
          </CollapsiblePanel>
          <CollapsiblePanel title="Terrain Layers">
            <LayerSwitcher />
          </CollapsiblePanel>
          <CollapsiblePanel title="Trip Parameters">
            <TripParamsPanel params={tripParams} onChange={setTripParams} />
          </CollapsiblePanel>
          <CollapsiblePanel title="Analysis">
            <AnalysisPanel tripParams={tripParams} mode={analysisMode} />
          </CollapsiblePanel>
          <CollapsiblePanel title="Weather">
            <WeatherPanel />
          </CollapsiblePanel>
          <CollapsiblePanel title="Incident Analysis">
            <IncidentPanel tripParams={tripParams} />
          </CollapsiblePanel>
          <CollapsiblePanel title="Settings" defaultOpen={false}>
            <SettingsPanel />
          </CollapsiblePanel>
        </Sidebar>
        <div className="map-and-bottombar">
          <main className="map-host">
            <SearchBox />
            <MapCanvas />
            <DrawTools />
            <MapOverlays />
            <MarkerLayer />
            <GlobalOverlays layerState={globalLayers} aircraftAltitudeFilter={aircraftAltitudeFilter} />
            <ExplainabilityOverlay hypotheses={hypotheses} />
            {profileHook.profile && (
              <ElevationProfile
                profile={profileHook.profile}
                loading={profileHook.loading}
                units={units}
                onClose={profileHook.clear}
              />
            )}
          </main>
          <AIBottomBar
            hypotheses={hypotheses}
            setHypotheses={setHypotheses}
            tripParams={tripParams}
            analysisResults={aiAnalysisResults}
            activeLayers={aiActiveLayers}
            mode={analysisMode}
            setMode={setAnalysisMode}
          />
        </div>
        <RightPanel />
      </div>
    </MapProvider>
  )
}

/** Bottom bar with collapsible AI Chat + Hypotheses tabs. */
function AIBottomBar({
  hypotheses,
  setHypotheses,
  tripParams,
  analysisResults,
  activeLayers,
  mode,
  setMode,
}: {
  hypotheses: Hypothesis[]
  setHypotheses: (h: Hypothesis[]) => void
  tripParams: TripParams
  analysisResults: Record<string, unknown>
  activeLayers: string[]
  mode: AnalysisMode
  setMode: (m: AnalysisMode) => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'hypotheses'>('chat')
  const [height, setHeight] = useState(280)

  if (!open) {
    return (
      <div className="ai-bottombar-collapsed">
        <button className="ai-bottombar-toggle" onClick={() => setOpen(true)}>
          AI Analyst
          {hypotheses.filter((h) => h.status === 'active').length > 0 && (
            <span className="ai-bottombar-badge">{hypotheses.filter((h) => h.status === 'active').length}</span>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className="ai-bottombar" style={{ height }}>
      <div className="ai-bottombar-header">
        <div className="ai-bottombar-tabs">
          <button
            className={`ai-bottombar-tab ${tab === 'chat' ? 'active' : ''}`}
            onClick={() => setTab('chat')}
          >
            Chat
          </button>
          <button
            className={`ai-bottombar-tab ${tab === 'hypotheses' ? 'active' : ''}`}
            onClick={() => setTab('hypotheses')}
          >
            Hypotheses
            {hypotheses.filter((h) => h.status === 'active').length > 0 && (
              <span className="ai-bottombar-badge">{hypotheses.filter((h) => h.status === 'active').length}</span>
            )}
          </button>
        </div>
        <div className="ai-mode-toggle">
          <button
            className={`ai-mode-btn ${mode === 'active-sar' ? 'active' : ''}`}
            onClick={() => setMode('active-sar')}
            title="Active SAR: LKP-centric, time-critical, conservative, tight zones."
          >
            Active SAR
          </button>
          <button
            className={`ai-mode-btn ${mode === 'legacy-research' ? 'active' : ''}`}
            onClick={() => setMode('legacy-research')}
            title="Legacy / Research: bbox-spread, exploratory, speculation allowed, wide zones."
          >
            Legacy / Research
          </button>
        </div>
        <div className="ai-bottombar-controls">
          <button className="ai-bottombar-resize" onClick={() => setHeight(height === 280 ? 420 : 280)} title="Toggle height">
            {height === 280 ? 'Expand' : 'Shrink'}
          </button>
          <button className="ai-bottombar-close" onClick={() => setOpen(false)} title="Collapse">
            Collapse
          </button>
        </div>
      </div>
      <div className="ai-bottombar-content">
        {tab === 'chat' && (
          <AIChatPanel
            tripParams={tripParams}
            analysisResults={analysisResults}
            activeLayers={activeLayers}
            mode={mode}
          />
        )}
        {tab === 'hypotheses' && (
          <HypothesisPanel
            hypotheses={hypotheses}
            setHypotheses={setHypotheses}
            onZoneSelect={(zone) => {
              const coords = zone.coords
              if (coords.length >= 2) {
                const lngs = coords.map((c) => c.lng)
                const lats = coords.map((c) => c.lat)
                const sw = [Math.min(...lngs), Math.min(...lats)]
                const ne = [Math.max(...lngs), Math.max(...lats)]
                window.dispatchEvent(new CustomEvent('terrain:fit-bounds', {
                  detail: { sw, ne, padding: 50 }
                }))
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
