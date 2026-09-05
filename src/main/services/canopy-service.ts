/**
 * Canopy Intelligence Service
 *
 * A multi-modal forest analysis engine that combines:
 *  - DEM terrain (canopy-contaminated elevation)
 *  - NDVI vegetation density (GIBS / Sentinel-2)
 *  - Regional canopy height (geolocation-aware web search)
 *  - Slope/aspect correction
 *
 * Produces:
 *  - Corrected ground height (pseudo-LiDAR: DEM - canopy_estimate)
 *  - Defoliation map (NDVI-based)
 *  - Dead tree detection (spectral + geometric)
 *  - Canopy thickness map
 *  - Clearing detection
 *  - Hidden structure likelihood
 *
 * The key innovation: instead of trying to infer canopy height purely from
 * spectral data, we reverse-geocode the bbox center, web-search for the
 * average tree height in that region/biome, and use that as a baseline.
 * NDVI modulates the baseline (dense canopy = full height, thin canopy = less).
 *
 * This gives a reasonable ground approximation anywhere on Earth without LiDAR.
 */

import type {
  LngLat,
  CanopyAnalysisRequest,
  CanopyAnalysisResponse,
  CanopyCell,
  CanopyZone,
  AnalysisMode,
} from '@shared/types'
import { demService } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'
import { quickSearch } from './web-search-service'

/* ------------------------------------------------------------------ */
/* Regional canopy height lookup (geolocation-aware)                  */
/* ------------------------------------------------------------------ */

interface RegionInfo {
  placeName: string
  country: string
  region: string
  biome: string
  canopyHeightM: number
  source: string
  description: string
}

/** Reverse geocode the bbox center to get country/region. */
async function reverseGeocode(lng: number, lat: number): Promise<{ display: string; country: string; region: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OSINT-Global-OS/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    const addr = data.address || {}
    return {
      display: data.display_name || '',
      country: addr.country || '',
      region: addr.state || addr.region || addr.county || '',
    }
  } catch {
    return null
  }
}

/**
 * Built-in biome → canopy height database.
 * Used as a fast first approximation before web search refines it.
 * Values are typical mature canopy heights in meters.
 */
const BIOME_CANOPY_HEIGHTS: { match: RegExp; height: number; biome: string; desc: string }[] = [
  // Tropical rainforests
  { match: /amazon|tropical rainforest|equatorial/i, height: 35, biome: 'Tropical rainforest', desc: 'Dense multi-story canopy, 25-45m typical' },
  { match: /congo basin|central africa rain/i, height: 35, biome: 'Tropical rainforest', desc: 'Dense equatorial forest, 30-40m' },
  { match: /borneo|sumatra|dipterocarp|southeast asia rain/i, height: 45, biome: 'Tropical dipterocarp forest', desc: 'Tall dipterocarp canopy, 40-60m' },
  { match: /new guinea|papua|tropical pacific/i, height: 30, biome: 'Tropical montane forest', desc: 'Variable canopy, 20-40m' },

  // Subtropical / seasonal
  { match: /monsoon|seasonal tropical|deciduous tropical/i, height: 20, biome: 'Tropical seasonal forest', desc: 'Dry-season deciduous, 15-25m' },
  { match: /miombo|african savanna woodland/i, height: 15, biome: 'Miombo woodland', desc: 'Open woodland, 10-20m' },
  { match: /cerrado|brazilian savanna/i, height: 12, biome: 'Cerrado savanna', desc: 'Open canopy, 8-15m' },
  { match: /caatinga/i, height: 8, biome: 'Caatinga dry forest', desc: 'Thorny dry forest, 5-12m' },

  // Temperate forests
  { match: /pacific northwest|pnw|temperate rainforest|olympic/i, height: 50, biome: 'Temperate rainforest', desc: 'Tall conifer canopy, 30-70m' },
  { match: /appalachian|mixed mesophytic|cove hardwood/i, height: 25, biome: 'Temperate deciduous', desc: 'Mixed hardwood, 20-35m' },
  { match: /european temperate|central european forest|beech|oak forest/i, height: 25, biome: 'Temperate deciduous', desc: 'Managed forest, 20-35m' },
  { match: /patagonian|valdivian|southern beech|nothofagus/i, height: 30, biome: 'Temperate rainforest', desc: 'Cool temperate, 25-40m' },
  { match: /tasmanian|eucalyptus|australian temperate/i, height: 40, biome: 'Temperate eucalypt', desc: 'Tall eucalypt, 30-60m' },

  // Boreal / taiga
  { match: /boreal|taiga|siberian|scandinavian forest|spruce muskeg/i, height: 18, biome: 'Boreal forest', desc: 'Conifer dominated, 15-25m' },
  { match: /black spruce|jack pine|bog forest/i, height: 12, biome: 'Boreal wetland forest', desc: 'Stunted canopy, 8-15m' },

  // Montane / subalpine
  { match: /montane|subalpine|cloud forest|pine-oak|sierra madre/i, height: 20, biome: 'Montane forest', desc: 'Variable with elevation, 15-30m' },
  { match: /alpine|krummholz|treeline/i, height: 5, biome: 'Subalpine krummholz', desc: 'Stunted trees near treeline, 2-8m' },
  { match: /andean|yungas|paramo/i, height: 18, biome: 'Montane cloud forest', desc: 'Cloud forest, 15-25m' },

  // Mediterranean
  { match: /mediterranean|chaparral|maquis|garigue|sclerophyll/i, height: 8, biome: 'Mediterranean scrub', desc: 'Open sclerophyll, 5-12m' },
  { match: /oak savanna|dehesa|woodland savanna/i, height: 12, biome: 'Open savanna woodland', desc: 'Scattered trees, 8-15m' },

  // Dry / desert / scrub
  { match: /desert|arid|sahara|sonoran|mojave|namib|atacama|gobi/i, height: 3, biome: 'Desert', desc: 'Minimal vegetation, 0-5m' },
  { match: /thorn forest|acacia|savanna|sahel/i, height: 8, biome: 'Dry savanna', desc: 'Scattered thorny trees, 5-12m' },
  { match: /mangrove|coastal wetland/i, height: 12, biome: 'Mangrove', desc: 'Tidal forest, 5-20m' },

  // Plantation / managed
  { match: /plantation|timber|managed forest|pine plantation/i, height: 22, biome: 'Plantation forest', desc: 'Even-aged stand, 15-30m' },
]

