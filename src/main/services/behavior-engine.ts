/**
 * Behavior Engine — portable UEBS2-style terrain behavior simulation.
 *
 * Logic-first, not animation-first. Outputs predictions, not characters.
 *
 * Core principle: agents are terrain-driven behavior queries, not
 * visual entities. The engine runs many agents through terrain physics
 * and extracts statistical outputs:
 *
 *   - Probability fields (where agents likely are over time)
 *   - Path predictions (likely group routes as GeoJSON lines)
 *   - Decision points (where groups split/merge/stop/funnel)
 *   - Density zones (where pressure builds up)
 *
 * Behaviors:
 *   1. Group movement — A* pathfinding toward destination, terrain-weighted
 *   2. Hazard avoidance — avoids steep slopes, cliffs, water, fall-risk zones
 *   3. Fatigue + rest — speed degrades on slope, agents stop at rest points
 *   4. Corridor following — agents bias toward natural terrain funnels
 *
 * The engine is a single file so it can be dropped into any project
 * that provides a DEM grid loader.
 */

import type {
  BehaviorEngineRequest,
  BehaviorEngineResponse,
  BehaviorPath,
  BehaviorDecisionPoint,
  BehaviorDensityZone,
  BehaviorProbabilityCell,
  LngLat,
  TripParams,
} from '@shared/types'
import { demService } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

// ─── DEM grid loading ─────────────────────────────────────────────────

async function loadDemGrid(bounds: [LngLat, LngLat], zoom: number) {
  const effectiveZoom = computeOptimalZoom(bounds, zoom, 32)
  const [sw, ne] = bounds
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
  if (width === 0 || height === 0) throw new Error('No elevation data for this area.')

  // Downsample if too large — allow bigger grids for vast-area modeling
  const maxCells = 150000
  let step = 1
  if (width * height > maxCells) {
    step = Math.ceil(Math.sqrt((width * height) / maxCells))
  }
  let effectiveGrid = grid
  let effectiveWidth = width
  let effectiveHeight = height
  if (step > 1) {
    effectiveGrid = []
    for (let y = 0; y < height; y += step) {
      const row: (number | null)[] = []
      for (let x = 0; x < width; x += step) {
        row.push(grid[y]?.[x] ?? null)
      }
      effectiveGrid.push(row)
    }
    effectiveHeight = effectiveGrid.length
    effectiveWidth = effectiveGrid[0]?.length ?? 0
  }

  const latMid = (sw.lat + ne.lat) / 2
  const gridWidthM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = (gridWidthM / width) * step
  const lngStep = (ne.lng - sw.lng) / effectiveWidth
  const latStep = (ne.lat - sw.lat) / effectiveHeight

  return {
    grid: effectiveGrid,
    width: effectiveWidth,
    height: effectiveHeight,
    cellSizeM,
    swLng: sw.lng,
    neLat: ne.lat,
    lngStep,
    latStep,
  }
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ─── Terrain queries ──────────────────────────────────────────────────

/** Slope at a cell in degrees. */
function cellSlopeDeg(grid: (number | null)[][], x: number, y: number, cellSizeM: number): number {
  const elev = grid[y]?.[x]
  if (elev == null) return 90 // treat no-data as impassable
  let maxSlope = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      const dist = cellSizeM * Math.sqrt(dx * dx + dy * dy)
      if (dist === 0) continue
      const slope = (Math.atan2(Math.abs(n - elev), dist) * 180) / Math.PI
      maxSlope = Math.max(maxSlope, slope)
    }
  }
  return maxSlope
}

/** Terrain cost — higher = harder to traverse. 0 = impassable. */
function terrainCost(grid: (number | null)[][], x: number, y: number, cellSizeM: number, useHazards: boolean): number {
  const elev = grid[y]?.[x]
  if (elev == null) return 0 // impassable

  const slope = cellSlopeDeg(grid, x, y, cellSizeM)

  if (useHazards) {
    // Impassable terrain
    if (slope > 45) return 0 // cliff
    // Very steep — expensive but not impossible
    if (slope > 35) return 10
    // Steep
    if (slope > 25) return 5
  }

  // Moderate slope — moderate cost
  if (slope > 20) return 3
  if (slope > 15) return 2
  if (slope > 10) return 1.5
  // Flat-ish — easy
  return 1
}

