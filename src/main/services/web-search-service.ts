/**
 * Web Search Service — targeted OSINT queries via free, keyless APIs.
 *
 * Sources:
 *  - DuckDuckGo Instant Answer API: general knowledge, summaries
 *  - Wikipedia REST API: location/terrain context, articles
 *  - NWS API: US weather alerts, forecasts by point
 *  - OpenStreetMap Nominatim: reverse geocoding (place names from coords)
 *
 * No API keys required. All requests are read-only GET requests.
 * Designed for the AI analyst to pull real-time context without
 * the user manually pasting data.
 */

import type { LngLat, AnalysisMode } from '@shared/types'

export interface SearchResult {
  source: string
  title: string
  snippet: string
  url?: string
  raw?: unknown
}

export interface WebSearchResponse {
  query: string
  results: SearchResult[]
  context?: string // pre-formatted context string for LLM injection
}

/** DuckDuckGo Instant Answer API — free, no key. */
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OSINT-Global-OS/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const data = await res.json() as any

    const results: SearchResult[] = []

    // Abstract (main answer)
    if (data.AbstractText) {
      results.push({
        source: 'DuckDuckGo',
        title: data.Heading || query,
        snippet: data.AbstractText,
        url: data.AbstractURL,
      })
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) {
          results.push({
            source: 'DuckDuckGo',
            title: topic.Text.split(' - ')[0] || 'Related',
            snippet: topic.Text,
            url: topic.FirstURL,
          })
        }
      }
    }

    // Definition
    if (data.Definition) {
      results.push({
        source: 'DuckDuckGo',
        title: `Definition: ${query}`,
        snippet: data.Definition,
        url: data.DefinitionURL,
      })
    }

    return results
  } catch {
    return []
  }
}

