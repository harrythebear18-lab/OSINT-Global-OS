/**
 * Satellite Imagery Service — NASA GIBS (Global Imagery Browse Services).
 *
 * GIBS serves stable XYZ tiles by zoom/x/y — no scene IDs, no STAC search,
 * no third-party tile proxies, no 404 spam. Built for exactly this use case.
 *
 * Provides multiple layers:
 *  - MODIS True Color (daily, 250m/pixel at max zoom)
 *  - MODIS Bands 7-2-1 (vegetation false color, daily)
 *  - VIIRS True Color (daily, 300m)
 *  - Landsat 8/9 (WELD, ~30m, periodic)
 *  - Sentinel-2 Mosaic (10m, periodic)
 *  - MODIS NDVI (16-day, vegetation index)
 *  - MODIS Land Surface Temp (daily, thermal)
 *  - GOES-East ABI True Color (15-min, CONUS)
 *  - Himawari-8 True Color (10-min, Asia-Pacific)
 *  - Meteosat-11 True Color (15-min, Europe/Africa)
 *
 * Endpoint: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/
 * Format:   {layer}/default/{time}/{TileMatrixSet}/{z}/{y}/{x}.{format}
 *
 * No API key required. No rate limits for reasonable use.
 */

import type { LngLat } from '@shared/types'

export interface GIBSLayer {
  /** Unique layer ID. */
  id: string
  /** Human-readable name. */
  name: string
  /** GIBS layer identifier (used in the URL). */
  gibsLayer: string
  /** Tile format: 'jpeg' or 'png'. */
  format: 'jpeg' | 'png'
  /** Tile matrix set: '250m', '500m', '1km', '2km', etc. */
  tileMatrixSet: string
  /** Max zoom level supported. */
  maxZoom: number
  /** Temporal resolution: how often new imagery is available. */
  temporalResolution: string
  /** Description shown in UI. */
  description: string
  /** Category for grouping in UI. */
  category: 'true-color' | 'false-color' | 'thermal' | 'vegetation' | 'geostationary'
  /** Default time (YYYY-MM-DD). If null, uses yesterday. */
  defaultDate?: string
}

export interface SentinelScene {
  /** Layer ID (kept for backward compat with UI). */
  id: string
  /** Tile XYZ URL template for MapLibre raster source. */
  tileUrl: string
  /** Date captured (ISO). */
  date: string
  /** Cloud cover percentage (0-100) — always 0 for GIBS (pre-composited). */
  cloudCover: number
  /** Scene bounding box [SW, NE] — global for GIBS. */
  bounds: [LngLat, LngLat]
  /** Thumbnail URL for preview. */
  thumbnail?: string
  /** If true, tileUrl is a single image (not a tile template). Always false for GIBS. */
  isImageOverlay?: boolean
}

export interface SentinelResponse {
  /** Available GIBS layers. */
  layers: GIBSLayer[]
  /** Selected layer (first by default). */
  best?: SentinelScene
  /** Kept for backward compat — maps to layers. */
  scenes: SentinelScene[]
}

export interface SentinelRequest {
  bounds: [LngLat, LngLat]
  maxCloudCover?: number
  limit?: number
  /** Optional: specific GIBS layer ID to use. */
  layerId?: string
  /** Optional: specific date (YYYY-MM-DD). Defaults to yesterday. */
  date?: string
}

/**
 * All available GIBS layers.
 */
