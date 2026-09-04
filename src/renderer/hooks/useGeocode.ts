import { useState, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
  boundingbox: [string, string, string, string]
}

/**
 * Place name search using Nominatim (OpenStreetMap geocoder).
 * Free, no API key required. Returns results and flies the map to them.
 */
export function useGeocode() {
  const [results, setResults] = useState<NominatimResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
        { headers: { 'Accept-Language': 'en' } },
      )
      if (!res.ok) throw new Error(`Geocode failed: ${res.status}`)
      const data = (await res.json()) as NominatimResult[]
      setResults(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const flyTo = useCallback((result: NominatimResult, map: maplibregl.Map | null) => {
    if (!map) return
    const lng = parseFloat(result.lon)
    const lat = parseFloat(result.lat)
    const [south, north, west, east] = result.boundingbox.map(parseFloat)
    // If we have a bounding box, fit to it; otherwise just fly to point
    if (Math.abs(north - south) > 0.001 && Math.abs(east - west) > 0.001) {
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 80, duration: 1500 },
      )
    } else {
      map.flyTo({ center: [lng, lat], zoom: 12, duration: 1500 })
    }
  }, [])

  return { results, loading, error, search, flyTo }
}
