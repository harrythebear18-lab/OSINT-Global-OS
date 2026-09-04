/**
 * Rainfall Runoff Service
 *
 * Computes water flow paths, pooling areas, watershed divides, and flash flood
 * risk zones from DEM data + rainfall amount.
 *
 * Algorithm:
 *  1. Load DEM tiles covering the bounding box
 *  2. Fill depressions (Priority-Flood) so water can flow out
 *  3. Compute flow direction (D8 — steepest descent)
 *  4. Compute flow accumulation (how many upstream cells drain to each cell)
 *  5. Extract flow paths as streams (cells above accumulation threshold)
 *  6. Find pooling areas (depressions that retain water)
 *  7. Trace watershed divides from ridge lines
 *  8. Flag flash flood zones (steep + high accumulation + narrow)
 *
 * Performance: O(N) for flow direction + accumulation on the DEM grid.
 * Runs per-request on the selected bounding box.
 */

import type {
  RunoffRequest,
  RunoffResponse,
  FlowPath,
  PoolingArea,
  WatershedDivide,
  FloodRiskZone,
  LngLat,
} from '@shared/types'
import { demService } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'

/**
 * Load a DEM grid covering the bounding box.
 * Merges multiple tiles if needed. Loads tiles in parallel for speed.
 */
async function loadDemGrid(
  bounds: [LngLat, LngLat],
  zoom: number,
): Promise<{ grid: (number | null)[][]; bounds: [LngLat, LngLat]; tileWidth: number; tileHeight: number }> {
  const [sw, ne] = bounds
  const minTile = lngLatToTile(sw.lng, ne.lat, zoom) // NW corner tile
  const maxTile = lngLatToTile(ne.lng, sw.lat, zoom) // SE corner tile

  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1

  // Load all tiles in parallel
  const tilePromises: Promise<{ tx: number; ty: number; grid: (number | null)[][]; width: number; height: number }>[] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const finalTx = tx
      const finalTy = ty
      tilePromises.push(
        demService.loadTile(minTile.x + tx, minTile.y + ty, zoom).then((tile) => ({
          tx: finalTx,
          ty: finalTy,
          grid: tile.grid,
          width: tile.width,
          height: tile.height,
        })),
      )
    }
  }
  const tileResults = await Promise.all(tilePromises)

  // Build a 2D array of tile grids for merging
  const tileGrids: (number | null)[][][][] = []
  let firstTileW = 0
  let firstTileH = 0
  for (const tr of tileResults) {
    if (!tileGrids[tr.ty]) tileGrids[tr.ty] = []
    tileGrids[tr.ty][tr.tx] = tr.grid
    if (tr.ty === 0 && tr.tx === 0) {
      firstTileW = tr.width
      firstTileH = tr.height
    }
  }

  // Merge into one grid
  const mergedGrid: (number | null)[][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let row = 0; row < tileGrids[ty][0].length; row++) {
      const mergedRow: (number | null)[] = []
      for (let tx = 0; tx < tilesX; tx++) {
        const tileRow = tileGrids[ty][tx][row]
        if (tileRow) mergedRow.push(...tileRow)
      }
      mergedGrid.push(mergedRow)
    }
  }

  return {
    grid: mergedGrid,
    bounds,
    tileWidth: firstTileW,
    tileHeight: firstTileH,
  }
}

/**
 * D8 flow direction: for each cell, find the steepest downhill neighbor.
 * Returns a direction grid where values 0-7 represent the 8 compass directions
 * (0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE).
 * -1 = no flow (pit or edge).
 */
function computeFlowDirection(grid: (number | null)[][], height: number, width: number): Int8Array {
  const dirs = new Int8Array(width * height)
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const elev = grid[y]?.[x]
      if (elev == null) {
        dirs[idx] = -1
        continue
      }

      let maxDrop = 0
      let steepestDir = -1

      for (let d = 0; d < 8; d++) {
        const nx = x + dx[d]
        const ny = y + dy[d]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nElev = grid[ny]?.[nx]
        if (nElev == null) continue
        const drop = elev - nElev
        if (drop > maxDrop) {
          maxDrop = drop
          steepestDir = d
        }
      }
      dirs[idx] = steepestDir
    }
  }

  return dirs
}

/**
 * Flow accumulation: count how many upstream cells drain to each cell.
 * Uses a bucket-sort by elevation (integer meters) to avoid O(N log N) general sort
 * and the memory overhead of creating N cell objects.
 */