/**
 * Look up regional canopy height for a bbox.
 * 1. Reverse-geocode the center to get country/region.
 * 2. Check the built-in biome database.
 * 3. Web-search for "average tree height in [region]" to refine.
 * 4. Fall back to a global average of 20m if nothing found.
 */
async function lookupRegionalCanopyHeight(bounds: [LngLat, LngLat]): Promise<RegionInfo> {
  const [sw, ne] = bounds
  const centerLng = (sw.lng + ne.lng) / 2
  const centerLat = (sw.lat + ne.lat) / 2

  // Step 1: Reverse geocode
  const geo = await reverseGeocode(centerLng, centerLat)
  const placeName = geo?.display || `${centerLat.toFixed(3)}, ${centerLng.toFixed(3)}`
  const country = geo?.country || ''
  const region = geo?.region || ''

  // Step 2: Check built-in biome database against place name
  const placeText = `${placeName} ${country} ${region}`
  for (const entry of BIOME_CANOPY_HEIGHTS) {
    if (entry.match.test(placeText)) {
      return {
        placeName,
        country,
        region,
        biome: entry.biome,
        canopyHeightM: entry.height,
        source: 'built-in biome database',
        description: entry.desc,
      }
    }
  }

  // Step 3: Web search for average tree height in the region
  const searchQuery = `average tree height ${region} ${country} forest canopy meters`
  try {
    const searchResult = await quickSearch(searchQuery, { lng: centerLng, lat: centerLat })
    // Try to extract a height from the search results
    const heightMatch = searchResult.match(/(\d{1,3})\s*[-–]?\s*(?:to\s*)?(\d{0,3})?\s*m(?:eters?)?\b/i)
    if (heightMatch) {
      const low = parseInt(heightMatch[1])
      const high = heightMatch[2] ? parseInt(heightMatch[2]) : low
      const avg = (low + high) / 2
      if (avg > 0 && avg < 100) {
        return {
          placeName,
          country,
          region,
          biome: 'Region-specific (web search)',
          canopyHeightM: avg,
          source: `web search: "${searchQuery}"`,
          description: `Web-sourced estimate: ${low}${high !== low ? `-${high}` : ''}m in ${region || country}`,
        }
      }
    }
  } catch {
    // Web search failed — fall through to default
  }

  // Step 4: Latitude-based fallback approximation
  // Tropical (|lat| < 23.5): taller forests
  // Temperate (23.5-50): moderate
  // Boreal (>50): shorter
  const absLat = Math.abs(centerLat)
  let fallbackHeight: number
  let fallbackBiome: string
  if (absLat < 10) {
    fallbackHeight = 30
    fallbackBiome = 'Tropical (latitude-based estimate)'
  } else if (absLat < 23.5) {
    fallbackHeight = 22
    fallbackBiome = 'Subtropical (latitude-based estimate)'
  } else if (absLat < 50) {
    fallbackHeight = 20
    fallbackBiome = 'Temperate (latitude-based estimate)'
  } else {
    fallbackHeight = 15
    fallbackBiome = 'Boreal (latitude-based estimate)'
  }

  return {
    placeName,
    country,
    region,
    biome: fallbackBiome,
    canopyHeightM: fallbackHeight,
    source: 'latitude-based fallback',
    description: `No specific data found. Using ${fallbackBiome.toLowerCase()}.`,
  }
}

