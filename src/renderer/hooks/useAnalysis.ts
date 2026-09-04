import { useState, useCallback } from 'react'
import type {
  DemProfileRequest,
  DemProfileResponse,
  SlopeTileRequest,
  SlopeTileResponse,
  AnomalyTileRequest,
  AnomalyTileResponse,
  SlopeAnalysisRequest,
  SlopeAnalysisResponse,
  AnomalyAnalysisRequest,
  AnomalyAnalysisResponse,
  SearchZonesRequest,
  SearchZonesResponse,
  RestPointsRequest,
  RestPointsResponse,
  DemSampleResponse,
  RunoffRequest,
  RunoffResponse,
  RoutePlanRequest,
  RoutePlanResponse,
  FallRiskRequest,
  FallRiskResponse,
  RemainsCorridorRequest,
  RemainsCorridorResponse,
  WaterRequest,
  WaterResponse,
  SentinelRequest,
  SentinelResponse,
  ImportResult,
  RadarData,
  WeatherResponse,
  LngLat,
} from '@shared/types'

/**
 * React hooks wrapping the IPC bridge (window.terrain.*).
 * Each hook manages loading/error state and exposes a trigger function.
 */

export function useDemSample() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DemSampleResponse | null>(null)

  const sample = useCallback(async (lng: number, lat: number) => {
    setLoading(true)
    try {
      const res = await window.terrain.demSample({ lng, lat })
      setResult(res)
      return res
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, result, sample }
}

export function useDemProfile() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<DemProfileResponse | null>(null)

  const run = useCallback(async (req: DemProfileRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.demProfile(req)
      setProfile(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Profile failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setProfile(null), [])
  return { loading, error, profile, run, clear }
}

export function useSlopeTile() {
  const [loading, setLoading] = useState(false)
  const [tile, setTile] = useState<SlopeTileResponse | null>(null)

  const run = useCallback(async (req: SlopeTileRequest) => {
    setLoading(true)
    try {
      const res = await window.terrain.slopeTile(req)
      setTile(res)
      return res
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, tile, run }
}

export function useAnomalyTile() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnomalyTileResponse | null>(null)

  const run = useCallback(async (req: AnomalyTileRequest) => {
    setLoading(true)
    try {
      const res = await window.terrain.anomalyTile(req)
      setResult(res)
      return res
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, result, run }
}

export function useSearchZones() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zones, setZones] = useState<SearchZonesResponse | null>(null)

  const run = useCallback(async (req: SearchZonesRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.searchZones(req)
      setZones(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search zones failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setZones(null), [])
  return { loading, error, zones, run, clear }
}

export function useRestPoints() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState<RestPointsResponse | null>(null)

  const run = useCallback(async (req: RestPointsRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.restPoints(req)
      setPoints(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rest points failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setPoints(null), [])
  return { loading, error, points, run, clear }
}

export function useRunoff() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunoffResponse | null>(null)

  const run = useCallback(async (req: RunoffRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.runoffAnalysis(req)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Runoff analysis failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useRoutePlan() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RoutePlanResponse | null>(null)

  const run = useCallback(async (req: RoutePlanRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.routePlan(req)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Route planning failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useFallRisk() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FallRiskResponse | null>(null)

  const run = useCallback(async (req: FallRiskRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.fallRisk(req)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fall risk analysis failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useRemainsCorridor() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RemainsCorridorResponse | null>(null)

  const run = useCallback(async (req: RemainsCorridorRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.remainsCorridor(req)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Corridor analysis failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useSlopeAnalysis() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SlopeAnalysisResponse | null>(null)

  const run = useCallback(async (req: SlopeAnalysisRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.slopeAnalysis(req)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Slope analysis failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useAnomalyAnalysis() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnomalyAnalysisResponse | null>(null)

  const run = useCallback(async (req: AnomalyAnalysisRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.anomalyAnalysis(req)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anomaly analysis failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useExport() {
  const [exporting, setExporting] = useState(false)

  const exportGeoJSON = useCallback(async (data: Record<string, unknown>) => {
    setExporting(true)
    try {
      const res = await window.terrain.exportGeoJSON(data)
      return res
    } finally {
      setExporting(false)
    }
  }, [])

  const exportKML = useCallback(async (data: Record<string, unknown>) => {
    setExporting(true)
    try {
      const res = await window.terrain.exportKML(data)
      return res
    } finally {
      setExporting(false)
    }
  }, [])

  return { exporting, exportGeoJSON, exportKML }
}

export function useWater() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WaterResponse | null>(null)

  const run = useCallback(async (req: WaterRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.waterFetch(req)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Water fetch failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useSentinel() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SentinelResponse | null>(null)

  const run = useCallback(async (req: SentinelRequest) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.sentinelSearch(req)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sentinel search failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useImportKml() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.importKml()
      if (res) setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => setResult(null), [])
  return { loading, error, result, run, clear }
}

export function useRadar() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RadarData | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.weatherRadar()
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Radar fetch failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, error, result, run }
}

export function useForecast() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WeatherResponse | null>(null)

  const run = useCallback(async (point: LngLat) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.terrain.weatherForecast(point)
      setResult(res)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Forecast fetch failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, error, result, run }
}