/** Wikipedia REST API — search articles + get summaries. */
async function searchWikipedia(query: string): Promise<SearchResult[]> {
  try {
    // Search for articles
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`
    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(10000),
    })
    if (!searchRes.ok) return []
    const searchData = await searchRes.json() as any
    const articles = searchData?.query?.search
    if (!articles || articles.length === 0) return []

    const results: SearchResult[] = []

    // Get summary for the top article
    for (const article of articles.slice(0, 3)) {
      const title = article.title
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      try {
        const sumRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(10000) })
        if (sumRes.ok) {
          const sum = await sumRes.json() as any
          results.push({
            source: 'Wikipedia',
            title: sum.title || title,
            snippet: sum.extract || article.snippet || '',
            url: sum.content_urls?.desktop?.page,
          })
        }
      } catch {
        // skip this article
      }
    }

    return results
  } catch {
    return []
  }
}

/** NWS API — get active weather alerts for a location (US only, free, no key). */
async function getNwsAlerts(lng: number, lat: number): Promise<SearchResult[]> {
  try {
    // Get the forecast office for this point
    const pointUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`
    const pointRes = await fetch(pointUrl, {
      headers: { 'User-Agent': 'OSINT-Global-OS/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!pointRes.ok) return []
    const pointData = await pointRes.json() as any

    const results: SearchResult[] = []

    // Get active alerts for this area
    const alertUrl = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`
    const alertRes = await fetch(alertUrl, {
      headers: { 'User-Agent': 'OSINT-Global-OS/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (alertRes.ok) {
      const alertData = await alertRes.json() as any
      for (const feature of (alertData.features || []).slice(0, 5)) {
        const props = feature.properties
        results.push({
          source: 'NWS',
          title: `${props.event} — ${props.areaDesc}`,
          snippet: props.description?.slice(0, 500) || props.headline || 'Active weather alert',
          url: props.id,
          raw: { severity: props.severity, certainty: props.certainty, expires: props.expires },
        })
      }
    }

    // Get current forecast
    if (pointData.properties?.forecast) {
      const fcRes = await fetch(pointData.properties.forecast, {
        headers: { 'User-Agent': 'OSINT-Global-OS/1.0' },
        signal: AbortSignal.timeout(10000),
      })
      if (fcRes.ok) {
        const fcData = await fcRes.json() as any
        const periods = fcData.properties?.periods || []
        if (periods.length > 0) {
          const today = periods.slice(0, 3)
          const forecastText = today.map((p: any) =>
            `${p.name}: ${p.temperature}${p.temperatureUnit}, ${p.shortForecast}, wind ${p.windSpeed} ${p.windDirection}`
          ).join('; ')
          results.push({
            source: 'NWS',
            title: 'Current Forecast',
            snippet: forecastText,
          })
        }
      }
    }

    return results
  } catch {
    return []
  }
}

/** Reverse geocode — get place name from coordinates via Nominatim. */
async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=12`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OSINT-Global-OS/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    return data.display_name || null
  } catch {
    return null
  }
}

/**
 * Main search function — routes to appropriate sources based on query type.
 *
 * Query types:
 *  - "weather alerts near <coords>" → NWS API
 *  - "forecast <coords>" → NWS forecast
 *  - "place name <coords>" → Nominatim reverse geocode
 *  - General text → DuckDuckGo + Wikipedia
 */
export async function webSearch(
  query: string,
  location?: LngLat,
  mode?: AnalysisMode,
): Promise<WebSearchResponse> {
  const analysisMode = mode || 'active-sar'
  const isActiveSAR = analysisMode === 'active-sar'
  const results: SearchResult[] = []
  const q = query.toLowerCase().trim()

  // Location-based queries
  if (location) {
    // ACTIVE SAR: always pull NWS alerts (weather is critical)
    // LEGACY: only pull if explicitly weather-related
    const wantNws = isActiveSAR || q.includes('weather') || q.includes('alert') || q.includes('forecast') || q.includes('storm') || q.includes('rain') || q.includes('snow')
    if (wantNws) {
      const nws = await getNwsAlerts(location.lng, location.lat)
      results.push(...nws)
    }

    // Reverse geocode for place context
    if (q.includes('place') || q.includes('where') || q.includes('location') || q.includes('area') || !isActiveSAR) {
      const place = await reverseGeocode(location.lng, location.lat)
      if (place) {
        results.push({
          source: 'Nominatim',
          title: 'Location',
          snippet: place,
        })
      }
    }
  }

  // General text search
  const [ddg, wiki] = await Promise.all([
    searchDuckDuckGo(query),
    searchWikipedia(query),
  ])
  results.push(...ddg, ...wiki)

  // ACTIVE SAR: prioritize time-critical results (alerts, bulletins, closures)
  // LEGACY: prioritize historical context, cases, terrain data
  let sorted = results
  if (isActiveSAR) {
    // Sort: NWS alerts first, then DDG, then Wikipedia
    const priority = (r: SearchResult) => {
      if (r.source === 'NWS') return 0
      if (r.source === 'DuckDuckGo') return 1
      if (r.source === 'Wikipedia') return 2
      return 3
    }
    sorted = [...results].sort((a, b) => priority(a) - priority(b))
  } else {
    // Legacy: Wikipedia first (historical context), then DDG, then NWS
    const priority = (r: SearchResult) => {
      if (r.source === 'Wikipedia') return 0
      if (r.source === 'DuckDuckGo') return 1
      if (r.source === 'Nominatim') return 2
      if (r.source === 'NWS') return 3
      return 4
    }
    sorted = [...results].sort((a, b) => priority(a) - priority(b))
  }

  // Build context string for LLM injection
  const contextParts: string[] = []
  for (const r of sorted.slice(0, 10)) {
    contextParts.push(`[${r.source}] ${r.title}: ${r.snippet}`)
  }
  const context = contextParts.length > 0
    ? `Web search results for "${query}" (${analysisMode} mode):\n${contextParts.join('\n')}`
    : `No web results found for "${query}".`

  return { query, results: sorted.slice(0, 10), context }
}

/** Quick search — returns just the context string (for LLM injection). */
export async function quickSearch(query: string, location?: LngLat, mode?: AnalysisMode): Promise<string> {
  const res = await webSearch(query, location, mode)
  return res.context ?? `No web results found for "${query}".`
}