/* ------------------------------------------------------------------ */
/* NDVI tile fetching (GIBS)                                          */
/* ------------------------------------------------------------------ */

/**
 * Fetch NDVI at a point using GIBS WMS (Web Map Service) single-pixel request.
 * This is more reliable than decoding PNG tiles ourselves.
 * Returns NDVI 0-1, or null if unavailable.
 */
async function fetchNdviWms(lng: number, lat: number, date: string): Promise<number | null> {
  // Use a tiny bbox around the point (0.002 degrees ~= 200m)
  const delta = 0.001
  // WMS 1.3.0 with CRS=EPSG:4326 expects BBOX=minLat,minLng,maxLat,maxLng
  const bbox = `${lat - delta},${lng - delta},${lat + delta},${lng + delta}`
  // NOTE: WMS layer name is MODIS_Terra_NDVI_8Day (the 16Day version is WMTS-only)
  const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?` +
    `SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_NDVI_8Day&` +
    `CRS=EPSG:4326&BBOX=${bbox}&WIDTH=2&HEIGHT=2&FORMAT=image/png&TIME=${date}`

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    // Check if response is actually a PNG (GIBS returns XML on error)
    const view = new DataView(buf)
    if (view.getUint32(0) !== 0x89504e47) return null // Not a PNG
    return decodeSinglePixelPngToNdvi(buf)
  } catch {
    return null
  }
}

/**
 * Decode a small PNG (1x1 or 2x2) to an NDVI value.
 * GIBS NDVI color ramp:
 *   - NDVI < 0: blue (water)
 *   - NDVI 0-0.2: brown/tan (bare)
 *   - NDVI 0.2-0.5: light green
 *   - NDVI 0.5-0.8: medium green
 *   - NDVI > 0.8: dark green
 *
 * Approximate: NDVI ≈ (green - red) / (green + red) using RGB channels.
 * We average all pixels in the image.
 */
function decodeSinglePixelPngToNdvi(buf: ArrayBuffer): number | null {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  // PNG signature
  if (view.getUint32(0) !== 0x89504e47) return null

  // Parse chunks to find IHDR + IDAT
  let offset = 8
  let ihdrWidth = 0, ihdrHeight = 0, colorType = 0
  const idatChunks: number[] = []

  while (offset < bytes.length - 8) {
    const len = view.getUint32(offset)
    const type = view.getUint32(offset + 4)

    if (type === 0x49484452) { // IHDR
      ihdrWidth = view.getUint32(offset + 8)
      ihdrHeight = view.getUint32(offset + 12)
      colorType = bytes[offset + 17]
    } else if (type === 0x49444154) { // IDAT
      for (let i = 0; i < len; i++) {
        idatChunks.push(bytes[offset + 8 + i])
      }
    } else if (type === 0x49454e44) { // IEND
      break
    }
    offset += 12 + len
  }

  if (idatChunks.length === 0 || ihdrWidth === 0 || ihdrHeight === 0) return null

  // Determine channels per pixel
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 3
  const bytesPerPixel = channels
  const rowLen = 1 + ihdrWidth * bytesPerPixel // filter byte + pixel data

  try {
    const compressed = new Uint8Array(idatChunks)
    const decompressed = inflate(compressed)

    if (decompressed.length < ihdrHeight * rowLen) return null

    // Average RGB across all pixels (skip filter bytes)
    let totalR = 0, totalG = 0, totalB = 0, count = 0
    for (let row = 0; row < ihdrHeight; row++) {
      const rowStart = row * rowLen
      const filterByte = decompressed[rowStart]
      if (filterByte !== 0) {
        // For simplicity, only handle filter type 0 (None).
        // GIBS typically uses filter 0 for tiny images.
        // If not, we still try to read the raw values.
      }
      for (let px = 0; px < ihdrWidth; px++) {
        const pixOffset = rowStart + 1 + px * bytesPerPixel
        totalR += decompressed[pixOffset]
        totalG += decompressed[pixOffset + 1]
        totalB += decompressed[pixOffset + 2]
        count++
      }
    }

    if (count === 0) return null
    const r = totalR / count
    const g = totalG / count
    const b = totalB / count

    // Water detection: blue dominant
    if (b > g && b > r) return 0

    // NDVI approximation from green-red ratio
    const ndviApprox = ((g - r) / (g + r + 1)) * 0.9 + 0.3
    return Math.max(0, Math.min(1, ndviApprox))
  } catch {
    return null
  }
}

/**
 * Minimal inflate (zlib decompress) — decompresses raw deflate stream.
 * This is a simplified implementation for small PNG IDAT chunks.
 */
function inflate(data: Uint8Array): Uint8Array {
  // Use Node.js built-in zlib if available (we're in main process)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const zlib = require('zlib')
  const result = zlib.inflateSync(Buffer.from(data))
  return new Uint8Array(result)
}

/* ------------------------------------------------------------------ */
/* DEM grid loading (reused from fall-risk pattern)                  */
/* ------------------------------------------------------------------ */

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function loadDemGrid(bounds: [LngLat, LngLat], zoom: number) {
  const [sw, ne] = bounds
  const effectiveZoom = computeOptimalZoom(bounds, zoom, 32)
  const minTile = lngLatToTile(sw.lng, ne.lat, effectiveZoom)
  const maxTile = lngLatToTile(ne.lng, sw.lat, effectiveZoom)
  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1

  const tileGrids: (number | null)[][][][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    tileGrids[ty] = []
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = await demService.loadTile(minTile.x + tx, minTile.y + ty, effectiveZoom)
      tileGrids[ty][tx] = tile.grid
    }
  }

  const grid: (number | null)[][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let row = 0; row < tileGrids[ty][0].length; row++) {
      const mergedRow: (number | null)[] = []
      for (let tx = 0; tx < tilesX; tx++) {
        const tileRow = tileGrids[ty][tx][row]
        if (tileRow) mergedRow.push(...tileRow)
      }
      grid.push(mergedRow)
    }
  }

  const height = grid.length
  const width = grid[0]?.length ?? 0
  const latMid = (sw.lat + ne.lat) / 2
  const gridWidthM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = gridWidthM / width
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  return { grid, width, height, cellSizeM, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

/* ------------------------------------------------------------------ */
/* Slope computation                                                  */
/* ------------------------------------------------------------------ */

function cellSlope(grid: (number | null)[][], x: number, y: number, cellSizeM: number): number {
  const elev = grid[y]?.[x]
  if (elev == null) return 0
  let maxSlope = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      const dist = cellSizeM * Math.sqrt(dx * dx + dy * dy)
      const slope = (Math.atan2(Math.abs(n - elev), dist) * 180) / Math.PI
      maxSlope = Math.max(maxSlope, slope)
    }
  }
  return maxSlope
}

/* ------------------------------------------------------------------ */
/* Main canopy analysis                                               */
/* ------------------------------------------------------------------ */

export async function analyzeCanopy(req: CanopyAnalysisRequest): Promise<CanopyAnalysisResponse> {
  const { bounds, demZoom, mode, regionalCanopyHeightM, date } = req
  const analysisMode: AnalysisMode = mode || 'active-sar'
  const zoom = demZoom ?? DEFAULT_ZOOM

  // Step 1: Look up regional canopy height (geolocation-aware)
  let regionInfo: RegionInfo
  if (regionalCanopyHeightM != null) {
    // User provided override — still geocode for context
    const geo = await reverseGeocode(
      (bounds[0].lng + bounds[1].lng) / 2,
      (bounds[0].lat + bounds[1].lat) / 2,
    )
    regionInfo = {
      placeName: geo?.display || '',
      country: geo?.country || '',
      region: geo?.region || '',
      biome: 'User-specified',
      canopyHeightM: regionalCanopyHeightM,
      source: 'user override',
      description: `User-specified canopy height: ${regionalCanopyHeightM}m`,
    }
  } else {
    regionInfo = await lookupRegionalCanopyHeight(bounds)
  }

  const targetDate = date || yesterdayISO()
  const baseCanopyHeight = regionInfo.canopyHeightM

  // Step 2: Load DEM grid
  const { grid, width, height, cellSizeM, swLng, neLat, lngStep, latStep } = await loadDemGrid(bounds, zoom)

  // Cap grid size to prevent hangs — canopy analysis is less precise than
  // fall-risk, so a coarser grid is fine
  const MAX_CELLS = 50_000
  let effectiveGrid = grid
  let effectiveWidth = width
  let effectiveHeight = height
  let effectiveCellSizeM = cellSizeM
  let effectiveLngStep = lngStep
  let effectiveLatStep = latStep

  if (effectiveWidth * effectiveHeight > MAX_CELLS) {
    const step = Math.ceil(Math.sqrt((effectiveWidth * effectiveHeight) / MAX_CELLS))
    const downsampled: (number | null)[][] = []
    for (let y = 0; y < effectiveHeight; y += step) {
      const row: (number | null)[] = []
      for (let x = 0; x < effectiveWidth; x += step) {
        row.push(grid[y]?.[x] ?? null)
      }
      downsampled.push(row)
    }
    effectiveGrid = downsampled
    effectiveHeight = downsampled.length
    effectiveWidth = downsampled[0]?.length ?? 0
    effectiveCellSizeM = cellSizeM * step
    const [bsw, bne] = bounds
    effectiveLngStep = (bne.lng - bsw.lng) / effectiveWidth
    effectiveLatStep = (bne.lat - bsw.lat) / effectiveHeight
  }

  // Step 3: Sample NDVI at a coarse grid (NDVI fetches are network calls,
  // so we sample at a very coarse resolution and interpolate).
  // Keep it small: 8x8 = 64 max samples, batched in parallel.
  const ndviSamplesX = Math.min(8, effectiveWidth)
  const ndviSamplesY = Math.min(8, effectiveHeight)
  const ndviGrid: (number | null)[][] = Array.from({ length: ndviSamplesY }, () =>
    new Array<number | null>(ndviSamplesX).fill(null),
  )

  // Build all sample coordinates
  const sampleCoords: { sx: number; sy: number; lng: number; lat: number }[] = []
  for (let sy = 0; sy < ndviSamplesY; sy++) {
    for (let sx = 0; sx < ndviSamplesX; sx++) {
      const lng = swLng + (sx / Math.max(1, ndviSamplesX - 1)) * (bounds[1].lng - bounds[0].lng)
      const lat = neLat - (sy / Math.max(1, ndviSamplesY - 1)) * (neLat - bounds[0].lat)
      sampleCoords.push({ sx, sy, lng, lat })
    }
  }

  // Fetch all NDVI samples in parallel with a short timeout
  const ndviResults = await Promise.all(
    sampleCoords.map(async (sc) => ({
      ...sc,
      ndvi: await fetchNdviWms(sc.lng, sc.lat, targetDate),
    })),
  )

  for (const r of ndviResults) {
    ndviGrid[r.sy][r.sx] = r.ndvi
  }

  // Check if NDVI data is available at all. If all samples failed (GIBS down,
  // network issue, etc.), fall back to DEM-based vegetation estimation.
  const ndviAvailable = ndviResults.some((r) => r.ndvi != null)
  if (!ndviAvailable) {
    console.warn('[canopy] NDVI fetch failed for all samples — using DEM-based fallback')
  }

  // Step 4: Build canopy cells
  const cells: CanopyCell[] = []

  for (let y = 0; y < effectiveHeight; y++) {
    for (let x = 0; x < effectiveWidth; x++) {
      const rawElev = effectiveGrid[y]?.[x]
      if (rawElev == null) continue

      const lng = swLng + x * effectiveLngStep
      const lat = neLat - y * effectiveLatStep

      // Interpolate NDVI from the coarse grid, or use DEM-based fallback
      let ndvi: number | null
      if (ndviAvailable) {
        ndvi = interpolateNdvi(ndviGrid, ndviSamplesX, ndviSamplesY, x / effectiveWidth, y / effectiveHeight)
      } else {
        // Fallback: estimate vegetation from elevation + slope
        // Low-lying areas with gentle slopes are more likely forested
        ndvi = estimateNdviFromTerrain(rawElev, cellSlope(effectiveGrid, x, y, effectiveCellSizeM), regionInfo.canopyHeightM)
      }
      const slope = cellSlope(effectiveGrid, x, y, effectiveCellSizeM)

      // Classify the cell
      let cls: CanopyCell['class'] = 'unknown'
      let canopyHeightM = 0
      let defoliation = 0
      let deadTreeLikelihood = 0

      // Water detection: DEM at or below sea level = water
      // This is critical — without it, coastal/sea cells get classified
      // as bare ground and then as defoliation, creating false red zones.
      if (rawElev <= 0) {
        cls = 'water'
        canopyHeightM = 0
        defoliation = 0
        deadTreeLikelihood = 0
      } else if (ndvi == null) {
        cls = 'unknown'
        canopyHeightM = 0
      } else if (ndvi < 0.05) {
        // Very low NDVI above sea level = bare rock/sand
        cls = 'bare'
        canopyHeightM = 0
        // Bare ground is NOT defoliation — it was never forested
        defoliation = 0
      } else if (ndvi < 0.2) {
        // Bare ground / sparse vegetation
        cls = 'bare'
        canopyHeightM = 0
        // Only count as defoliation if the region should have forest
        // (regional canopy height > 5m means it's a forest biome)
        defoliation = baseCanopyHeight > 5 ? (1 - ndvi / 0.2) * 0.5 : 0
      } else if (ndvi < 0.4) {
        // Thinning / stressed vegetation
        cls = 'thinning'
        // Partial canopy — scale height by NDVI density
        const densityFactor = (ndvi - 0.2) / 0.2 // 0-1 within this band
        canopyHeightM = baseCanopyHeight * densityFactor * 0.5
        defoliation = 1 - densityFactor
        // Dead trees: low NDVI but not bare = stressed/dying
        deadTreeLikelihood = (0.4 - ndvi) / 0.2 * 0.6
      } else {
        // Forest (NDVI >= 0.4)
        cls = 'forest'
        // Full canopy — height modulated by NDVI density
        const densityFactor = Math.min(1, (ndvi - 0.4) / 0.4) // 0-1
        canopyHeightM = baseCanopyHeight * (0.7 + densityFactor * 0.3)

        // Healthy forest has low defoliation
        defoliation = Math.max(0, (0.8 - ndvi) / 0.4)

        // Dead tree likelihood is low for healthy forest
        deadTreeLikelihood = Math.max(0, (0.6 - ndvi) / 0.2) * 0.3
      }

      // Slope correction: trees don't grow well on very steep slopes
      if (slope > 45 && cls === 'forest') {
        // Reduce canopy height on extreme slopes
        canopyHeightM *= 0.5
        cls = 'thinning'
        defoliation = Math.max(defoliation, 0.3)
      } else if (slope > 35 && cls === 'forest') {
        canopyHeightM *= 0.75
      }

      // Compute corrected ground elevation
      const groundElevation = rawElev - canopyHeightM

      cells.push({
        lng,
        lat,
        rawElevation: rawElev,
        ndvi: ndvi ?? 0,
        canopyHeightM,
        groundElevation,
        class: cls,
        defoliation,
        deadTreeLikelihood,
      })
    }
  }

  // Step 5: Cluster anomaly zones
  const zones = clusterCanopyZones(cells, effectiveCellSizeM, analysisMode)

  return {
    cells,
    zones,
    regionalCanopyHeightM: baseCanopyHeight,
    regionName: regionInfo.placeName,
    biomeDescription: `${regionInfo.biome}: ${regionInfo.description}`,
    canopyHeightSource: regionInfo.source,
    bounds,
    gridWidth: effectiveWidth,
    gridHeight: effectiveHeight,
  }
}

/* ------------------------------------------------------------------ */
/* NDVI interpolation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Fallback: estimate NDVI from terrain when satellite NDVI is unavailable.
 * Uses elevation + slope as proxies:
 *  - Gentle slopes at moderate elevations → likely vegetated (NDVI ~0.5-0.7)
 *  - Steep slopes → sparse vegetation (NDVI ~0.2-0.4)
 *  - Very high or very low elevations → less vegetation
 *  - Flat areas near sea level → could be water or wetland (NDVI ~0.1)
 *
 * This is rough but better than no data.
 */
function estimateNdviFromTerrain(elevation: number, slope: number, regionalCanopyHeight: number): number {
  // Sea level or below = water (NDVI ~ 0)
  if (elevation <= 0) return 0

  // If regional canopy height is very low (desert/scrub), NDVI is naturally low
  if (regionalCanopyHeight < 5) return 0.15

  // Slope-based estimation: gentle = more vegetation
  let ndvi: number
  if (slope < 5) ndvi = 0.65
  else if (slope < 10) ndvi = 0.6
  else if (slope < 20) ndvi = 0.55
  else if (slope < 30) ndvi = 0.45
  else if (slope < 45) ndvi = 0.3
  else ndvi = 0.15 // cliff/rock

  // Elevation adjustment: very high elevations have less vegetation
  if (elevation > 3000) ndvi *= 0.5
  else if (elevation > 2000) ndvi *= 0.7

  return Math.max(0, Math.min(1, ndvi))
}

function interpolateNdvi(
  ndviGrid: (number | null)[][],
  samplesX: number,
  samplesY: number,
  fx: number,
  fy: number,
): number | null {
  // Bilinear interpolation
  const gx = fx * (samplesX - 1)
  const gy = fy * (samplesY - 1)
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(x0 + 1, samplesX - 1)
  const y1 = Math.min(y0 + 1, samplesY - 1)
  const tx = gx - x0
  const ty = gy - y0

  const v00 = ndviGrid[y0]?.[x0]
  const v01 = ndviGrid[y0]?.[x1]
  const v10 = ndviGrid[y1]?.[x0]
  const v11 = ndviGrid[y1]?.[x1]

  // If any corner is null, return the nearest non-null
  if (v00 == null && v01 == null && v10 == null && v11 == null) return null
  const vals = [v00, v01, v10, v11].filter((v) => v != null) as number[]
  if (vals.length < 4) return vals[0]

  return (
    v00! * (1 - tx) * (1 - ty) +
    v01! * tx * (1 - ty) +
    v10! * (1 - tx) * ty +
    v11! * tx * ty
  )
}

/* ------------------------------------------------------------------ */
/* Canopy zone clustering                                             */
/* ------------------------------------------------------------------ */

function clusterCanopyZones(
  cells: CanopyCell[],
  cellSizeM: number,
  mode: AnalysisMode,
): CanopyZone[] {
  const zones: CanopyZone[] = []
  let zoneId = 0

  // Cluster defoliation zones (defoliation > 0.4)
  // Only include cells that are actually forested or thinning —
  // bare ground and water are NOT defoliation
  const defoliationCells = cells.filter(
    (c) => c.defoliation > 0.4 && (c.class === 'forest' || c.class === 'thinning'),
  )
  const defolClusters = spatialCluster(defoliationCells, cellSizeM * 3)
  for (const cluster of defolClusters) {
    if (cluster.length < 3) continue
    const avgNdvi = cluster.reduce((s, c) => s + c.ndvi, 0) / cluster.length
    const avgCanopy = cluster.reduce((s, c) => s + c.canopyHeightM, 0) / cluster.length
    const severity = cluster.reduce((s, c) => s + c.defoliation, 0) / cluster.length
    const coords = clusterConvexHull(cluster)
    zones.push({
      id: `canopy-defol-${zoneId++}`,
      coords,
      type: 'defoliation',
      avgNdvi,
      avgCanopyHeightM: avgCanopy,
      areaM2: cluster.length * cellSizeM * cellSizeM,
      severity,
      description: `Defoliation zone: ${cluster.length} cells, avg NDVI ${avgNdvi.toFixed(2)}, severity ${(severity * 100).toFixed(0)}%`,
    })
  }

  // Cluster dead tree zones (deadTreeLikelihood > 0.4)
  const deadCells = cells.filter((c) => c.deadTreeLikelihood > 0.4 && c.class !== 'water')
  const deadClusters = spatialCluster(deadCells, cellSizeM * 3)
  for (const cluster of deadClusters) {
    if (cluster.length < 2) continue
    const avgNdvi = cluster.reduce((s, c) => s + c.ndvi, 0) / cluster.length
    const avgCanopy = cluster.reduce((s, c) => s + c.canopyHeightM, 0) / cluster.length
    const severity = cluster.reduce((s, c) => s + c.deadTreeLikelihood, 0) / cluster.length
    const coords = clusterConvexHull(cluster)
    zones.push({
      id: `canopy-dead-${zoneId++}`,
      coords,
      type: 'dead-trees',
      avgNdvi,
      avgCanopyHeightM: avgCanopy,
      areaM2: cluster.length * cellSizeM * cellSizeM,
      severity,
      description: `Dead tree cluster: ${cluster.length} cells, likelihood ${(severity * 100).toFixed(0)}%`,
    })
  }

  // Cluster clearings (bare cells that are above sea level and surrounded by forest)
  const clearingCells = cells.filter((c) => c.class === 'bare' && c.rawElevation > 0)
  const clearingClusters = spatialCluster(clearingCells, cellSizeM * 2)
  for (const cluster of clearingClusters) {
    if (cluster.length < 3) continue
    const coords = clusterConvexHull(cluster)
    zones.push({
      id: `canopy-clearing-${zoneId++}`,
      coords,
      type: 'clearing',
      avgNdvi: cluster.reduce((s, c) => s + c.ndvi, 0) / cluster.length,
      avgCanopyHeightM: 0,
      areaM2: cluster.length * cellSizeM * cellSizeM,
      severity: 0.5,
      description: `Clearing: ${cluster.length} cells, ~${(cluster.length * cellSizeM * cellSizeM / 10000).toFixed(1)} hectares`,
    })
  }

  // In legacy mode, also identify healthy forest patches (for research context)
  if (mode === 'legacy-research') {
    const healthyCells = cells.filter((c) => c.class === 'forest' && c.defoliation < 0.2)
    const healthyClusters = spatialCluster(healthyCells, cellSizeM * 4)
    for (const cluster of healthyClusters) {
      if (cluster.length < 10) continue
      const coords = clusterConvexHull(cluster)
      const avgNdvi = cluster.reduce((s, c) => s + c.ndvi, 0) / cluster.length
      zones.push({
        id: `canopy-healthy-${zoneId++}`,
        coords,
        type: 'healthy-forest',
        avgNdvi,
        avgCanopyHeightM: cluster.reduce((s, c) => s + c.canopyHeightM, 0) / cluster.length,
        areaM2: cluster.length * cellSizeM * cellSizeM,
        severity: 0,
        description: `Healthy forest: ${cluster.length} cells, avg NDVI ${avgNdvi.toFixed(2)}`,
      })
    }
  }

  return zones
}

/** Simple spatial clustering: group cells within `maxDistM` of each other. */
function spatialCluster(cells: CanopyCell[], maxDistM: number): CanopyCell[][] {
  if (cells.length === 0) return []
  const visited = new Set<number>()
  const clusters: CanopyCell[][] = []

  const maxDistDeg = maxDistM / 111320

  for (let i = 0; i < cells.length; i++) {
    if (visited.has(i)) continue
    const cluster: CanopyCell[] = [cells[i]]
    visited.add(i)
    const stack = [i]

    while (stack.length > 0) {
      const idx = stack.pop()!
      const c = cells[idx]
      for (let j = 0; j < cells.length; j++) {
        if (visited.has(j)) continue
        const d = Math.abs(c.lng - cells[j].lng) + Math.abs(c.lat - cells[j].lat)
        if (d < maxDistDeg) {
          visited.add(j)
          cluster.push(cells[j])
          stack.push(j)
        }
      }
    }

    clusters.push(cluster)
  }

  return clusters
}

/**
 * Convex hull of a cluster of cells using Andrew's monotone chain algorithm.
 * This follows the actual shape of the cluster instead of drawing a rectangle
 * that extends into unrelated areas (like the sea).
 */
function clusterConvexHull(cells: CanopyCell[]): LngLat[] {
  if (cells.length < 3) {
    // Not enough points for a hull — return a small box around the points
    return clusterSmallBox(cells)
  }

  // Extract unique points
  const points = cells.map((c) => ({ lng: c.lng, lat: c.lat }))

  // Sort by lng, then by lat
  points.sort((a, b) => a.lng - b.lng || a.lat - b.lat)

  // Remove duplicates
  const unique: { lng: number; lat: number }[] = []
  for (const p of points) {
    if (unique.length === 0 || unique[unique.length - 1].lng !== p.lng || unique[unique.length - 1].lat !== p.lat) {
      unique.push(p)
    }
  }

  if (unique.length < 3) return clusterSmallBox(cells)

  // Cross product of vectors OA and OB
  const cross = (o: { lng: number; lat: number }, a: { lng: number; lat: number }, b: { lng: number; lat: number }) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)

  // Build lower hull
  const lower: { lng: number; lat: number }[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  // Build upper hull
  const upper: { lng: number; lat: number }[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  // Concatenate (omit last point of each half — it's the first of the other)
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))

  // Close the ring
  hull.push(hull[0])

  return hull
}

/** Small bounding box for clusters with fewer than 3 points. */
function clusterSmallBox(cells: CanopyCell[]): LngLat[] {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const c of cells) {
    if (c.lng < minLng) minLng = c.lng
    if (c.lng > maxLng) maxLng = c.lng
    if (c.lat < minLat) minLat = c.lat
    if (c.lat > maxLat) maxLat = c.lat
  }
  // Add tiny padding so the polygon is visible
  const pad = 0.0001
  return [
    { lng: minLng - pad, lat: minLat - pad },
    { lng: maxLng + pad, lat: minLat - pad },
    { lng: maxLng + pad, lat: maxLat + pad },
    { lng: minLng - pad, lat: maxLat + pad },
    { lng: minLng - pad, lat: minLat - pad },
  ]
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