/** Terrain gradient — direction of steepest descent (corridor following). */
function terrainGradient(grid: (number | null)[][], x: number, y: number): { dx: number; dy: number; drop: number } {
  const elev = grid[y]?.[x]
  if (elev == null) return { dx: 0, dy: 0, drop: 0 }
  let bestDx = 0, bestDy = 0, bestDrop = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      const drop = elev - n
      if (drop > bestDrop) {
        bestDrop = drop
        bestDx = dx
        bestDy = dy
      }
    }
  }
  return { dx: bestDx, dy: bestDy, drop: bestDrop }
}

/** Check if a cell is a natural corridor (low cost surrounded by higher cost). */
function isCorridorCell(grid: (number | null)[][], x: number, y: number, cellSizeM: number, useHazards: boolean): boolean {
  const cost = terrainCost(grid, x, y, cellSizeM, useHazards)
  if (cost === 0 || cost > 2) return false
  let expensiveNeighbors = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nCost = terrainCost(grid, x + dx, y + dy, cellSizeM, useHazards)
      if (nCost > cost * 2) expensiveNeighbors++
    }
  }
  return expensiveNeighbors >= 4
}

/** Find rest-quality cells (flat, low cost). */
function isRestCell(grid: (number | null)[][], x: number, y: number, cellSizeM: number, useHazards: boolean): boolean {
  const slope = cellSlopeDeg(grid, x, y, cellSizeM)
  if (slope > 10) return false
  const cost = terrainCost(grid, x, y, cellSizeM, useHazards)
  return cost <= 1.5
}

// ─── Coordinate helpers ───────────────────────────────────────────────

function cellToLngLat(x: number, y: number, swLng: number, neLat: number, lngStep: number, latStep: number): LngLat {
  return { lng: swLng + x * lngStep, lat: neLat - y * latStep }
}

function lngLatToCell(lng: number, lat: number, swLng: number, neLat: number, lngStep: number, latStep: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.min(width - 1, Math.max(0, Math.round((lng - swLng) / lngStep))),
    y: Math.min(height - 1, Math.max(0, Math.round((neLat - lat) / latStep))),
  }
}

// ─── A* pathfinding (terrain-weighted) ────────────────────────────────

interface AStarNode {
  x: number
  y: number
  g: number
  h: number
  f: number
  parent: AStarNode | null
}

function aStar(
  grid: (number | null)[][],
  start: { x: number; y: number },
  goal: { x: number; y: number },
  width: number,
  height: number,
  cellSizeM: number,
  useHazards: boolean,
): { x: number; y: number }[] | null {
  const cost = (x: number, y: number) => terrainCost(grid, x, y, cellSizeM, useHazards)
  const heuristic = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x)
    const dy = Math.abs(y - goal.y)
    return Math.sqrt(dx * dx + dy * dy)
  }

  const open: AStarNode[] = []
  const closed = new Set<number>()
  const nodeKey = (x: number, y: number) => y * width + x

  const startNode: AStarNode = { x: start.x, y: start.y, g: 0, h: heuristic(start.x, start.y), f: 0, parent: null }
  startNode.f = startNode.g + startNode.h
  open.push(startNode)

  let iterations = 0
  const maxIter = 50000

  while (open.length > 0 && iterations < maxIter) {
    iterations++
    // Find lowest f
    let bestIdx = 0
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i
    }
    const current = open.splice(bestIdx, 1)[0]
    const key = nodeKey(current.x, current.y)
    if (closed.has(key)) continue
    closed.add(key)

    // Goal reached
    if (Math.abs(current.x - goal.x) <= 2 && Math.abs(current.y - goal.y) <= 2) {
      const path: { x: number; y: number }[] = []
      let n: AStarNode | null = current
      while (n) {
        path.unshift({ x: n.x, y: n.y })
        n = n.parent
      }
      return path
    }

    // Expand neighbors
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = current.x + dx
        const ny = current.y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nKey = nodeKey(nx, ny)
        if (closed.has(nKey)) continue
        const c = cost(nx, ny)
        if (c === 0) continue // impassable
        const moveCost = c * (dx !== 0 && dy !== 0 ? 1.414 : 1)
        const g = current.g + moveCost
        const h = heuristic(nx, ny)
        open.push({ x: nx, y: ny, g, h, f: g + h, parent: current })
      }
    }
  }

  return null // no path found
}

// ─── Agent simulation ─────────────────────────────────────────────────

interface SimAgent {
  x: number
  y: number
  path: { x: number; y: number }[]
  pathIdx: number
  fatigue: number
  resting: boolean
  restTimer: number
  alive: boolean
  speed: number
  // Track visited cells for probability field
  visited: Set<number>
}

