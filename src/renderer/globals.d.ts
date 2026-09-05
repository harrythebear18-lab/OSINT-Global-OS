import type { TerrainApi, ClimateApi, AiApi } from '../preload/index'

declare global {
  interface Window {
    terrain: TerrainApi
    climate: ClimateApi
    grid: any
    net: any
    ai: AiApi
  }
}

export {}
