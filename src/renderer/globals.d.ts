import type { TerrainApi, ClimateApi } from '../preload/index'

declare global {
  interface Window {
    terrain: TerrainApi
    climate: ClimateApi
    grid: any
    net: any
  }
}

export {}
