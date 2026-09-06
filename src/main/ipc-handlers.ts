/**
 * IPC handler registration.
 *
 * Wires main-process services to IPC channels defined in @shared/ipc.
 * All services are now live (Phases 2–7):
 *  - DEM sample + profile (Terrarium tiles via AWS)
 *  - Slope tiles (Horn's method)
 *  - Terrain anomalies (deviation from smoothed surface)
 *  - Search zones (ring buffers + terrain passability)
 *  - Rest points (behavior model: slope/water/shelter/distance)
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { IPC } from '@shared/ipc'
import type {
  DemSampleRequest,
  DemSampleResponse,
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
  CanopyAnalysisRequest,
  CanopyAnalysisResponse,
  CrowdFlowRequest,
  CrowdFlowResponse,
  ImportResult,
  RadarData,
  WeatherResponse,
  LngLat,
} from '@shared/types'
import { demService } from './services/dem-service'
import { slopeService, analyzeSlopeArea } from './services/slope-service'
import { anomalyService, analyzeAnomalyArea } from './services/anomaly-service'
import { searchService } from './services/search-service'
import { restPointService } from './services/rest-service'
import { analyzeRunoff } from './services/runoff-service'
import { planRoute } from './services/route-service'
import { analyzeFallRisk } from './services/fall-risk-service'
import { analyzeRemainsCorridor } from './services/remains-corridor-service'
import { toGeoJSON, toKML } from './services/export-service'
import { fetchWaterFeatures } from './services/water-service'
import { searchSentinelScenes } from './services/sentinel-service'
import { analyzeCanopy } from './services/canopy-service'
import { simulateCrowdFlow } from './services/crowd-flow-service'
import { parseKmlFile } from './services/import-service'
import { fetchRadarData, fetchWeather } from './services/weather-service'
import { lngLatToTile, DEFAULT_ZOOM } from './services/dem-tiles'

/* ------------------------------------------------------------------ */
/* DEM (Phase 2)                                                      */
/* ------------------------------------------------------------------ */

async function demSample(req: DemSampleRequest): Promise<DemSampleResponse> {
  const elevation = await demService.sample(req.lng, req.lat)
  return { elevation }
}

async function demProfile(req: DemProfileRequest): Promise<DemProfileResponse> {
  return demService.profile(req.coords)
}

/* ------------------------------------------------------------------ */
/* Slope (Phase 4)                                                    */
/* ------------------------------------------------------------------ */

async function slopeTile(req: SlopeTileRequest): Promise<SlopeTileResponse> {
  const tile = await demService.loadTile(req.x, req.y, req.z || DEFAULT_ZOOM)
  return slopeService.computeFromDem(tile)
}

/* ------------------------------------------------------------------ */
/* Anomaly (Phase 5)                                                  */
/* ------------------------------------------------------------------ */

async function anomalyTile(req: AnomalyTileRequest): Promise<AnomalyTileResponse> {
  const tile = await demService.loadTile(req.x, req.y, req.z || DEFAULT_ZOOM)
  return anomalyService.compute(tile)
}

/* ------------------------------------------------------------------ */
/* Search zones (Phase 6)                                             */
/* ------------------------------------------------------------------ */

async function searchZones(req: SearchZonesRequest): Promise<SearchZonesResponse> {
  return searchService.generateZones(req)
}

/* ------------------------------------------------------------------ */
/* Rest points (Phase 7)                                              */
/* ------------------------------------------------------------------ */

async function restPoints(req: RestPointsRequest): Promise<RestPointsResponse> {
  return restPointService.find(req)
}

/* ------------------------------------------------------------------ */
/* Rainfall runoff (hydrology)                                        */
/* ------------------------------------------------------------------ */

async function runoffAnalysis(req: RunoffRequest): Promise<RunoffResponse> {
  // Run with a 30-second timeout so the UI doesn't hang forever on huge areas
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Runoff analysis timed out (30s) — try a smaller area')), 30000),
  )
  return Promise.race([analyzeRunoff(req), timeout])
}

/* ------------------------------------------------------------------ */
/* Route planning (terrain-aware pathfinding)                         */
/* ------------------------------------------------------------------ */

