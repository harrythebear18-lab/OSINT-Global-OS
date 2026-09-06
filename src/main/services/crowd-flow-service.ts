/**
 * Crowd Flow Service — terrain-driven crowd simulation.
 *
 * The core insight: crowd flow = rainfall runoff + wavefield pressure +
 * human behavior weighting. We already have the terrain physics; this
 * service runs many agents through that same physics with interaction.
 *
 * Algorithm:
 *  1. Load DEM grid for the bounding box
 *  2. Spawn agents at source points (LKP, bbox edges, or user-placed pins)
 *  3. Each timestep, every agent picks a movement direction based on:
 *     - Terrain gradient (follow easiest slope, like runoff)
 *     - Destination attraction (if evacuation/event — move toward target)
 *     - Density repulsion (avoid crowded areas — wavefield pressure)
 *     - Leader-following (non-leaders bias toward nearby leaders)
 *     - Crowd type behavior (panic = fast/spread, festival = slow/converge, etc.)
 *  4. Track density on a grid (wavefield — diffuses each step)
 *  5. Record agent positions every N steps for animation
 *  6. At the end, extract bottlenecks, congregation zones, and flow corridors
 *
 * Crowd types:
 *  - evacuation:   All agents head to destination (exit). High speed, density repulsion strong.
 *  - festival:     Agents wander toward destination (stage/center). Low speed, high congregation.
 *  - hiking-group: Agents follow terrain least-effort, spread out, rest at rest points.
 *  - panic:        Agents scatter randomly, high speed, no destination, strong repulsion.
 */

import type {
  CrowdFlowRequest,
  CrowdFlowResponse,
  CrowdTimestep,
  AgentState,
  CrowdBottleneck,
  CrowdCongregationZone,
  CrowdFlowCorridor,
  CrowdType,
  LngLat,
  TripParams,
} from '@shared/types'
import { demService } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

