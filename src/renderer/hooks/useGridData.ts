import { useState, useEffect, useCallback } from 'react'

/**
 * useGridData — subscribes to power grid monitor IPC push events.
 *
 * Exposes:
 *  - gridUpdate: assets + measurements (every 10s)
 *  - integrity: grid verification + health
 *  - alerts: grid alerts stream
 *  - traffic: grid traffic time-series
 *  - settings: monitor settings
 *  - crossDomain: whether cross-domain influence is enabled
 */
export function useGridData() {
  const [gridUpdate, setGridUpdate] = useState<any>(null)
  const [integrity, setIntegrity] = useState<any>(null)
  const [alerts, setAlerts] = useState<any[]>([])
  const [traffic, setTraffic] = useState<any[]>([])
  const [settings, setSettings] = useState<any>(null)
  const [crossDomain, setCrossDomainState] = useState<boolean>(false)

  useEffect(() => {
    const grid = (window as any).grid
    if (!grid) {
      console.warn('[useGridData] window.grid not available — preload not loaded?')
      return
    }

    const cleanups: (() => void)[] = []
    cleanups.push(grid.onGridUpdate((data: any) => setGridUpdate(data)))
    cleanups.push(grid.onGridIntegrity((data: any) => setIntegrity(data)))
    cleanups.push(grid.onGridAlert((alert: any) => {
      setAlerts((prev) => [...prev.slice(-99), alert])
    }))
    cleanups.push(grid.onGridTraffic((data: any) => {
      setTraffic((prev) => [...prev.slice(-99), data])
    }))
    cleanups.push(grid.onGridSettings((s: any) => setSettings(s)))

    return () => cleanups.forEach((fn) => fn && fn())
  }, [])

  const whitelistAsset = useCallback((assetId: string) => {
    const grid = (window as any).grid
    if (grid) grid.whitelistAsset(assetId)
  }, [])

  const unwhitelistAsset = useCallback((assetId: string) => {
    const grid = (window as any).grid
    if (grid) grid.unwhitelistAsset(assetId)
  }, [])

  const getWhitelist = useCallback(async () => {
    const grid = (window as any).grid
    return grid ? await grid.getGridWhitelist() : []
  }, [])

  const snoozeGridAlerts = useCallback((minutes: number) => {
    const grid = (window as any).grid
    if (grid) grid.snoozeGridAlerts(minutes)
  }, [])

  const isGridSnoozed = useCallback(async () => {
    const grid = (window as any).grid
    return grid ? await grid.isGridSnoozed() : false
  }, [])

  const getGridSettings = useCallback(async () => {
    const grid = (window as any).grid
    return grid ? await grid.getGridSettings() : null
  }, [])

  const updateGridSettings = useCallback((partial: any) => {
    const grid = (window as any).grid
    if (grid) grid.updateGridSettings(partial)
  }, [])

  const setCrossDomain = useCallback(async (enabled: boolean) => {
    const grid = (window as any).grid
    if (grid) {
      await grid.setCrossDomain(enabled)
      setCrossDomainState(enabled)
    }
  }, [])

  const getCrossDomain = useCallback(async () => {
    const grid = (window as any).grid
    if (grid) {
      const enabled = await grid.getCrossDomain()
      setCrossDomainState(enabled)
      return enabled
    }
    return false
  }, [])

  return {
    gridUpdate,
    integrity,
    alerts,
    traffic,
    settings,
    crossDomain,
    whitelistAsset,
    unwhitelistAsset,
    getWhitelist,
    snoozeGridAlerts,
    isGridSnoozed,
    getGridSettings,
    updateGridSettings,
    setCrossDomain,
    getCrossDomain,
  }
}