// ─── Main engine ──────────────────────────────────────────────────────

export async function runBehaviorEngine(req: BehaviorEngineRequest): Promise<BehaviorEngineResponse> {
  const { bounds, sourcePoints, destination, tripParams, mode, useHazards = true } = req
  const agentCount = Math.min(req.agentCount ?? 100, 5000)
  const timesteps = Math.min(req.timesteps ?? 80, 150)

  const { grid, width, height, cellSizeM, swLng, neLat, lngStep, latStep } = await loadDemGrid(bounds, DEFAULT_ZOOM)

  // ── Resolve spawn points ──────────────────────────────────────────
  const spawnPoints = sourcePoints && sourcePoints.length > 0
    ? sourcePoints
    : [{ lng: (bounds[0].lng + bounds[1].lng) / 2, lat: (bounds[0].lat + bounds[1].lat) / 2 }]

  // ── Resolve destination ───────────────────────────────────────────
  const destCell = destination
    ? lngLatToCell(destination.lng, destination.lat, swLng, neLat, lngStep, latStep, width, height)
    : null

  // ── Precompute corridor and rest maps ─────────────────────────────
  const corridorMap = new Uint8Array(width * height)
  const restMap = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isCorridorCell(grid, x, y, cellSizeM, useHazards)) {
        corridorMap[y * width + x] = 1
      }
      if (isRestCell(grid, x, y, cellSizeM, useHazards)) {
        restMap[y * width + x] = 1
      }
    }
  }

  // ── Compute base paths via A* from each spawn point ───────────────
  // Use a few representative spawn points (not all agents — A* is expensive)
  const pathCache = new Map<string, { x: number; y: number }[] | null>()
  const getPath = (start: { x: number; y: number }, goal: { x: number; y: number }) => {
    const key = `${start.x},${start.y}->${goal.x},${goal.y}`
    if (pathCache.has(key)) return pathCache.get(key)!
    const path = aStar(grid, start, goal, width, height, cellSizeM, useHazards)
    pathCache.set(key, path)
    return path
  }

  // Generate a few distinct base paths (from different spawn points)
  const basePaths: { path: { x: number; y: number }[]; spawnIdx: number }[] = []
  const numBasePaths = Math.min(spawnPoints.length, 5)
  if (destCell) {
    for (let s = 0; s < numBasePaths; s++) {
      const spawn = spawnPoints[s % spawnPoints.length]
      const jitter = {
        lng: (Math.random() - 0.5) * lngStep * 5,
        lat: (Math.random() - 0.5) * latStep * 5,
      }
      const startCell = lngLatToCell(spawn.lng + jitter.lng, spawn.lat + jitter.lat, swLng, neLat, lngStep, latStep, width, height)
      const path = getPath(startCell, destCell)
      if (path && path.length > 1) {
        basePaths.push({ path, spawnIdx: s })
      }
    }
  }

  // ── Spawn agents ──────────────────────────────────────────────────
  const agents: SimAgent[] = []
  for (let i = 0; i < agentCount; i++) {
    const spawn = spawnPoints[i % spawnPoints.length]
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * Math.max(width, height) * 0.05
    const jitter = {
      lng: Math.cos(angle) * dist * lngStep,
      lat: Math.sin(angle) * dist * latStep,
    }
    const cell = lngLatToCell(spawn.lng + jitter.lng, spawn.lat + jitter.lat, swLng, neLat, lngStep, latStep, width, height)

    // Assign each agent to a base path (if available) with some variation
    let path: { x: number; y: number }[] = []
    if (basePaths.length > 0) {
      const base = basePaths[i % basePaths.length]
      // Add slight variation to the path — offset some cells
      path = base.path.map((p) => ({
        x: Math.max(0, Math.min(width - 1, p.x + Math.round((Math.random() - 0.5) * 3))),
        y: Math.max(0, Math.min(height - 1, p.y + Math.round((Math.random() - 0.5) * 3))),
      }))
    }

    agents.push({
      x: cell.x,
      y: cell.y,
      path,
      pathIdx: 0,
      fatigue: 0,
      resting: false,
      restTimer: 0,
      alive: true,
      speed: 1.2, // base m/s
      visited: new Set<number>([cell.y * width + cell.x]),
    })
  }

  // ── Density accumulator ───────────────────────────────────────────
  const densityAccum = new Float32Array(width * height)

  // ── Run simulation ────────────────────────────────────────────────
  for (let t = 0; t < timesteps; t++) {
    for (const a of agents) {
      if (!a.alive) continue

      // ── Resting logic ──
      if (a.resting) {
        a.restTimer--
        a.fatigue = Math.max(0, a.fatigue - 0.05)
        if (a.restTimer <= 0 && a.fatigue < 0.3) {
          a.resting = false
        }
        continue
      }

      // ── Determine next position ──
      let nextX = a.x
      let nextY = a.y

      if (a.path.length > 0 && a.pathIdx < a.path.length) {
        // Follow assigned path
        const target = a.path[a.pathIdx]
        // Move toward target cell
        const dx = target.x - a.x
        const dy = target.y - a.y
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          // Reached this waypoint
          a.pathIdx++
          nextX = target.x
          nextY = target.y
        } else {
          // Step toward target
          nextX = a.x + Math.sign(dx)
          nextY = a.y + Math.sign(dy)
        }
      } else if (destCell) {
        // No path — head directly toward destination
        const dx = destCell.x - a.x
        const dy = destCell.y - a.y
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          a.alive = false // arrived
          continue
        }
        nextX = a.x + Math.sign(dx)
        nextY = a.y + Math.sign(dy)
      } else {
        // No destination — follow terrain gradient (corridor following)
        const grad = terrainGradient(grid, a.x, a.y)
        if (grad.dx !== 0 || grad.dy !== 0) {
          nextX = a.x + grad.dx
          nextY = a.y + grad.dy
        } else {
          // Wander slightly
          nextX = a.x + Math.round((Math.random() - 0.5) * 2)
          nextY = a.y + Math.round((Math.random() - 0.5) * 2)
        }
      }

      // Clamp
      nextX = Math.max(0, Math.min(width - 1, nextX))
      nextY = Math.max(0, Math.min(height - 1, nextY))

      // ── Hazard avoidance ──
      const nextCost = terrainCost(grid, nextX, nextY, cellSizeM, useHazards)
      if (nextCost === 0) {
        // Impassable — try to go around
        const alternatives = [
          { x: a.x + 1, y: a.y },
          { x: a.x - 1, y: a.y },
          { x: a.x, y: a.y + 1 },
          { x: a.x, y: a.y - 1 },
          { x: a.x + 1, y: a.y + 1 },
          { x: a.x - 1, y: a.y - 1 },
          { x: a.x + 1, y: a.y - 1 },
          { x: a.x - 1, y: a.y + 1 },
        ]
        let found = false
        for (const alt of alternatives) {
          if (alt.x < 0 || alt.x >= width || alt.y < 0 || alt.y >= height) continue
          const altCost = terrainCost(grid, alt.x, alt.y, cellSizeM, useHazards)
          if (altCost > 0) {
            nextX = alt.x
            nextY = alt.y
            found = true
            break
          }
        }
        if (!found) {
          // Stuck — rest and try again later
          a.resting = true
          a.restTimer = 5
          continue
        }
      }

      // ── Corridor bias ──
      // If next cell is a corridor, prefer it. If not, check if a corridor cell
      // is nearby and bias toward it slightly.
      if (!corridorMap[nextY * width + nextX]) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const cx = a.x + dx
            const cy = a.y + dy
            if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue
            if (corridorMap[cy * width + cx] && Math.random() < 0.3) {
              nextX = cx
              nextY = cy
              break
            }
          }
        }
      }

      // ── Move ──
      a.x = nextX
      a.y = nextY
      a.visited.add(a.y * width + a.x)

      // ── Fatigue ──
      const slope = cellSlopeDeg(grid, a.x, a.y, cellSizeM)
      const fatigueRate = slope > 25 ? 0.02 : slope > 15 ? 0.01 : 0.005
      a.fatigue = Math.min(1, a.fatigue + fatigueRate)
      a.speed = 1.2 * (1 - a.fatigue * 0.6) * (slope > 30 ? 0.3 : slope > 20 ? 0.6 : 1)

      // ── Rest at rest cells when fatigued ──
      if (a.fatigue > 0.6 && restMap[a.y * width + a.x]) {
        a.resting = true
        a.restTimer = Math.round(5 + Math.random() * 10)
      }

      // ── Check arrival ──
      if (destCell && Math.abs(a.x - destCell.x) <= 2 && Math.abs(a.y - destCell.y) <= 2) {
        a.alive = false
      }

      // ── Accumulate density ──
      densityAccum[a.y * width + a.x] += 1
    }
  }

  // ── Extract outputs ───────────────────────────────────────────────

  // 1. Paths — convert base paths to GeoJSON lines
  const paths: BehaviorPath[] = basePaths.map((bp, i) => {
    const coords = bp.path.map((p) => {
      const ll = cellToLngLat(p.x, p.y, swLng, neLat, lngStep, latStep)
      return { lng: ll.lng, lat: ll.lat }
    })
    // Estimate travel time based on path length and average speed
    let totalDist = 0
    for (let j = 1; j < bp.path.length; j++) {
      const dx = bp.path[j].x - bp.path[j - 1].x
      const dy = bp.path[j].y - bp.path[j - 1].y
      totalDist += Math.sqrt(dx * dx + dy * dy) * cellSizeM
    }
    const hours = totalDist / (1.2 * 3600) // 1.2 m/s average
    const agentsOnPath = Math.ceil(agentCount / basePaths.length)
    return {
      id: `path-${i}`,
      coords,
      confidence: 0.5 + (1 - i * 0.1) * 0.3,
      estimatedHours: Math.round(hours * 10) / 10,
      agentCount: agentsOnPath,
      type: i === 0 ? 'primary' as const : 'alternate' as const,
    }
  })

  // 2. Decision points — find splits, funnels, rest stops, obstacles
  const decisionPoints: BehaviorDecisionPoint[] = []

  // Find funnels (corridor cells where many agents pass through)
  const funnelThreshold = agentCount * 0.15
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (corridorMap[idx] && densityAccum[idx] > funnelThreshold) {
        const ll = cellToLngLat(x, y, swLng, neLat, lngStep, latStep)
        decisionPoints.push({
          id: `dp-funnel-${decisionPoints.length}`,
          lng: ll.lng,
          lat: ll.lat,
          type: 'funnel',
          significance: Math.min(1, densityAccum[idx] / agentCount),
          reason: `Natural terrain funnel — ${Math.round(densityAccum[idx])} agents pass through here`,
          agentCount: Math.round(densityAccum[idx]),
        })
      }
    }
  }

  // Find rest stops (rest cells where agents stopped)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (restMap[idx] && densityAccum[idx] > funnelThreshold * 0.5) {
        // Check it's not already a funnel
        if (decisionPoints.some((dp) => Math.abs(dp.lng - (swLng + x * lngStep)) < lngStep * 2 && Math.abs(dp.lat - (neLat - y * latStep)) < latStep * 2)) {
          continue
        }
        const ll = cellToLngLat(x, y, swLng, neLat, lngStep, latStep)
        decisionPoints.push({
          id: `dp-rest-${decisionPoints.length}`,
          lng: ll.lng,
          lat: ll.lat,
          type: 'rest',
          significance: Math.min(1, densityAccum[idx] / (agentCount * 0.5)),
          reason: `Likely rest stop — flat terrain, ${Math.round(densityAccum[idx])} agents pause here`,
          agentCount: Math.round(densityAccum[idx]),
        })
      }
    }
  }

  // Find obstacles (impassable cells adjacent to high-density cells)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const cost = terrainCost(grid, x, y, cellSizeM, useHazards)
      if (cost === 0) {
        // Check if surrounded by high density
        let surroundingDensity = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            surroundingDensity += densityAccum[(y + dy) * width + (x + dx)]
          }
        }
        if (surroundingDensity > funnelThreshold) {
          const ll = cellToLngLat(x, y, swLng, neLat, lngStep, latStep)
          // Check not too close to existing decision point
          if (decisionPoints.some((dp) => Math.abs(dp.lng - ll.lng) < lngStep * 3 && Math.abs(dp.lat - ll.lat) < latStep * 3)) {
            continue
          }
          decisionPoints.push({
            id: `dp-obstacle-${decisionPoints.length}`,
            lng: ll.lng,
            lat: ll.lat,
            type: 'obstacle',
            significance: Math.min(1, surroundingDensity / agentCount),
            reason: `Terrain obstacle forces group to reroute`,
            agentCount: Math.round(surroundingDensity),
          })
        }
      }
    }
  }

  // Find split points (where paths diverge)
  if (paths.length > 1) {
    for (let i = 0; i < paths[0].coords.length; i++) {
      for (let j = 1; j < paths.length; j++) {
        if (i >= paths[j].coords.length) continue
        const dist = Math.hypot(paths[0].coords[i].lng - paths[j].coords[i].lng, paths[0].coords[i].lat - paths[j].coords[i].lat)
        if (dist > lngStep * 5) {
          // Paths have diverged — this is a split point
          const ll = paths[0].coords[i]
          if (decisionPoints.some((dp) => Math.abs(dp.lng - ll.lng) < lngStep * 5 && Math.abs(dp.lat - ll.lat) < latStep * 5)) {
            continue
          }
          decisionPoints.push({
            id: `dp-split-${decisionPoints.length}`,
            lng: ll.lng,
            lat: ll.lat,
            type: 'split',
            significance: 0.6,
            reason: `Group splits — ${paths.length} viable routes diverge here`,
            agentCount: agentCount,
          })
          break
        }
      }
    }
  }

  // Destination point
  if (destCell) {
    const ll = cellToLngLat(destCell.x, destCell.y, swLng, neLat, lngStep, latStep)
    decisionPoints.push({
      id: `dp-destination-${decisionPoints.length}`,
      lng: ll.lng,
      lat: ll.lat,
      type: 'destination',
      significance: 1,
      reason: `Destination — group converges here`,
      agentCount: agents.filter((a) => !a.alive).length,
    })
  }

  // Cap decision points
  decisionPoints.sort((a, b) => b.significance - a.significance)
  const cappedDecisionPoints = decisionPoints.slice(0, 25)

  // 3. Density zones — cluster high-density cells
  const densityZones = extractDensityZones(densityAccum, width, height, swLng, neLat, lngStep, latStep, agentCount)

  // 4. Probability field — sample visited cells
  const probabilityField = extractProbabilityField(agents, width, height, swLng, neLat, lngStep, latStep, agentCount)

  return {
    paths,
    decisionPoints: cappedDecisionPoints,
    densityZones,
    probabilityField,
    bounds,
    agentCount,
    timestepsCount: timesteps,
  }
}