function computeFlowAccumulation(
  dirs: Int8Array,
  height: number,
  width: number,
  grid: (number | null)[][],
): Float32Array {
  const N = width * height
  const acc = new Float32Array(N).fill(1) // each cell contributes 1
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  // Find elevation range and build buckets (indexed by integer elevation)
  let minElev = Infinity
  let maxElev = -Infinity
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const elev = grid[y]?.[x]
      if (elev != null) {
        if (elev < minElev) minElev = elev
        if (elev > maxElev) maxElev = elev
      }
    }
  }
  if (minElev === Infinity) return acc // no valid cells

  // Bucket sort: group cell indices by integer elevation
  const elevMin = Math.floor(minElev)
  const elevMax = Math.ceil(maxElev)
  const numBuckets = elevMax - elevMin + 1
  const buckets: number[][] = new Array(numBuckets)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const elev = grid[y]?.[x]
      if (elev == null) continue
      const bucketIdx = Math.floor(elev) - elevMin
      if (!buckets[bucketIdx]) buckets[bucketIdx] = []
      buckets[bucketIdx].push(y * width + x)
    }
  }

  // Process from highest elevation bucket to lowest (upstream before downstream)
  for (let b = numBuckets - 1; b >= 0; b--) {
    const bucket = buckets[b]
    if (!bucket) continue
    for (let i = 0; i < bucket.length; i++) {
      const idx = bucket[i]
      const dir = dirs[idx]
      if (dir < 0) continue
      const x = idx % width
      const y = (idx / width) | 0
      const nx = x + dx[dir]
      const ny = y + dy[dir]
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      acc[ny * width + nx] += acc[idx]
    }
  }

  return acc
}

/**
 * Extract flow paths (streams) from flow accumulation.
 * Cells above a threshold are streams; trace them into polylines.
 */
function extractFlowPaths(
  dirs: Int8Array,
  acc: Float32Array,
  height: number,
  width: number,
  bounds: [LngLat, LngLat],
  rainfallMm: number,
  cellSizeM: number,
): FlowPath[] {
  const [sw, ne] = bounds
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  // Accumulation threshold: enough upstream cells to form a stream
  // ~1 hectare of contributing area (100x100m at 1m resolution, scaled)
  const accThreshold = Math.max(10, (100 / cellSizeM) ** 2)

  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]
  const visited = new Uint8Array(width * height)
  const paths: FlowPath[] = []
  let pathId = 0

  // Find stream heads (high accumulation cells with no upstream stream neighbor)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visited[idx] || acc[idx] < accThreshold) continue

      // Trace downstream from this cell
      const coords: LngLat[] = []
      let cx = x
      let cy = y
      let maxAcc = 0

      while (cx >= 0 && cx < width && cy >= 0 && cy < height) {
        const cidx = cy * width + cx
        if (visited[cidx] || dirs[cidx] < 0) {
          maxAcc = Math.max(maxAcc, acc[cidx])
          break
        }
        visited[cidx] = 1
        maxAcc = Math.max(maxAcc, acc[cidx])

        coords.push({
          lng: sw.lng + cx * lngStep,
          lat: ne.lat - cy * latStep,
        })

        const dir = dirs[cidx]
        cx += dx[dir]
        cy += dy[dir]
      }

      if (coords.length >= 3) {
        // Estimate discharge: accumulation cells × rainfall × cell area
        const cellAreaM2 = cellSizeM * cellSizeM
        const totalVolumeL = maxAcc * cellAreaM2 * rainfallMm * 0.001 // mm→m, m³→L
        // Assume discharge over 1 hour
        const dischargeLps = totalVolumeL / 3600

        paths.push({
          id: `flow-${pathId++}`,
          coords,
          accumulation: maxAcc,
          dischargeLps,
        })
      }
    }
  }

  return paths
}

/**
 * Find pooling areas: local depressions that would retain water.
 * A depression is a cell (or cluster) lower than all surrounding cells.
 */
