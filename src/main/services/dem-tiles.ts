/**
 * SRTM DEM tile resolver + fetcher with on-disk cache.
 *
 * Uses AWS Open Data SRTM tiles (free, no API key).
 * Tiles are 1x1 degree, 3601x3601 pixels at 1 arc-second (~30m) resolution.
 * URL pattern: https://s3.amazonaws.com/elevation-tiles-prod/srtm/{lat}{lon}/
 *              {lat}{lon}_SRTMGL1.tif
 *
 * For simplicity and reliability, we use the Mapzen / Nextzen terrain tiles
 * which are served as standard Web Mercator tile pyramids (z/x/y) and are
 * also free on AWS:
 *   https://s3.amazonaws.com/elevation-tiles-prod/skadi/tiles/{z}/{x}/{y}.tif
 *
 * Actually, the most reliable free DEM tile service is the AWS terrain tiles
 * in Web Mercator tile pyramid format:
 *   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *
 * These are PNG-encoded elevation maps (Terrarium encoding):
 *   elevation = (red * 256 + green + blue / 256) - 32768
 *
 * This is the simplest to fetch + decode without a GeoTIFF parser.
 * Resolution: z=0 is global, z=15 is ~1m. We use z=12-13 for good detail.
 */

import { join, dirname } from 'path'
import { homedir } from 'os'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs'
import { pipeline } from 'stream/promises'

const CACHE_DIR = join(homedir(), '.terrain-scout', 'cache', 'dem')

// Terrarium tiles on AWS — free, no key
const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`

const DEFAULT_ZOOM = 12

export interface DemTileData {
  /** Elevation in meters, row-major [y][x]. null = no data / sea level sentinel. */
  grid: (number | null)[][]
  width: number
  height: number
  /** Tile X index. */
  x: number
  /** Tile Y index. */
  y: number
  /** Zoom level. */
  z: number
  /** Bounding box [SW, NE] in WGS84. */
  bounds: [{ lng: number; lat: number }, { lng: number; lat: number }]
}

/** Ensure cache directory exists. */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

/** Local file path for a cached tile. */
function tilePath(z: number, x: number, y: number): string {
  return join(CACHE_DIR, `${z}`, `${x}`, `${y}.png`)
}

/**
 * Fetch a Terrarium DEM tile, using disk cache if available.
 * Returns the raw PNG buffer.
 */
async function fetchTilePng(z: number, x: number, y: number): Promise<Buffer | null> {
  ensureCacheDir()
  const local = tilePath(z, x, y)

  // Cache hit
  if (existsSync(local)) {
    return readFileSync(local)
  }

  // Fetch from AWS
  const url = TILE_URL(z, x, y)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      // 404 = no tile at this location (ocean / out of range)
      if (res.status === 404) return null
      throw new Error(`DEM tile fetch failed: ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())

    // Write to cache
    mkdirSync(dirname(local), { recursive: true })
    const ws = createWriteStream(local)
    ws.write(buf)
    ws.end()
    await new Promise<void>((resolve) => ws.on('finish', () => resolve()))

    return buf
  } catch (e) {
    console.error(`[dem] Failed to fetch tile ${z}/${x}/${y}:`, e)
    return null
  }
}

/**
 * Decode a Terrarium PNG into an elevation grid.
 * Terrarium encoding: elevation = (R * 256 + G + B / 256) - 32768
 *
 * We use the `pngjs` library for PNG decoding. It's pure JS, no native deps.
 */
async function decodeTerrariumPng(pngBuf: Buffer): Promise<number[][]> {
  // Dynamic import to avoid bundling issues in main process
  const { PNG } = await import('pngjs')
  const png = PNG.sync.read(pngBuf)
  const { width, height, data } = png

  const grid: number[][] = []
  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const elev = r * 256 + g + b / 256 - 32768
      row.push(elev)
    }
    grid.push(row)
  }
  return grid
}

/**
 * Convert Web Mercator tile indices to WGS84 bounding box.
 */
function tileToBounds(z: number, x: number, y: number): [{ lng: number; lat: number }, { lng: number; lat: number }] {
  const n = Math.pow(2, z)
  const lngWest = (x / n) * 360 - 180
  const lngEast = ((x + 1) / n) * 360 - 180
  const latNorth = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  const latSouth = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI
  return [
    { lng: lngWest, lat: latSouth },
    { lng: lngEast, lat: latNorth },
  ]
}

/**
 * Load a DEM tile at the given Web Mercator tile indices.
 * Returns null if the tile doesn't exist (ocean / out of range).
 */
export async function loadDemTile(z: number, x: number, y: number): Promise<DemTileData | null> {
  const pngBuf = await fetchTilePng(z, x, y)
  if (!pngBuf) return null

  const grid = await decodeTerrariumPng(pngBuf)
  const bounds = tileToBounds(z, x, y)

  return {
    grid,
    width: grid[0]?.length ?? 0,
    height: grid.length,
    x,
    y,
    z,
    bounds,
  }
}

/**
 * Convert WGS84 lng/lat to Web Mercator tile indices at a given zoom.
 */
export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = Math.pow(2, z)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x, y }
}

/**
 * Convert WGS84 lng/lat to pixel coordinates within a specific tile.
 * Returns fractional pixel {px, py} where 0,0 is top-left of the tile.
 */
export function lngLatToTilePixel(
  lng: number,
  lat: number,
  tileZ: number,
  tileX: number,
  tileY: number,
  tileSize: number,
): { px: number; py: number } {
  const n = Math.pow(2, tileZ)
  const px = ((lng + 180) / 360) * n * tileSize - tileX * tileSize
  const latRad = (lat * Math.PI) / 180
  const py =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * tileSize -
    tileY * tileSize
  return { px: Math.floor(px), py: Math.floor(py) }
}

export { DEFAULT_ZOOM, CACHE_DIR }