// ─── DEM grid loading (shared pattern) ───────────────────────────────

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

  // Downsample if too large
  const maxCells = 100000
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

  return { grid: effectiveGrid, width: effectiveWidth, height: effectiveHeight, cellSizeM, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ─── Agent simulation ─────────────────────────────────────────────────

interface SimAgent {
  x: number  // grid cell x
  y: number  // grid cell y
  lng: number
  lat: number
  vx: number  // velocity x (grid cells per step)
  vy: number  // velocity y
  fatigue: number
  speed: number  // m/s
  leader: boolean
  alive: boolean
}

interface CrowdParams {
  baseSpeed: number       // m/s base movement speed
  destinationPull: number // 0-1 how strongly pulled toward destination
  densityRepulsion: number // 0-1 how strongly repelled by crowds
  leaderBias: number      // 0-1 how strongly followers bias toward leaders
  terrainWeight: number   // 0-1 how strongly terrain gradient influences movement
  spread: number          // 0-1 randomness in direction
  fatigueRate: number     // fatigue accumulation per step
  restThreshold: number   // fatigue level at which agent stops to rest
}

function getCrowdParams(type: CrowdType): CrowdParams {
  switch (type) {
    case 'evacuation':
      return { baseSpeed: 1.5, destinationPull: 0.8, densityRepulsion: 0.6, leaderBias: 0.3, terrainWeight: 0.5, spread: 0.1, fatigueRate: 0.003, restThreshold: 0.9 }
    case 'festival':
      return { baseSpeed: 0.5, destinationPull: 0.4, densityRepulsion: 0.3, leaderBias: 0.5, terrainWeight: 0.2, spread: 0.3, fatigueRate: 0.001, restThreshold: 0.7 }
    case 'hiking-group':
      return { baseSpeed: 1.2, destinationPull: 0.2, densityRepulsion: 0.4, leaderBias: 0.6, terrainWeight: 0.7, spread: 0.15, fatigueRate: 0.004, restThreshold: 0.8 }
    case 'panic':
      return { baseSpeed: 2.5, destinationPull: 0.0, densityRepulsion: 0.8, leaderBias: 0.1, terrainWeight: 0.3, spread: 0.6, fatigueRate: 0.005, restThreshold: 0.95 }
  }
}

/** Slope at a cell in degrees (max slope to any neighbor). */
function cellSlopeDeg(grid: (number | null)[][], x: number, y: number, cellSizeM: number): number {
  const elev = grid[y]?.[x]
  if (elev == null) return 0
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

/** Terrain gradient — direction of steepest descent (where water would flow). */
function terrainGradient(grid: (number | null)[][], x: number, y: number, cellSizeM: number): { dx: number; dy: number } {
  const elev = grid[y]?.[x]
  if (elev == null) return { dx: 0, dy: 0 }
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
  return { dx: bestDx, dy: bestDy }
}

/** Convert grid cell to lng/lat. */
function cellToLngLat(x: number, y: number, swLng: number, neLat: number, lngStep: number, latStep: number): LngLat {
  return { lng: swLng + x * lngStep, lat: neLat - y * latStep }
}

/** Convert lng/lat to grid cell. */
function lngLatToCell(lng: number, lat: number, swLng: number, neLat: number, lngStep: number, latStep: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.min(width - 1, Math.max(0, Math.round((lng - swLng) / lngStep))),
    y: Math.min(height - 1, Math.max(0, Math.round((neLat - lat) / latStep))),
  }
}

// ─── Main simulation ──────────────────────────────────────────────────

export async function simulateCrowdFlow(req: CrowdFlowRequest): Promise<CrowdFlowResponse> {
  const { bounds, sourcePoints, destination, crowdType = 'hiking-group', tripParams, mode } = req
  const agentCount = Math.min(req.agentCount ?? 200, 500)
  const timesteps = Math.min(req.timesteps ?? 100, 200)

  const { grid, width, height, cellSizeM, swLng, neLat, lngStep, latStep } = await loadDemGrid(bounds, DEFAULT_ZOOM)

  const params = getCrowdParams(crowdType)

  // ── Spawn agents ──────────────────────────────────────────────────
  const agents: SimAgent[] = []
  const spawnPoints = sourcePoints && sourcePoints.length > 0
    ? sourcePoints
    : [
        // Default: spawn from bbox edges + center
        { lng: (bounds[0].lng + bounds[1].lng) / 2, lat: (bounds[0].lat + bounds[1].lat) / 2 },
        { lng: bounds[0].lng, lat: (bounds[0].lat + bounds[1].lat) / 2 },
        { lng: bounds[1].lng, lat: (bounds[0].lat + bounds[1].lat) / 2 },
      ]

  const destCell = destination
    ? lngLatToCell(destination.lng, destination.lat, swLng, neLat, lngStep, latStep, width, height)
    : null

  for (let i = 0; i < agentCount; i++) {
    const spawn = spawnPoints[i % spawnPoints.length]
    const jitter = {
      lng: (Math.random() - 0.5) * lngStep * 3,
      lat: (Math.random() - 0.5) * latStep * 3,
    }
    const cell = lngLatToCell(spawn.lng + jitter.lng, spawn.lat + jitter.lat, swLng, neLat, lngStep, latStep, width, height)
    agents.push({
      x: cell.x,
      y: cell.y,
      lng: swLng + cell.x * lngStep,
      lat: neLat - cell.y * latStep,
      vx: 0,
      vy: 0,
      fatigue: 0,
      speed: params.baseSpeed,
      leader: i < agentCount * 0.15, // 15% are leaders
      alive: true,
    })
  }

  // ── Density grid (wavefield) ──────────────────────────────────────
  const density = new Float32Array(width * height)
  const densityNext = new Float32Array(width * height)

  // ── Run simulation ────────────────────────────────────────────────
  const recordedTimesteps: CrowdTimestep[] = []
  const recordInterval = Math.max(1, Math.floor(timesteps / 30)) // record ~30 frames

  for (let t = 0; t < timesteps; t++) {
    // Update density grid from agent positions
    density.fill(0)
    for (const a of agents) {
      if (!a.alive) continue
      const idx = a.y * width + a.x
      density[idx] += 1
    }

    // Diffuse density (wavefield propagation)
    densityNext.fill(0)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const self = density[idx]
        let neighborSum = 0
        let neighborCount = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx, ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            neighborSum += density[ny * width + nx]
            neighborCount++
          }
        }
        // Diffuse: 70% stays, 30% spreads to neighbors
        densityNext[idx] = self * 0.7 + (neighborCount > 0 ? neighborSum / neighborCount * 0.3 : 0)
      }
    }
    density.set(densityNext)

    // Update each agent
    for (const a of agents) {
      if (!a.alive) continue

      // Fatigue
      a.fatigue = Math.min(1, a.fatigue + params.fatigueRate)
      if (a.fatigue >= params.restThreshold) {
        // Rest for a bit — don't move
        a.fatigue *= 0.7 // recover
        a.vx *= 0.5
        a.vy *= 0.5
        continue
      }

      // ── Compute movement direction ──
      let dirX = 0, dirY = 0

      // 1. Terrain gradient (follow easiest descent)
      if (params.terrainWeight > 0) {
        const grad = terrainGradient(grid, a.x, a.y, cellSizeM)
        dirX += grad.dx * params.terrainWeight
        dirY += grad.dy * params.terrainWeight
      }

      // 2. Destination attraction
      if (destCell && params.destinationPull > 0) {
        const toDestX = destCell.x - a.x
        const toDestY = destCell.y - a.y
        const dist = Math.sqrt(toDestX * toDestX + toDestY * toDestY)
        if (dist > 0) {
          dirX += (toDestX / dist) * params.destinationPull
          dirY += (toDestY / dist) * params.destinationPull
        }
      }

      // 3. Density repulsion (avoid crowded cells)
      if (params.densityRepulsion > 0) {
        let repX = 0, repY = 0
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = a.x + dx, ny = a.y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const d = density[ny * width + nx]
            if (d > 0) {
              const dist = Math.sqrt(dx * dx + dy * dy)
              repX -= (dx / dist) * d * params.densityRepulsion
              repY -= (dy / dist) * d * params.densityRepulsion
            }
          }
        }
        dirX += repX * 0.1
        dirY += repY * 0.1
      }

      // 4. Leader-following (non-leaders bias toward nearby leaders)
      if (!a.leader && params.leaderBias > 0) {
        let leadX = 0, leadY = 0, leadCount = 0
        for (const other of agents) {
          if (!other.alive || !other.leader) continue
          const dx = other.x - a.x
          const dy = other.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > 0 && dist < 10) { // within 10 cells
            leadX += dx / dist
            leadY += dy / dist
            leadCount++
          }
        }
        if (leadCount > 0) {
          dirX += (leadX / leadCount) * params.leaderBias
          dirY += (leadY / leadCount) * params.leaderBias
        }
      }

      // 5. Random spread
      if (params.spread > 0) {
        dirX += (Math.random() - 0.5) * params.spread * 2
        dirY += (Math.random() - 0.5) * params.spread * 2
      }

      // Normalize direction
      const mag = Math.sqrt(dirX * dirX + dirY * dirY)
      if (mag > 0) {
        dirX /= mag
        dirY /= mag
      }

      // Speed affected by slope and fatigue
      const slope = cellSlopeDeg(grid, a.x, a.y, cellSizeM)
      const slopePenalty = slope > 30 ? 0.3 : slope > 20 ? 0.6 : 1.0
      const fatiguePenalty = 1 - a.fatigue * 0.5
      const stepSize = (params.baseSpeed / cellSizeM) * slopePenalty * fatiguePenalty

      // Update velocity (smooth — blend old and new)
      a.vx = a.vx * 0.5 + dirX * stepSize * 0.5
      a.vy = a.vy * 0.5 + dirY * stepSize * 0.5

      // Move
      a.x = Math.round(a.x + a.vx)
      a.y = Math.round(a.y + a.vy)

      // Clamp to bounds
      a.x = Math.max(0, Math.min(width - 1, a.x))
      a.y = Math.max(0, Math.min(height - 1, a.y))

      // Check impassable terrain (cliff / water)
      const elev = grid[a.y]?.[a.x]
      if (elev == null) {
        // No data — agent stays put
        a.x = Math.max(0, Math.min(width - 1, a.x - Math.sign(a.vx)))
        a.y = Math.max(0, Math.min(height - 1, a.y - Math.sign(a.vy)))
      }

      // Update lng/lat
      a.lng = swLng + a.x * lngStep
      a.lat = neLat - a.y * latStep

      // Check if reached destination
      if (destCell) {
        const distToDest = Math.sqrt((a.x - destCell.x) ** 2 + (a.y - destCell.y) ** 2)
        if (distToDest < 2) {
          a.alive = false // arrived
        }
      }
    }

    // Record timestep for animation
    if (t % recordInterval === 0 || t === timesteps - 1) {
      const agentStates: AgentState[] = agents
        .filter((a) => a.alive)
        .map((a) => ({
          lng: a.lng,
          lat: a.lat,
          fatigue: a.fatigue,
          speed: a.speed,
          leader: a.leader,
        }))
      let maxDensity = 0
      for (let i = 0; i < density.length; i++) {
        if (density[i] > maxDensity) maxDensity = density[i]
      }
      recordedTimesteps.push({ agents: agentStates, maxDensity })
    }
  }

  // ── Extract analysis zones ────────────────────────────────────────

  // Final density grid
  const finalDensity = new Float32Array(width * height)
  for (const a of agents) {
    if (!a.alive) continue
    finalDensity[a.y * width + a.x] += 1
  }

  const bottlenecks = extractBottlenecks(finalDensity, density, width, height, swLng, neLat, lngStep, latStep, cellSizeM)
  const congregationZones = extractCongregationZones(finalDensity, width, height, swLng, neLat, lngStep, latStep, agentCount)
  const flowCorridors = extractFlowCorridors(agents, width, height, swLng, neLat, lngStep, latStep)

  return {
    timesteps: recordedTimesteps,
    bottlenecks,
    congregationZones,
    flowCorridors,
    bounds,
    agentCount,
    timestepsCount: timesteps,
    crowdType,
  }
}

