import type { TerrainApi } from '../preload/index'

declare global {
  interface Window {
    terrain: TerrainApi
  }
}

export {}
