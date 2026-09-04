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
import { useDemProfile } from './hooks/useAnalysis'
import type { TripParams } from '@shared/types'

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
            <AnalysisPanel tripParams={tripParams} />
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
        <main className="map-host">
          <SearchBox />
          <MapCanvas />
          <DrawTools />
          <MapOverlays />
          <MarkerLayer />
          <GlobalOverlays layerState={globalLayers} aircraftAltitudeFilter={aircraftAltitudeFilter} />
          {profileHook.profile && (
            <ElevationProfile
              profile={profileHook.profile}
              loading={profileHook.loading}
              units={units}
              onClose={profileHook.clear}
            />
          )}
        </main>
        <RightPanel />
      </div>
    </MapProvider>
  )
}
