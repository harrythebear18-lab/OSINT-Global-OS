/**
 * Preload bridge.
 *
 * Exposes a minimal, typed API to the renderer via contextBridge.
 * The renderer calls `window.terrain.*` and never touches ipcRenderer
 * or Node APIs directly.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
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
  ImportResult,
  RadarData,
  WeatherResponse,
  LngLat,
} from '@shared/types'

const terrain = {
  demSample: (req: DemSampleRequest): Promise<DemSampleResponse> =>
    ipcRenderer.invoke(IPC.DEM_SAMPLE, req),
  demProfile: (req: DemProfileRequest): Promise<DemProfileResponse> =>
    ipcRenderer.invoke(IPC.DEM_PROFILE, req),
  slopeTile: (req: SlopeTileRequest): Promise<SlopeTileResponse> =>
    ipcRenderer.invoke(IPC.SLOPE_TILE, req),
  anomalyTile: (req: AnomalyTileRequest): Promise<AnomalyTileResponse> =>
    ipcRenderer.invoke(IPC.ANOMALY_TILE, req),
  searchZones: (req: SearchZonesRequest): Promise<SearchZonesResponse> =>
    ipcRenderer.invoke(IPC.SEARCH_ZONES, req),
  restPoints: (req: RestPointsRequest): Promise<RestPointsResponse> =>
    ipcRenderer.invoke(IPC.REST_POINTS, req),
  runoffAnalysis: (req: RunoffRequest): Promise<RunoffResponse> =>
    ipcRenderer.invoke(IPC.RUNOFF_ANALYSIS, req),
  routePlan: (req: RoutePlanRequest): Promise<RoutePlanResponse> =>
    ipcRenderer.invoke(IPC.ROUTE_PLAN, req),
  fallRisk: (req: FallRiskRequest): Promise<FallRiskResponse> =>
    ipcRenderer.invoke(IPC.FALL_RISK, req),
  remainsCorridor: (req: RemainsCorridorRequest): Promise<RemainsCorridorResponse> =>
    ipcRenderer.invoke(IPC.REMAINS_CORRIDOR, req),
  slopeAnalysis: (req: SlopeAnalysisRequest): Promise<SlopeAnalysisResponse> =>
    ipcRenderer.invoke(IPC.SLOPE_ANALYSIS, req),
  anomalyAnalysis: (req: AnomalyAnalysisRequest): Promise<AnomalyAnalysisResponse> =>
    ipcRenderer.invoke(IPC.ANOMALY_ANALYSIS, req),
  exportGeoJSON: (data: Record<string, unknown>): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.EXPORT_GEOJSON, data),
  exportKML: (data: Record<string, unknown>): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.EXPORT_KML, data),
  waterFetch: (req: WaterRequest): Promise<WaterResponse> =>
    ipcRenderer.invoke(IPC.WATER_FETCH, req),
  sentinelSearch: (req: SentinelRequest): Promise<SentinelResponse> =>
    ipcRenderer.invoke(IPC.SENTINEL_SEARCH, req),
  importKml: (): Promise<ImportResult | null> =>
    ipcRenderer.invoke(IPC.IMPORT_KML),
  clearCache: (): Promise<{ cleared: boolean }> =>
    ipcRenderer.invoke(IPC.CLEAR_CACHE),
  exportPng: (): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.EXPORT_PNG),
  weatherRadar: (): Promise<RadarData> =>
    ipcRenderer.invoke(IPC.WEATHER_RADAR),
  weatherForecast: (point: LngLat): Promise<WeatherResponse> =>
    ipcRenderer.invoke(IPC.WEATHER_FORECAST, point),
} as const

export type TerrainApi = typeof terrain

contextBridge.exposeInMainWorld('terrain', terrain)

/* ------------------------------------------------------------------ */
/* Climate / Ocean / Prediction / Aircraft / Windy                    */
/* ------------------------------------------------------------------ */
const climate = {
  // Push event listeners
  onClimateUpdate: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.CLIMATE_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.CLIMATE_UPDATE, handler)
  },
  onClimateIntegrity: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.CLIMATE_INTEGRITY, handler)
    return () => ipcRenderer.removeListener(IPC.CLIMATE_INTEGRITY, handler)
  },
  onClimateAlert: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.CLIMATE_ALERT, handler)
    return () => ipcRenderer.removeListener(IPC.CLIMATE_ALERT, handler)
  },
  onClimateTraffic: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.CLIMATE_TRAFFIC, handler)
    return () => ipcRenderer.removeListener(IPC.CLIMATE_TRAFFIC, handler)
  },
  onPredictionUpdate: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.PREDICTION_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.PREDICTION_UPDATE, handler)
  },
  onAircraftWeatherAlerts: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.AIRCRAFT_WEATHER_ALERTS, handler)
    return () => ipcRenderer.removeListener(IPC.AIRCRAFT_WEATHER_ALERTS, handler)
  },

  // Station / alert management
  whitelistStation: (stationId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.CLIMATE_WHITELIST, stationId),
  unwhitelistStation: (stationId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.CLIMATE_UNWHITELIST, stationId),
  snoozeAlerts: (ms: number): Promise<void> =>
    ipcRenderer.invoke(IPC.CLIMATE_SNOOZE, ms),
  isSnoozed: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CLIMATE_GET_SNOOZE),
  setViewport: (bounds: unknown): void =>
    ipcRenderer.send(IPC.CLIMATE_SET_VIEWPORT, bounds),

  // Aircraft on-demand
  getAircraftMetadata: (icao24: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.AIRCRAFT_METADATA, icao24),
  getAircraftTrack: (icao24: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.AIRCRAFT_TRACK, icao24),

  // Windy webcam proxy
  windyFetch: (url: string, apiKey: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.WINDY_FETCH, url, apiKey),
} as const