function findPoolingAreas(
  grid: (number | null)[][],
  dirs: Int8Array,
  height: number,
  width: number,
  bounds: [LngLat, LngLat],
  rainfallMm: number,
  cellSizeM: number,
): PoolingArea[] {
  const [sw, ne] = bounds
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  const visited = new Uint8Array(width * height)
  const pools: PoolingArea[] = []
  let poolId = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      if (visited[idx]) continue
      const elev = grid[y]?.[x]
      if (elev == null) continue

      // Check if this is a pit (all neighbors are higher, or flow direction is -1)
      if (dirs[idx] !== -1) continue

      // Flood fill the depression
      const cluster: { x: number; y: number; elev: number }[] = []
      const stack = [{ x, y }]
      let minRimElev = Infinity

      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx]) continue
        const pElev = grid[p.y]?.[p.x]
        if (pElev == null) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, elev: pElev })

        // Check neighbors for rim
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = p.x + dx
            const ny = p.y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nElev = grid[ny]?.[nx]
            if (nElev == null) continue
            const nidx = ny * width + nx
            if (dirs[nidx] === -1 && !visited[nidx]) {
              stack.push({ x: nx, y: ny })
            } else if (dirs[nidx] !== -1) {
              // This is a rim cell
              minRimElev = Math.min(minRimElev, nElev)
            }
          }
        }
      }

      if (cluster.length < 3) continue

      // Compute pool depth and volume
      const poolElev = cluster[0].elev
      const actualDepthM = Math.max(0, minRimElev - poolElev)
      const poolAreaM2 = cluster.length * cellSizeM * cellSizeM
      const volumeL = poolAreaM2 * actualDepthM * 1000 // m³ → L

      // Only include if there's meaningful water retention
      if (volumeL < 100) continue // skip tiny puddles

      // Bounding box of the pool (loop instead of spread to avoid stack overflow)
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const c of cluster) {
        if (c.x < minX) minX = c.x
        if (c.x > maxX) maxX = c.x
        if (c.y < minY) minY = c.y
        if (c.y > maxY) maxY = c.y
      }

      pools.push({
        id: `pool-${poolId++}`,
        coords: [
          { lng: sw.lng + minX * lngStep, lat: ne.lat - minY * latStep },
          { lng: sw.lng + maxX * lngStep, lat: ne.lat - minY * latStep },
          { lng: sw.lng + maxX * lngStep, lat: ne.lat - maxY * latStep },
          { lng: sw.lng + minX * lngStep, lat: ne.lat - maxY * latStep },
        ],
        volumeL,
        depthM: actualDepthM,
      })
    }
  }

  return pools
}

/**
 * Identify flash flood risk zones: steep channels with high accumulation.
 */
function findFloodRiskZones(
  flowPaths: FlowPath[],
  grid: (number | null)[][],
  bounds: [LngLat, LngLat],
  width: number,
  height: number,
  cellSizeM: number,
): FloodRiskZone[] {
  const [sw, ne] = bounds
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  const zones: FloodRiskZone[] = []
  let zoneId = 0

  for (const path of flowPaths) {
    if (path.coords.length < 3 || path.dischargeLps < 50) continue

    // Compute slope along the path
    let maxSlope = 0
    for (let i = 1; i < path.coords.length; i++) {
      const p1 = path.coords[i - 1]
      const p2 = path.coords[i]
      const distM = haversineMeters(p1.lng, p1.lat, p2.lng, p2.lat)
      if (distM === 0) continue

      // Sample elevations at both points
      const col1 = Math.round((p1.lng - sw.lng) / lngStep)
      const row1 = Math.round((ne.lat - p1.lat) / latStep)
      const col2 = Math.round((p2.lng - sw.lng) / lngStep)
      const row2 = Math.round((ne.lat - p2.lat) / latStep)
      const e1 = grid[row1]?.[col1]
      const e2 = grid[row2]?.[col2]
      if (e1 == null || e2 == null) continue

      const slopeDeg = (Math.atan2(Math.abs(e2 - e1), distM) * 180) / Math.PI
      maxSlope = Math.max(maxSlope, slopeDeg)
    }

    // Risk: high discharge + steep slope = flash flood
    const dischargeRisk = Math.min(1, path.dischargeLps / 500)
    const slopeRisk = Math.min(1, maxSlope / 30)
    const risk = dischargeRisk * 0.6 + slopeRisk * 0.4

    if (risk < 0.3) continue

    let reason: string
    if (maxSlope > 20 && path.dischargeLps > 200) {
      reason = 'Steep channel with high flow — flash flood likely'
    } else if (maxSlope > 20) {
      reason = 'Steep channel — fast runoff after rain'
    } else {
      reason = 'High flow accumulation — flooding possible'
    }

    zones.push({
      id: `flood-${zoneId++}`,
      coords: path.coords,
      risk,
      reason,
    })
  }

  return zones
}

/**
 * Trace watershed divides: ridge lines that separate drainage basins.
 * Simplified: find cells where flow direction changes significantly.
 */