// ─── Zone extraction ──────────────────────────────────────────────────

/** Find bottlenecks — cells where density is high but surrounded by low density (compression). */
function extractBottlenecks(
  finalDensity: Float32Array,
  waveDensity: Float32Array,
  width: number, height: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
  cellSizeM: number,
): CrowdBottleneck[] {
  const bottlenecks: CrowdBottleneck[] = []
  const visited = new Uint8Array(width * height)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      if (visited[idx]) continue
      const d = waveDensity[idx]
      if (d < 2) continue // need meaningful density

      // Check if this is a compression zone (high density, low-density neighbors)
      let neighborDensity = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          neighborDensity += waveDensity[(y + dy) * width + (x + dx)]
        }
      }
      const avgNeighbor = neighborDensity / 8
      if (d < avgNeighbor * 1.5) continue // not compressed enough

      // Flood fill to find the bottleneck cluster
      const cluster: { x: number; y: number; d: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0 && cluster.length < 50) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx]) continue
        if (waveDensity[pidx] < 1.5) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, d: waveDensity[pidx] })
        stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
      }

      if (cluster.length < 3) continue

      // Hull of cluster
      const hull = convexHull(cluster.map((c) => ({ x: c.x, y: c.y })))
      const coords = hull.map((c) => ({
        lng: swLng + c.x * lngStep,
        lat: neLat - c.y * latStep,
      }))
      coords.push(coords[0])

      const maxD = Math.max(...cluster.map((c) => c.d))
      const severity = Math.min(1, maxD / 10)
      const flowRate = cluster.length

      bottlenecks.push({
        id: `bottleneck-${bottlenecks.length}`,
        coords,
        severity,
        flowRate,
        reason: `Compression zone — ${flowRate} agents funneled through narrow terrain`,
      })
    }
  }

  return bottlenecks.slice(0, 20) // cap
}