// ─── Zone extraction ──────────────────────────────────────────────────

function extractDensityZones(
  density: Float32Array,
  width: number, height: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
  totalAgents: number,
): BehaviorDensityZone[] {
  const zones: BehaviorDensityZone[] = []
  const visited = new Uint8Array(width * height)
  const threshold = totalAgents * 0.1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visited[idx] || density[idx] < threshold) continue

      // Flood fill
      const cluster: { x: number; y: number; d: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0 && cluster.length < 80) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx] || density[pidx] < threshold * 0.5) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, d: density[pidx] })
        stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
      }

      if (cluster.length < 3) continue

      const hull = convexHull(cluster.map((c) => ({ x: c.x, y: c.y })))
      const coords = hull.map((c) => ({
        lng: swLng + c.x * lngStep,
        lat: neLat - c.y * latStep,
      }))
      coords.push(coords[0])

      const totalD = cluster.reduce((sum, c) => sum + c.d, 0)
      const densityVal = Math.min(1, totalD / totalAgents)
      const estimatedCount = Math.round(totalD)

      let type: BehaviorDensityZone['type'] = 'congregation'
      if (densityVal > 0.4) type = 'bottleneck'
      else if (densityVal < 0.1) type = 'dispersal'

      zones.push({
        id: `density-${zones.length}`,
        coords,
        density: densityVal,
        estimatedCount,
        type,
      })
    }
  }

  return zones.slice(0, 15)
}