export type ClimateApi = typeof climate

contextBridge.exposeInMainWorld('climate', climate)

/* ------------------------------------------------------------------ */
/* Grid monitor                                                        */
/* ------------------------------------------------------------------ */
const grid = {
  // Push event listeners
  onGridUpdate: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.GRID_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.GRID_UPDATE, handler)
  },
  onGridIntegrity: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.GRID_INTEGRITY, handler)
    return () => ipcRenderer.removeListener(IPC.GRID_INTEGRITY, handler)
  },
  onGridAlert: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.GRID_ALERT, handler)
    return () => ipcRenderer.removeListener(IPC.GRID_ALERT, handler)
  },
  onGridTraffic: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.GRID_TRAFFIC, handler)
    return () => ipcRenderer.removeListener(IPC.GRID_TRAFFIC, handler)
  },
  onGridSettings: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.GRID_SETTINGS, handler)
    return () => ipcRenderer.removeListener(IPC.GRID_SETTINGS, handler)
  },

  // Whitelist / snooze
  whitelistAsset: (assetId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.GRID_WHITELIST, assetId),
  unwhitelistAsset: (assetId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.GRID_UNWHITELIST, assetId),
  getGridWhitelist: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC.GRID_GET_WHITELIST),
  snoozeGridAlerts: (minutes: number): Promise<void> =>
    ipcRenderer.invoke(IPC.GRID_SNOOZE, minutes),
  isGridSnoozed: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.GRID_GET_SNOOZE),

  // Settings
  getGridSettings: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.GRID_GET_SETTINGS),
  updateGridSettings: (partial: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke(IPC.GRID_UPDATE_SETTINGS, partial),

  // Cross-domain
  setCrossDomain: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.GRID_SET_CROSS_DOMAIN, enabled),
  getCrossDomain: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.GRID_GET_CROSS_DOMAIN),
} as const

export type GridApi = typeof grid

contextBridge.exposeInMainWorld('grid', grid)

