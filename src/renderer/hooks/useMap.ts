import { createContext, useContext } from 'react'
import type maplibregl from 'maplibre-gl'

export type DrawMode = 'none' | 'bbox' | 'polygon' | 'line' | 'weather-pin'

export interface LngLat {
  lng: number
  lat: number
}

export interface SelectionEvent {
  type: 'bbox' | 'polygon' | 'line'
  coords: { lng: number; lat: number }[]
}

export interface MapContextValue {
  map: maplibregl.Map | null
  drawMode: DrawMode
  setDrawMode: (mode: DrawMode) => void
  selection: SelectionEvent | null
  clearSelection: () => void
  clearMap: () => void
  registerMap: (map: maplibregl.Map | null) => void
  lkp: LngLat | null
  setLkp: (point: LngLat | null) => void
  endPoint: LngLat | null
  setEndPoint: (point: LngLat | null) => void
  fallPoint: LngLat | null
  setFallPoint: (point: LngLat | null) => void
  weatherPin: LngLat | null
  setWeatherPin: (point: LngLat | null) => void
  terrain3d: boolean
  toggleTerrain3d: () => void
  hillshade: boolean
  toggleHillshade: () => void
}

export const MapContext = createContext<MapContextValue | null>(null)

export function useMap(): MapContextValue {
  const ctx = useContext(MapContext)
  if (!ctx) throw new Error('useMap must be used within MapProvider')
  return ctx
}