function extractProbabilityField(
  agents: SimAgent[],
  width: number, height: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
  totalAgents: number,
): BehaviorProbabilityCell[] {
  // Aggregate visited cells across all agents
  const cellCounts = new Map<number, number>()
  for (const a of agents) {
    for (const idx of a.visited) {
      cellCounts.set(idx, (cellCounts.get(idx) ?? 0) + 1)
    }
  }

  // Sample — don't return every cell, just ones with meaningful probability
  const cells: BehaviorProbabilityCell[] = []
  for (const [idx, count] of cellCounts) {
    const prob = count / totalAgents
    if (prob < 0.02) continue // skip very low probability
    const x = idx % width
    const y = Math.floor(idx / width)
    cells.push({
      lng: swLng + x * lngStep,
      lat: neLat - y * latStep,
      probability: Math.min(1, prob),
    })
  }

  // Cap to avoid huge payloads — scale with agent count
  const probCap = Math.min(5000, totalAgents * 5)
  return cells.slice(0, probCap)
}

// ─── Convex hull ──────────────────────────────────────────────────────

function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return points
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const unique: { x: number; y: number }[] = []
  for (const p of sorted) {
    if (unique.length === 0 || unique[unique.length - 1].x !== p.x || unique[unique.length - 1].y !== p.y) {
      unique.push(p)
    }
  }
  if (unique.length < 3) return unique

  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: { x: number; y: number }[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: { x: number; y: number }[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}