/* ------------------------------------------------------------------ */
/* Network monitor                                                     */
/* ------------------------------------------------------------------ */
const net = {
  // Push event listeners
  onNetUpdate: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.NET_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.NET_UPDATE, handler)
  },
  onNetTraffic: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.NET_TRAFFIC, handler)
    return () => ipcRenderer.removeListener(IPC.NET_TRAFFIC, handler)
  },
  onNetAlert: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.NET_ALERT, handler)
    return () => ipcRenderer.removeListener(IPC.NET_ALERT, handler)
  },
  onNetHealth: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.NET_HEALTH, handler)
    return () => ipcRenderer.removeListener(IPC.NET_HEALTH, handler)
  },
  onNetOutage: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.NET_OUTAGE, handler)
    return () => ipcRenderer.removeListener(IPC.NET_OUTAGE, handler)
  },
  onNetVPN: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.NET_VPN, handler)
    return () => ipcRenderer.removeListener(IPC.NET_VPN, handler)
  },
  onNetUserLocation: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.NET_USER_LOCATION, handler)
    return () => ipcRenderer.removeListener(IPC.NET_USER_LOCATION, handler)
  },
  onNetPreciseLocation: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.NET_PRECISE_LOCATION, handler)
    return () => ipcRenderer.removeListener(IPC.NET_PRECISE_LOCATION, handler)
  },
  onSpeedTestProgress: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on(IPC.SPEEDTEST_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.SPEEDTEST_PROGRESS, handler)
  },

  // VPN / GeoIP
  refreshNetVPN: (): Promise<void> =>
    ipcRenderer.invoke(IPC.NET_VPN_REFRESH),
  lookupNetGeoIP: (ip: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_GEOIP_LOOKUP, ip),
  clearNetGeoIPCache: (): Promise<void> =>
    ipcRenderer.invoke(IPC.NET_GEOIP_CLEAR_CACHE),

  // Alerts whitelist / snooze
  whitelistNetProcess: (name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.NET_ALERTS_WHITELIST, name),
  unwhitelistNetProcess: (name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.NET_ALERTS_UNWHITELIST, name),
  getNetWhitelist: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC.NET_ALERTS_GET_WHITELIST),
  snoozeNetAlerts: (minutes: number): Promise<void> =>
    ipcRenderer.invoke(IPC.NET_ALERTS_SNOOZE, minutes),
  isNetSnoozed: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.NET_ALERTS_IS_SNOOZED),

  // Health / outage
  getNetHealth: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_HEALTH_GET_CURRENT),
  getNetOutageHistory: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_HEALTH_GET_OUTAGE_HISTORY),
  getNetActiveOutage: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_HEALTH_GET_ACTIVE_OUTAGE),

  // Config
  saveNetConfig: (config: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke(IPC.NET_CONFIG_SAVE, config),
  loadNetConfig: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_CONFIG_LOAD),

  // Speed / DNS tests
  runSpeedTest: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_SPEEDTEST_RUN),
  runDNSTest: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_DNSTEST_RUN),
  runCustomDNSTest: (servers: string[]): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_DNSTEST_CUSTOM, servers),
  getDefaultDNSServers: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC.NET_DNSTEST_DEFAULTS),

  // Export / reports
  exportNetOutageHistory: (format: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_EXPORT_OUTAGE_HISTORY, format),
  exportNetConnectionLogs: (format: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_EXPORT_CONNECTION_LOGS, format),
  generateNetHealthReport: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_REPORT_GENERATE),

  // Notifications
  testNetEmail: (subject: string, message: string): Promise<void> =>
    ipcRenderer.invoke(IPC.NET_NOTIFICATION_TEST_EMAIL, subject, message),
  testNetSMS: (message: string): Promise<void> =>
    ipcRenderer.invoke(IPC.NET_NOTIFICATION_TEST_SMS, message),

  // Bandwidth
  getNetBandwidthSnapshot: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_BANDWIDTH_GET_SNAPSHOT),
  getNetBandwidthHistory: (processName: string, processId: number): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_BANDWIDTH_GET_HISTORY, processName, processId),
  getNetTopBandwidthUsers: (limit?: number): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_BANDWIDTH_GET_TOP_USERS, limit),
  getNetTotalBandwidth: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_BANDWIDTH_GET_TOTAL),

  // Quality
  getNetQualitySnapshot: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_QUALITY_GET_SNAPSHOT),
  getNetQualityHistory: (remoteAddress: string, remotePort: number): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_QUALITY_GET_HISTORY, remoteAddress, remotePort),
  getNetQualityHeatmap: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_QUALITY_GET_HEATMAP),

  // Traceroute / topology
  runNetTraceroute: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_TRACEROUTE_RUN),
  getNetTopology: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.NET_TOPOLOGY_GET),
} as const

export type NetApi = typeof net

contextBridge.exposeInMainWorld('net', net)

// ─── AI / Ollama / CLIP ───
const ai = {
  // Ollama
  health: () => ipcRenderer.invoke(IPC.AI_HEALTH),
  chat: (req: any) => ipcRenderer.invoke(IPC.AI_CHAT, req),
  chatStream: (req: any) => ipcRenderer.invoke(IPC.AI_CHAT_STREAM, req),
  vision: (req: any) => ipcRenderer.invoke(IPC.AI_VISION, req),
  embed: (req: any) => ipcRenderer.invoke(IPC.AI_EMBED, req),
  // CLIP
  clipHealth: () => ipcRenderer.invoke(IPC.AI_CLIP_HEALTH),
  clipEmbedText: (req: any) => ipcRenderer.invoke(IPC.AI_CLIP_EMBED_TEXT, req),
  clipEmbedImage: (req: any) => ipcRenderer.invoke(IPC.AI_CLIP_EMBED_IMAGE, req),
  clipSimilarity: (req: any) => ipcRenderer.invoke(IPC.AI_CLIP_SIMILARITY, req),
  clipSearch: (req: any) => ipcRenderer.invoke(IPC.AI_CLIP_SEARCH, req),
  // Streaming token listener
  onChatToken: (callback: (data: { token: string }) => void) => {
    const handler = (_e: IpcRendererEvent, data: { token: string }) => callback(data)
    ipcRenderer.on('ai:chat:token', handler)
    return () => ipcRenderer.off('ai:chat:token', handler)
  },
} as const

export type AiApi = typeof ai

contextBridge.exposeInMainWorld('ai', ai)