async function routePlan(req: RoutePlanRequest): Promise<RoutePlanResponse> {
  return planRoute(req)
}

/* ------------------------------------------------------------------ */
/* Fall risk (incident analysis)                                      */
/* ------------------------------------------------------------------ */

async function fallRisk(req: FallRiskRequest): Promise<FallRiskResponse> {
  return analyzeFallRisk(req)
}

/* ------------------------------------------------------------------ */
/* Remains corridor (downhill search from fall point)                 */
/* ------------------------------------------------------------------ */

async function remainsCorridor(req: RemainsCorridorRequest): Promise<RemainsCorridorResponse> {
  return analyzeRemainsCorridor(req)
}

/* ------------------------------------------------------------------ */
/* Slope analysis (area-based overlay)                                 */
/* ------------------------------------------------------------------ */

async function slopeAnalysis(req: SlopeAnalysisRequest): Promise<SlopeAnalysisResponse> {
  return analyzeSlopeArea(req)
}

/* ------------------------------------------------------------------ */
/* Anomaly analysis (area-based overlay)                               */
/* ------------------------------------------------------------------ */

async function anomalyAnalysis(req: AnomalyAnalysisRequest): Promise<AnomalyAnalysisResponse> {
  return analyzeAnomalyArea(req)
}

/* ------------------------------------------------------------------ */
/* Export (GeoJSON / KML)                                             */
/* ------------------------------------------------------------------ */

async function exportGeoJSON(data: Record<string, unknown>): Promise<{ saved: boolean; path?: string }> {
  const geojson = toGeoJSON(data)
  const result = await dialog.showSaveDialog({
    title: 'Export as GeoJSON',
    defaultPath: 'osint-global-os-export.geojson',
    filters: [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }],
  })
  if (result.canceled || !result.filePath) return { saved: false }
  fs.writeFileSync(result.filePath, geojson, 'utf8')
  return { saved: true, path: result.filePath }
}

async function exportKML(data: Record<string, unknown>): Promise<{ saved: boolean; path?: string }> {
  const kml = toKML(data)
  const result = await dialog.showSaveDialog({
    title: 'Export as KML',
    defaultPath: 'osint-global-os-export.kml',
    filters: [{ name: 'KML', extensions: ['kml'] }],
  })
  if (result.canceled || !result.filePath) return { saved: false }
  fs.writeFileSync(result.filePath, kml, 'utf8')
  return { saved: true, path: result.filePath }
}

/* ------------------------------------------------------------------ */
/* Water features (OSM Overpass)                                      */
/* ------------------------------------------------------------------ */

async function waterFetch(req: WaterRequest): Promise<WaterResponse> {
  return fetchWaterFeatures(req.bounds)
}

/* ------------------------------------------------------------------ */
/* Satellite imagery (NASA GIBS)                                      */
/* ------------------------------------------------------------------ */

async function sentinelSearch(req: SentinelRequest): Promise<SentinelResponse> {
  return searchSentinelScenes(req.bounds, req.maxCloudCover, req.limit, req.layerId, req.date)
}

/* ------------------------------------------------------------------ */
/* Canopy Intelligence Layer                                          */
/* ------------------------------------------------------------------ */

async function canopyAnalysis(req: CanopyAnalysisRequest): Promise<CanopyAnalysisResponse> {
  return analyzeCanopy(req)
}

/* ------------------------------------------------------------------ */
/* Crowd Flow Simulation                                              */
/* ------------------------------------------------------------------ */

async function crowdFlowAnalysis(req: CrowdFlowRequest): Promise<CrowdFlowResponse> {
  return simulateCrowdFlow(req)
}

/* ------------------------------------------------------------------ */
/* Import KML / KMZ                                                   */
/* ------------------------------------------------------------------ */