/** Find congregation zones — areas where agents cluster at end of simulation. */
function extractCongregationZones(
  finalDensity: Float32Array,
  width: number, height: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
  totalAgents: number,
): CrowdCongregationZone[] {
  const zones: CrowdCongregationZone[] = []
  const visited = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visited[idx] || finalDensity[idx] < 3) continue

      // Flood fill
      const cluster: { x: number; y: number; d: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0 && cluster.length < 100) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx] || finalDensity[pidx] < 2) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, d: finalDensity[pidx] })
        stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
      }

      if (cluster.length < 3) continue

      const hull = convexHull(cluster.map((c) => ({ x: c.x, y: c.y })))
      const coords = hull.map((c) => ({
        lng: swLng + c.x * lngStep,
        lat: neLat - c.y * latStep,
      }))
      coords.push(coords[0])

      const totalPeople = cluster.reduce((sum, c) => sum + c.d, 0)
      const density = Math.min(1, totalPeople / totalAgents)
      const estimatedCount = Math.round(totalPeople)

      // Classify type
      let type: CrowdCongregationZone['type'] = 'converge'
      if (density > 0.3) type = 'trapped'
      else if (density < 0.1) type = 'dispersal'
      else if (density < 0.2) type = 'rest'

      zones.push({
        id: `congregation-${zones.length}`,
        coords,
        density,
        estimatedCount,
        type,
      })
    }
  }

  return zones.slice(0, 15)
}

