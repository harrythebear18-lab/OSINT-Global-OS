import { useState, useEffect } from 'react'

/**
 * Settings panel — user-configurable app settings.
 *
 * Settings:
 *  - Slope thresholds (hiking/scrambling/SAR)
 *  - Rest point weights (slope/water/shelter/distance)
 *  - Cache location (display only — set via env)
 *  - Units (meters/feet)
 *  - Clear cache button
 *
 * Settings are persisted to localStorage and read by the relevant services.
 */

const DEFAULTS = {
  hikingThreshold: 35,
  scramblingThreshold: 45,
  sarThreshold: 50,
  restSlopeWeight: 0.35,
  restWaterWeight: 0.20,
  restShelterWeight: 0.25,
  restDistanceWeight: 0.20,
  units: 'meters' as 'meters' | 'feet',
}

export function SettingsPanel() {
  const [settings, setSettings] = useState(DEFAULTS)
  const [cacheCleared, setCacheCleared] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('terrain-scout-settings')
    if (saved) {
      try {
        setSettings({ ...DEFAULTS, ...JSON.parse(saved) })
      } catch { /* ignore */ }
    }
  }, [])

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem('terrain-scout-settings', JSON.stringify(settings))
  }, [settings])

  const update = (key: keyof typeof settings, value: number | string) => {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  const clearCache = async () => {
    try {
      await window.terrain.clearCache()
      setCacheCleared(true)
      setTimeout(() => setCacheCleared(false), 3000)
    } catch (e) {
      console.error('Failed to clear cache:', e)
    }
  }

  return (
    <div className="settings-panel">
      <h3>Slope Thresholds</h3>
      <div className="settings-row">
        <label>Hiking (impassable {'>'})</label>
        <input
          type="number"
          min="10"
          max="60"
          value={settings.hikingThreshold}
          onChange={(e) => update('hikingThreshold', parseInt(e.target.value) || 35)}
        />
        <span>°</span>
      </div>
      <div className="settings-row">
        <label>Scrambling</label>
        <input
          type="number"
          min="10"
          max="60"
          value={settings.scramblingThreshold}
          onChange={(e) => update('scramblingThreshold', parseInt(e.target.value) || 45)}
        />
        <span>°</span>
      </div>
      <div className="settings-row">
        <label>SAR (rope teams)</label>
        <input
          type="number"
          min="10"
          max="60"
          value={settings.sarThreshold}
          onChange={(e) => update('sarThreshold', parseInt(e.target.value) || 50)}
        />
        <span>°</span>
      </div>

      <h3 style={{ marginTop: '12px' }}>Rest Point Weights</h3>
      <div className="settings-row">
        <label>Slope</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.restSlopeWeight}
          onChange={(e) => update('restSlopeWeight', parseFloat(e.target.value))}
        />
        <span>{(settings.restSlopeWeight * 100).toFixed(0)}%</span>
      </div>
      <div className="settings-row">
        <label>Water</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.restWaterWeight}
          onChange={(e) => update('restWaterWeight', parseFloat(e.target.value))}
        />
        <span>{(settings.restWaterWeight * 100).toFixed(0)}%</span>
      </div>
      <div className="settings-row">
        <label>Shelter</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.restShelterWeight}
          onChange={(e) => update('restShelterWeight', parseFloat(e.target.value))}
        />
        <span>{(settings.restShelterWeight * 100).toFixed(0)}%</span>
      </div>
      <div className="settings-row">
        <label>Distance</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.restDistanceWeight}
          onChange={(e) => update('restDistanceWeight', parseFloat(e.target.value))}
        />
        <span>{(settings.restDistanceWeight * 100).toFixed(0)}%</span>
      </div>

      <h3 style={{ marginTop: '12px' }}>Units</h3>
      <div className="settings-row">
        <label>Elevation</label>
        <select value={settings.units} onChange={(e) => update('units', e.target.value)}>
          <option value="meters">Meters</option>
          <option value="feet">Feet</option>
        </select>
      </div>

      <h3 style={{ marginTop: '12px' }}>Cache</h3>
      <div className="settings-row">
        <label>Location</label>
        <span className="muted" style={{ fontSize: '9px' }}>~/.terrain-scout/cache/</span>
      </div>
      <button className="run-btn" onClick={clearCache} style={{ marginTop: '4px', width: '100%' }}>
        {cacheCleared ? 'Cache cleared!' : 'Clear DEM Cache'}
      </button>
    </div>
  )
}
