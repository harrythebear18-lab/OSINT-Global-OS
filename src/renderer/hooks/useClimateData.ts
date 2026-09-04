import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * useClimateData — subscribes to climate/ocean/prediction IPC push events.
 *
 * Exposes:
 *  - climateUpdate: stations + measurements + stats (every 4 min)
 *  - integrity: sensor/data-flow/results verification + storms/lightning/vessels/aircraft/earthquakes/wildfires
 *  - alerts: climate alerts stream
 *  - traffic: time-series traffic data
 *  - predictions: 7-model prediction network output
 *  - aircraftWeatherAlerts: cross-domain weather→aircraft alerts
 *  - viewport reporting: sends map bounds to backend for culling
 */
export function useClimateData() {
  const [climateUpdate, setClimateUpdate] = useState<any>(null)
  const [integrity, setIntegrity] = useState<any>(null)
  const [alerts, setAlerts] = useState<any[]>([])
  const [traffic, setTraffic] = useState<any[]>([])
  const [predictions, setPredictions] = useState<any>(null)
  const [aircraftWeatherAlerts, setAircraftWeatherAlerts] = useState<any[]>([])
  const [aircraftMetadata, setAircraftMetadata] = useState<Record<string, any>>({})
  const [aircraftTracks, setAircraftTracks] = useState<Record<string, any[]>>({})
  const cleanupFns = useRef<(() => void)[]>([])

  useEffect(() => {
    const climate = (window as any).climate
    if (!climate) {
      console.warn('[useClimateData] window.climate not available — preload not loaded?')
      return
    }

    const cleanups: (() => void)[] = []

    // Push event subscriptions
    cleanups.push(climate.onClimateUpdate((data: any) => setClimateUpdate(data)))
    cleanups.push(climate.onClimateIntegrity((data: any) => setIntegrity(data)))
    cleanups.push(climate.onClimateAlert((alert: any) => {
      setAlerts((prev) => [...prev.slice(-99), alert])
    }))
    cleanups.push(climate.onClimateTraffic((data: any) => {
      setTraffic((prev) => [...prev.slice(-99), data])
    }))
    cleanups.push(climate.onPredictionUpdate((data: any) => setPredictions(data)))
    cleanups.push(climate.onAircraftWeatherAlerts((data: any) => setAircraftWeatherAlerts(data)))

    cleanupFns.current = cleanups
    return () => cleanups.forEach((fn) => fn && fn())
  }, [])

  /** Send current map viewport bounds to backend for aircraft/vessel culling. */
  const setViewport = useCallback((bounds: { n: number; s: number; e: number; w: number } | null) => {
    const climate = (window as any).climate
    if (climate) climate.setViewport(bounds)
  }, [])

  /** Fetch on-demand aircraft metadata (manufacturer, model, operator). */
  const getAircraftMetadata = useCallback(async (icao24: string) => {
    const climate = (window as any).climate
    if (!climate) return null
    const meta = await climate.getAircraftMetadata(icao24)
    if (meta) {
      setAircraftMetadata((prev) => ({ ...prev, [icao24]: meta }))
    }
    return meta
  }, [])

  /** Fetch on-demand aircraft flight track (trajectory polyline). */
  const getAircraftTrack = useCallback(async (icao24: string) => {
    const climate = (window as any).climate
    if (!climate) return null
    const track = await climate.getAircraftTrack(icao24)
    if (track) {
      setAircraftTracks((prev) => ({ ...prev, [icao24]: track }))
    }
    return track
  }, [])

  /** Whitelist a station (suppress alerts). */
  const whitelistStation = useCallback((stationId: string) => {
    const climate = (window as any).climate
    if (climate) climate.whitelistStation(stationId)
  }, [])

  /** Remove a station from the whitelist. */
  const unwhitelistStation = useCallback((stationId: string) => {
    const climate = (window as any).climate
    if (climate) climate.unwhitelistStation(stationId)
  }, [])

  /** Snooze alerts for N milliseconds. */
  const snoozeAlerts = useCallback((ms: number) => {
    const climate = (window as any).climate
    if (climate) climate.snoozeAlerts(ms)
  }, [])

  /** Proxy a Windy webcam API request through the main process (avoids CORS). */
  const windyFetch = useCallback(async (url: string, apiKey: string) => {
    const climate = (window as any).climate
    if (!climate) return null
    return climate.windyFetch(url, apiKey)
  }, [])

  return {
    climateUpdate,
    integrity,
    alerts,
    traffic,
    predictions,
    aircraftWeatherAlerts,
    aircraftMetadata,
    aircraftTracks,
    setViewport,
    getAircraftMetadata,
    getAircraftTrack,
    whitelistStation,
    unwhitelistStation,
    snoozeAlerts,
    windyFetch,
  }
}