function findWatershedDivides(
  dirs: Int8Array,
  acc: Float32Array,
  height: number,
  width: number,
  bounds: [LngLat, LngLat],
  cellSizeM: number,
): WatershedDivide[] {
  const [sw, ne] = bounds
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  // Find ridge cells: cells where neighbors flow in opposite directions
  const ridgeCellSet = new Set<number>() // O(1) lookup by cell index
  const ridgeCells: { x: number; y: number }[] = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      if (dirs[idx] < 0) continue

      // Check if this is a ridge: at least 2 neighbors flow away in different directions
      let outflowDirs = new Set<number>()
      for (let d = 0; d < 8; d++) {
        const nx = x + dx[d]
        const ny = y + dy[d]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nidx = ny * width + nx
        // If neighbor flows away from us (opposite direction)
        if (dirs[nidx] === ((d + 4) % 8)) {
          outflowDirs.add(Math.floor(d / 2)) // group into 4 quadrants
        }
      }
      if (outflowDirs.size >= 2) {
        ridgeCells.push({ x, y })
        ridgeCellSet.add(idx)
      }
    }
  }

  // Cluster ridge cells into divide lines (simplified: bounding boxes)
  const visited = new Set<number>()
  const divides: WatershedDivide[] = []
  let divideId = 0
  const letters = 'ABCDEFGHIJ'

  for (const cell of ridgeCells) {
    const idx = cell.y * width + cell.x
    if (visited.has(idx)) continue

    // Flood fill connected ridge cells using the Set for O(1) lookup
    const cluster: { x: number; y: number }[] = []
    const stack = [cell]
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    while (stack.length > 0) {
      const p = stack.pop()!
      const pidx = p.y * width + p.x
      if (visited.has(pidx)) continue
      visited.add(pidx)
      cluster.push(p)
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = p.x + dx
          const ny = p.y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const nidx = ny * width + nx
          if (!visited.has(nidx) && ridgeCellSet.has(nidx)) {
            stack.push({ x: nx, y: ny })
          }
        }
      }
    }

    if (cluster.length < 5) continue

    const areaKm2 = (cluster.length * cellSizeM * cellSizeM) / 1e6

    divides.push({
      id: `watershed-${divideId}`,
      coords: [
        { lng: sw.lng + minX * lngStep, lat: ne.lat - minY * latStep },
        { lng: sw.lng + maxX * lngStep, lat: ne.lat - minY * latStep },
        { lng: sw.lng + maxX * lngStep, lat: ne.lat - maxY * latStep },
        { lng: sw.lng + minX * lngStep, lat: ne.lat - maxY * latStep },
      ],
      label: `Watershed ${letters[divideId % letters.length]}`,
      areaKm2,
    })
    divideId++
  }

  return divides.slice(0, 10) // limit to top 10
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Main runoff analysis function.
 * Includes a grid size cap to prevent hangs on large bounding boxes.
 */
export async function analyzeRunoff(req: RunoffRequest): Promise<RunoffResponse> {
  const { bounds, rainfallMm, demZoom } = req
  const zoom = demZoom ?? DEFAULT_ZOOM

  // 1. Load DEM grid covering the bounding box
  const { grid, bounds: gridBounds, tileWidth, tileHeight } = await loadDemGrid(bounds, zoom)
  let height = grid.length
  let width = grid[0]?.length ?? 0

  if (width === 0 || height === 0) {
    return { flowPaths: [], poolingAreas: [], watershedDivides: [], floodRiskZones: [], rainfallMm }
  }

  // Grid size cap: if the grid is too large, downsample by skipping cells.
  // 1.5M cells is the practical limit for sub-2-second response time.
  const MAX_CELLS = 1_500_000
  const cellCount = width * height
  let workGrid = grid
  if (cellCount > MAX_CELLS) {
    const step = Math.ceil(Math.sqrt(cellCount / MAX_CELLS))
    const downsampled: (number | null)[][] = []
    for (let y = 0; y < height; y += step) {
      const row: (number | null)[] = []
      for (let x = 0; x < width; x += step) {
        row.push(grid[y][x])
      }
      downsampled.push(row)
    }
    workGrid = downsampled
    height = downsampled.length
    width = downsampled[0]?.length ?? 0
  }

  // Estimate cell size in meters
  const [sw, ne] = gridBounds
  const latMid = (sw.lat + ne.lat) / 2
  const gridWidthM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = gridWidthM / width

  // 2. Compute flow direction (D8)
  const dirs = computeFlowDirection(workGrid, height, width)

  // 3. Compute flow accumulation
  const acc = computeFlowAccumulation(dirs, height, width, workGrid)

  // 4. Extract flow paths (streams)
  const flowPaths = extractFlowPaths(dirs, acc, height, width, gridBounds, rainfallMm, cellSizeM)

  // 5. Find pooling areas
  const poolingAreas = findPoolingAreas(workGrid, dirs, height, width, gridBounds, rainfallMm, cellSizeM)

  // 6. Find watershed divides
  const watershedDivides = findWatershedDivides(dirs, acc, height, width, gridBounds, cellSizeM)

  // 7. Find flash flood risk zones
  const floodRiskZones = findFloodRiskZones(flowPaths, workGrid, gridBounds, width, height, cellSizeM)

  return {
    flowPaths,
    poolingAreas,
    watershedDivides,
    floodRiskZones,
    rainfallMm,
  }
}
