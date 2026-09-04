import { useState, type KeyboardEvent } from 'react'
import { useGeocode } from '../hooks/useGeocode'
import { useMap } from '../hooks/useMap'

/**
 * Place name search box.
 * Uses Nominatim (free OSM geocoder) — no API key needed.
 * Type a place, pick a result, map flies there.
 *
 * Also supports direct coordinate entry:
 *  - "40.7128, -74.0060"
 *  - "40.7128 -74.0060"
 *  - "40.7128, -74.0060" (with or without spaces)
 */
export function SearchBox() {
  const { map } = useMap()
  const { results, loading, error, search, flyTo } = useGeocode()
  const [query, setQuery] = useState('')
  const [showResults, setShowResults] = useState(false)

  // Try to parse the query as "lat, lng" coordinates
  const parseCoords = (q: string): { lat: number; lng: number } | null => {
    // Match patterns like: 40.7128, -74.0060  |  40.7128 -74.0060  |  40, -74  |  -33.86, 151.2
    const m = q.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,?\s*(-?\d{1,3}(?:\.\d+)?)$/)
    if (!m) return null
    const lat = parseFloat(m[1])
    const lng = parseFloat(m[2])
    // Validate ranges
    if (isNaN(lat) || isNaN(lng)) return null
    if (lat < -90 || lat > 90) return null
    if (lng < -180 || lng > 180) return null
    return { lat, lng }
  }

  const handleSearch = () => {
    const coords = parseCoords(query)
    if (coords) {
      // Direct coordinate jump — fly the map there
      if (map && !(map as any)._removed) {
        map.flyTo({ center: [coords.lng, coords.lat], zoom: 13, duration: 1500 })
      }
      setShowResults(false)
      return
    }
    search(query)
    setShowResults(true)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch()
    if (e.key === 'Escape') setShowResults(false)
  }

  const handleSelect = (result: (typeof results)[0]) => {
    flyTo(result, map)
    setShowResults(false)
    setQuery(result.display_name.split(',')[0])
  }

  return (
    <div className="search-box">
      <div className="search-input-row">
        <input
          type="text"
          placeholder="Search place or enter lat, lng..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
          className="search-input"
        />
        <button onClick={handleSearch} className="search-btn" disabled={loading}>
          {loading ? '...' : 'Go'}
        </button>
      </div>
      {error && <div className="search-error">{error}</div>}
      {showResults && results.length > 0 && (
        <ul className="search-results">
          {results.map((r, i) => (
            <li key={i} onMouseDown={() => handleSelect(r)} className="search-result-item">
              {r.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