/** Extract flow corridors — dominant movement directions from agent velocity. */
function extractFlowCorridors(
  agents: SimAgent[],
  width: number, height: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
): CrowdFlowCorridor[] {
  // Group agents into spatial bins and compute average velocity
  const binSize = Math.max(5, Math.floor(width / 10))
  const binsX = Math.ceil(width / binSize)
  const binsY = Math.ceil(height / binSize)
  const bins: { vx: number; vy: number; count: number; cx: number; cy: number }[] = []

  for (let by = 0; by < binsY; by++) {
    for (let bx = 0; bx < binsX; bx++) {
      let vx = 0, vy = 0, count = 0, cx = 0, cy = 0
      for (const a of agents) {
        if (!a.alive) continue
        const ax = Math.floor(a.x / binSize)
        const ay = Math.floor(a.y / binSize)
        if (ax !== bx || ay !== by) continue
        vx += a.vx
        vy += a.vy
        cx += a.x
        cy += a.y
        count++
      }
      if (count < 3) continue
      bins.push({
        vx: vx / count,
        vy: vy / count,
        count,
        cx: cx / count,
        cy: cy / count,
      })
    }
  }

  // Create corridors from bins with strong directional flow
  const corridors: CrowdFlowCorridor[] = []
  for (const bin of bins) {
    const speed = Math.sqrt(bin.vx * bin.vx + bin.vy * bin.vy)
    if (speed < 0.1) continue

    const startLng = swLng + bin.cx * lngStep
    const startLat = neLat - bin.cy * latStep
    const endX = bin.cx + bin.vx * 5
    const endY = bin.cy + bin.vy * 5
    const endLng = swLng + endX * lngStep
    const endLat = neLat - endY * latStep

    const direction = ((Math.atan2(bin.vx, -bin.vy) * 180) / Math.PI + 360) % 360
    const volume = Math.min(1, bin.count / 20)

    if (volume < 0.15) continue

    corridors.push({
      id: `corridor-${corridors.length}`,
      coords: [
        { lng: startLng, lat: startLat },
        { lng: endLng, lat: endLat },
      ],
      volume,
      direction,
    })
  }

  return corridors.slice(0, 30)
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