async function importKml(): Promise<ImportResult | null> {
  const result = await dialog.showOpenDialog({
    title: 'Import KML or KMZ file',
    filters: [
      { name: 'KML/KMZ', extensions: ['kml', 'kmz'] },
      { name: 'KML', extensions: ['kml'] },
      { name: 'KMZ', extensions: ['kmz'] },
    ],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return parseKmlFile(result.filePaths[0])
}

/* ------------------------------------------------------------------ */
/* Clear DEM cache                                                    */
/* ------------------------------------------------------------------ */

async function clearCache(): Promise<{ cleared: boolean }> {
  const cacheDir = path.join(os.homedir(), '.osint-global-os', 'cache')
  try {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true })
      fs.mkdirSync(cacheDir, { recursive: true })
    }
    return { cleared: true }
  } catch (e) {
    console.error('Failed to clear cache:', e)
    return { cleared: false }
  }
}

/* ------------------------------------------------------------------ */
/* PNG snapshot export                                                */
/* ------------------------------------------------------------------ */

async function exportPng(): Promise<{ saved: boolean; path?: string }> {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return { saved: false }

  const image = await win.webContents.capturePage()
  const result = await dialog.showSaveDialog({
    title: 'Export as PNG',
    defaultPath: 'osint-global-os-snapshot.png',
    filters: [{ name: 'PNG', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return { saved: false }
  fs.writeFileSync(result.filePath, image.toPNG())
  return { saved: true, path: result.filePath }
}

/* ------------------------------------------------------------------ */
/* Weather (RainViewer radar + Open-Meteo forecast)                  */
/* ------------------------------------------------------------------ */

async function weatherRadar(): Promise<RadarData> {
  return fetchRadarData()
}

async function weatherForecast(point: LngLat): Promise<WeatherResponse> {
  return fetchWeather(point)
}

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Wrap an async handler with error catching so main process doesn't crash.
 */
function safeHandle<T>(fn: (req: T) => Promise<unknown>): (e: Electron.IpcMainInvokeEvent, req: T) => Promise<unknown> {
  return async (_e, req) => {
    try {
      return await fn(req)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`IPC handler error: ${msg}`)
      throw new Error(msg)
    }
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.DEM_SAMPLE, safeHandle(demSample))
  ipcMain.handle(IPC.DEM_PROFILE, safeHandle(demProfile))
  ipcMain.handle(IPC.SLOPE_TILE, safeHandle(slopeTile))
  ipcMain.handle(IPC.ANOMALY_TILE, safeHandle(anomalyTile))
  ipcMain.handle(IPC.SLOPE_ANALYSIS, safeHandle(slopeAnalysis))
  ipcMain.handle(IPC.ANOMALY_ANALYSIS, safeHandle(anomalyAnalysis))
  ipcMain.handle(IPC.SEARCH_ZONES, safeHandle(searchZones))
  ipcMain.handle(IPC.REST_POINTS, safeHandle(restPoints))
  ipcMain.handle(IPC.RUNOFF_ANALYSIS, safeHandle(runoffAnalysis))
  ipcMain.handle(IPC.ROUTE_PLAN, safeHandle(routePlan))
  ipcMain.handle(IPC.FALL_RISK, safeHandle(fallRisk))
  ipcMain.handle(IPC.REMAINS_CORRIDOR, safeHandle(remainsCorridor))
  ipcMain.handle(IPC.EXPORT_GEOJSON, safeHandle(exportGeoJSON))
  ipcMain.handle(IPC.EXPORT_KML, safeHandle(exportKML))
  ipcMain.handle(IPC.WATER_FETCH, safeHandle(waterFetch))
  ipcMain.handle(IPC.SENTINEL_SEARCH, safeHandle(sentinelSearch))
  ipcMain.handle(IPC.CANOPY_ANALYSIS, safeHandle(canopyAnalysis))
  ipcMain.handle(IPC.CROWD_FLOW_ANALYSIS, safeHandle(crowdFlowAnalysis))
  ipcMain.handle(IPC.IMPORT_KML, safeHandle(importKml))
  ipcMain.handle(IPC.CLEAR_CACHE, safeHandle(clearCache))
  ipcMain.handle(IPC.EXPORT_PNG, safeHandle(exportPng))
  ipcMain.handle(IPC.WEATHER_RADAR, safeHandle(weatherRadar))
  ipcMain.handle(IPC.WEATHER_FORECAST, safeHandle(weatherForecast))
}

