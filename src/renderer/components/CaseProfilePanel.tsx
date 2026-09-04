import { useMap } from '../hooks/useMap'
import { setCustomMarkers } from './MarkerLayer'

/**
 * Case Profile loader — preload known scenarios.
 *
 * Currently supports:
 *  - M Cave (Kenny Veach): preloaded area, LKP, markers
 *  - Custom: user-defined (default)
 *
 * When a case is loaded, it dispatches events to set the LKP, end point,
 * map center, and renders markers on the map.
 */

interface CaseMarker {
  id: string
  label: string
  coord: { lng: number; lat: number }
  description: string
  color: string
}

interface CaseProfileData {
  id: string
  name: string
  description: string
  bounds: [{ lng: number; lat: number }, { lng: number; lat: number }]
  lkp: { lng: number; lat: number }
  endPoint: { lng: number; lat: number }
  center: { lng: number; lat: number }
  zoom: number
  markers: CaseMarker[]
}

const PROFILES: CaseProfileData[] = [
  {
    id: 'custom',
    name: 'Custom Area',
    description: 'User-defined. Draw your own bounding box.',
    bounds: [{ lng: 0, lat: 0 }, { lng: 0, lat: 0 }],
    lkp: { lng: 0, lat: 0 },
    endPoint: { lng: 0, lat: 0 },
    center: { lng: 0, lat: 0 },
    zoom: 9,
    markers: [],
  },
  {
    id: 'm-cave',
    name: 'M Cave (Kenny Veach)',
    description:
      'Kenny Veach disappeared Nov 2014 while searching for the M Cave near Sheep Mountain / Nellis Range. Preloaded with approximate LKP and known POIs.',
    bounds: [
      { lng: -115.35, lat: 36.45 },
      { lng: -115.15, lat: 36.62 },
    ],
    lkp: { lng: -115.24, lat: 36.52 },
    endPoint: { lng: -115.28, lat: 36.58 },
    center: { lng: -115.25, lat: 36.55 },
    zoom: 12,
    markers: [
      { id: 'trailhead', label: 'Likely Trailhead', coord: { lng: -115.24, lat: 36.52 }, description: 'Approximate starting point', color: '#00ff88' },
      { id: 'sheep-mtn', label: 'Sheep Mountain', coord: { lng: -115.27, lat: 36.57 }, description: 'Prominent terrain feature', color: '#ffaa00' },
      { id: 'nellis', label: 'Nellis Range Boundary', coord: { lng: -115.30, lat: 36.55 }, description: 'Restricted area boundary', color: '#ff3333' },
      { id: 'search', label: 'Reported Search Area', coord: { lng: -115.26, lat: 36.55 }, description: 'Where search teams focused', color: '#00aaff' },
    ],
  },
]

export function CaseProfilePanel() {
  const { map } = useMap()

  const loadProfile = (profile: CaseProfileData) => {
    if (profile.id === 'custom') return

    // Fly to the area
    if (map) {
      map.flyTo({ center: [profile.center.lng, profile.center.lat], zoom: profile.zoom, duration: 2000 })
    }

    // Set LKP
    window.dispatchEvent(new CustomEvent('terrain:lkp', { detail: profile.lkp }))

    // Set end point
    window.dispatchEvent(new CustomEvent('terrain:endpoint', { detail: profile.endPoint }))

    // Set custom markers via the unified MarkerLayer
    setCustomMarkers(profile.markers.map((m) => ({
      id: m.id,
      label: m.label,
      coord: m.coord,
      color: m.color,
      icon: '★',
    })))
  }

  return (
    <section className="panel case-profile-panel">
      <h2>Case Profiles</h2>
      {PROFILES.filter((p) => p.id !== 'custom').map((profile) => (
        <div key={profile.id} className="case-profile-item">
          <div className="case-profile-header">
            <span className="case-profile-name">{profile.name}</span>
            <button className="run-btn" onClick={() => loadProfile(profile)}>
              Load
            </button>
          </div>
          <p className="case-profile-desc muted">{profile.description}</p>
          <div className="case-profile-markers">
            {profile.markers.map((m) => (
              <span key={m.id} className="case-marker-tag" style={{ borderLeftColor: m.color }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