export const GIBS_LAYERS: GIBSLayer[] = [
  {
    id: 'modis-true-color',
    name: 'MODIS True Color',
    gibsLayer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    format: 'jpeg',
    tileMatrixSet: '250m',
    maxZoom: 9,
    temporalResolution: 'Daily',
    description: 'Terra MODIS true color — daily, 250m resolution',
    category: 'true-color',
  },
  {
    id: 'modis-bands-721',
    name: 'MODIS 7-2-1 (Vegetation)',
    gibsLayer: 'MODIS_Terra_CorrectedReflectance_Bands721',
    format: 'jpeg',
    tileMatrixSet: '250m',
    maxZoom: 9,
    temporalResolution: 'Daily',
    description: 'False color — vegetation appears green, water black, burn scars red',
    category: 'false-color',
  },
  {
    id: 'viirs-true-color',
    name: 'VIIRS True Color',
    gibsLayer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    format: 'jpeg',
    tileMatrixSet: '250m',
    maxZoom: 9,
    temporalResolution: 'Daily',
    description: 'Suomi NPP VIIRS true color — daily, 300m resolution',
    category: 'true-color',
  },
  {
    id: 'viirs-dnb',
    name: 'VIIRS Day/Night',
    gibsLayer: 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance',
    format: 'png',
    tileMatrixSet: '500m',
    maxZoom: 8,
    temporalResolution: 'Daily',
    description: 'Nighttime lights — useful for detecting remote activity',
    category: 'true-color',
  },
  {
    id: 'landsat-weld',
    name: 'Landsat WELD',
    gibsLayer: 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual',
    format: 'jpeg',
    tileMatrixSet: '30m',
    maxZoom: 12,
    temporalResolution: 'Annual',
    description: 'Landsat annual mosaic — 30m resolution, cloud-free composite',
    category: 'true-color',
  },
  {
    id: 'sentinel-2-mosaic',
    name: 'Sentinel-2 Mosaic',
    gibsLayer: 'Sentinel_2A_20m_TrueColor',
    format: 'jpeg',
    tileMatrixSet: '20m',
    maxZoom: 11,
    temporalResolution: 'Periodic',
    description: 'Sentinel-2 true color mosaic — 20m resolution',
    category: 'true-color',
  },
  {
    id: 'modis-ndvi',
    name: 'MODIS NDVI (Vegetation)',
    gibsLayer: 'MODIS_Terra_NDVI_16Day',
    format: 'png',
    tileMatrixSet: '250m',
    maxZoom: 9,
    temporalResolution: '16-day',
    description: 'Vegetation index — dense growth is dark green, sparse is tan',
    category: 'vegetation',
  },
  {
    id: 'modis-lst-day',
    name: 'Land Surface Temp (Day)',
    gibsLayer: 'MODIS_Aqua_Land_Surface_Temp_Day',
    format: 'png',
    tileMatrixSet: '1km',
    maxZoom: 8,
    temporalResolution: 'Daily',
    description: 'Aqua MODIS daytime land surface temperature — thermal',
    category: 'thermal',
  },
  {
    id: 'modis-lst-night',
    name: 'Land Surface Temp (Night)',
    gibsLayer: 'MODIS_Aqua_Land_Surface_Temp_Night',
    format: 'png',
    tileMatrixSet: '1km',
    maxZoom: 8,
    temporalResolution: 'Daily',
    description: 'Aqua MODIS nighttime land surface temperature — thermal',
    category: 'thermal',
  },
  {
    id: 'goes-east-true-color',
    name: 'GOES-East True Color',
    gibsLayer: 'GOES-East_ABI_Band2_Red_Visible_1km',
    format: 'png',
    tileMatrixSet: '1km',
    maxZoom: 8,
    temporalResolution: '15-min',
    description: 'GOES-East ABI red visible — 15-min refresh, CONUS + Atlantic',
    category: 'geostationary',
  },
  {
    id: 'himawari-true-color',
    name: 'Himawari-8 True Color',
    gibsLayer: 'Himawari_AHI_Red_Visible_1km',
    format: 'png',
    tileMatrixSet: '1km',
    maxZoom: 8,
    temporalResolution: '10-min',
    description: 'Himawari-8 AHI red visible — 10-min refresh, Asia-Pacific',
    category: 'geostationary',
  },
  {
    id: 'meteosat-true-color',
    name: 'Meteosat-11 True Color',
    gibsLayer: 'Meteosat-11_SEVIRI_FES_HRV',
    format: 'png',
    tileMatrixSet: '3km',
    maxZoom: 7,
    temporalResolution: '15-min',
    description: 'Meteosat-11 SEVIRI high-res visible — 15-min, Europe/Africa',
    category: 'geostationary',
  },
]

/**
 * Build a GIBS tile URL template for MapLibre.
 * Format: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tileMatrixSet}/{z}/{y}/{x}.{format}
 *
 * Note: GIBS uses {y} (TMS) not {y} (XYZ) — but MapLibre's raster source
 * uses XYZ scheme. GIBS WMTS endpoint serves XYZ tiles directly (y increases
 * northward), so we can use {y} directly.
 */
function buildGibsTileUrl(layer: GIBSLayer, date: string): string {
  const base = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
  return `${base}/${layer.gibsLayer}/default/${date}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.format}`
}

/**
 * Get yesterday's date in YYYY-MM-DD format (GIBS typically has a 1-day delay).
 */
function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

/**
 * Search for satellite imagery — returns available GIBS layers.
 *
 * Unlike the old STAC approach, this is instant (no network request needed).
 * The tile URLs are constructed from the layer definition + date.
 * The actual tile fetching happens when MapLibre loads the raster source.
 *
 * The `bounds` parameter is kept for interface compatibility but GIBS
 * serves global tiles, so it's not used for filtering.
 */
export async function searchSentinelScenes(
  bounds: [LngLat, LngLat],
  maxCloudCover: number = 20,
  limit: number = 5,
  layerId?: string,
  date?: string,
): Promise<SentinelResponse> {
  const [sw, ne] = bounds
  const targetDate = date ?? yesterdayISO()

  // Find the requested layer, or default to MODIS True Color
  const layer = layerId
    ? GIBS_LAYERS.find((l) => l.id === layerId) ?? GIBS_LAYERS[0]
    : GIBS_LAYERS[0]

  const tileUrl = buildGibsTileUrl(layer, targetDate)

  const scene: SentinelScene = {
    id: layer.id,
    tileUrl,
    date: targetDate,
    cloudCover: 0, // GIBS imagery is pre-composited; cloud cover not applicable
    bounds: [
      { lng: sw.lng, lat: sw.lat },
      { lng: ne.lng, lat: ne.lat },
    ],
    isImageOverlay: false,
  }

  // Build scenes list for backward compat (UI expects scenes[].best)
  const scenes: SentinelScene[] = GIBS_LAYERS.slice(0, limit).map((l) => ({
    id: l.id,
    tileUrl: buildGibsTileUrl(l, targetDate),
    date: targetDate,
    cloudCover: 0,
    bounds: [
      { lng: sw.lng, lat: sw.lat },
      { lng: ne.lng, lat: ne.lat },
    ],
    isImageOverlay: false,
  }))

  return {
    layers: GIBS_LAYERS,
    best: scene,
    scenes,
  }
}
