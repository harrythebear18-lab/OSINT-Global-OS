import { useMap } from '../hooks/useMap'
import { useState } from 'react'
import type { ReactNode } from 'react'

interface SidebarProps {
  children?: ReactNode
}

/**
 * Sidebar — project identity, basemap info, selection status.
 * Analysis panel is passed as children from App.
 * Collapsible via the thin strip on the right edge.
 */
export function Sidebar({ children }: SidebarProps) {
  const { selection, clearSelection, clearMap } = useMap()
  const [collapsed, setCollapsed] = useState(false)

  const selectionLabel = selection
    ? `${selection.type} — ${selection.coords.length} points`
    : 'No area selected'

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button
          className="sidebar-expand-btn"
          onClick={() => setCollapsed(false)}
          title="Show left panel"
        >
          ▸
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <button
        className="sidebar-collapse-btn"
        onClick={() => setCollapsed(true)}
        title="Hide left panel"
      >
        ◂
      </button>

      <header className="sidebar-header">
        <h1>OSINT Global OS</h1>
        <p className="tagline">
          Unified global monitoring — terrain, weather, climate, grid, network.
        </p>
      </header>

      <section className="panel">
        <h2>Data Sources</h2>
        <ul className="layer-list">
          <li>Esri World Imagery (satellite basemap)</li>
          <li>AWS Terrarium (3D terrain + hillshade)</li>
          <li>NOAA ERDDAP (NDBC buoys, Argo, GTSPP, TAO, CO₂)</li>
          <li>AviationWeather.gov (METAR stations)</li>
          <li>NHC + NWS (storm tracks, severe alerts)</li>
          <li>Blitzortung (live lightning WebSocket)</li>
          <li>RainViewer (radar + satellite tiles)</li>
          <li>OpenSky Network (ADS-B aircraft)</li>
          <li>Axiom Overwatch (AIS vessels)</li>
          <li>USGS (earthquakes M≥2.5)</li>
          <li>NOAA SWPC (space weather)</li>
          <li>NASA FIRMS (wildfire detections)</li>
          <li>OSM Overpass (water bodies)</li>
          <li>Sentinel-2 imagery (Element84 STAC)</li>
          <li>Nominatim (place search)</li>
        </ul>
        <p className="muted" style={{ fontSize: '9px', marginTop: '4px' }}>
          All sources free and keyless unless noted. Optional keys: XWeather, Meteomatics, FIRMS.
        </p>
      </section>

      <section className="panel">
        <h2>Selection</h2>
        <div className="selection-status">
          <span className={selection ? 'active' : 'muted'}>{selectionLabel}</span>
          {selection && (
            <button className="clear-btn" onClick={clearSelection}>
              Clear
            </button>
          )}
        </div>
        <p className="selection-hint muted">
          Draw a box/polygon/line with the toolbar. Right-click to place LKP pin.
        </p>
        <button className="clear-map-btn" onClick={clearMap}>
          Clear Map (all points &amp; overlays)
        </button>
      </section>

      {children}
    </aside>
  )
}
