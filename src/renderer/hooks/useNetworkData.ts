import { useState, useEffect, useCallback } from 'react'

/**
 * useNetworkData — subscribes to network monitor IPC push events.
 *
 * Exposes:
 *  - netUpdate: active TCP/UDP connections with GeoIP (every 3s)
 *  - traffic: connection traffic time-series
 *  - alerts: network alerts stream
 *  - health: network health (latency, packet loss, medium detection)
 *  - outages: outage events
 *  - vpn: VPN status
 *  - userLocation: approximate user location (IP-based)
 *  - preciseLocation: more precise location if available
 *  - speedTestProgress: speed test progress (0-100)
 */
export function useNetworkData() {
  const [netUpdate, setNetUpdate] = useState<any>(null)
  const [traffic, setTraffic] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [health, setHealth] = useState<any>(null)
  const [outages, setOutages] = useState<any[]>([])
  const [vpn, setVpn] = useState<any>(null)
  const [userLocation, setUserLocation] = useState<any>(null)
  const [preciseLocation, setPreciseLocation] = useState<any>(null)
  const [speedTestProgress, setSpeedTestProgress] = useState<number>(0)

  useEffect(() => {
    const net = (window as any).net
    if (!net) {
      console.warn('[useNetworkData] window.net not available — preload not loaded?')
      return
    }

    const cleanups: (() => void)[] = []
    cleanups.push(net.onNetUpdate((data: any) => setNetUpdate(data)))
    cleanups.push(net.onNetTraffic((data: any) => {
      setTraffic((prev) => [...prev.slice(-99), data])
    }))
    cleanups.push(net.onNetAlert((alert: any) => {
      setAlerts((prev) => [...prev.slice(-99), alert])
    }))
    cleanups.push(net.onNetHealth((h: any) => setHealth(h)))
    cleanups.push(net.onNetOutage((o: any) => {
      setOutages((prev) => [...prev.slice(-49), o])
    }))
    cleanups.push(net.onNetVPN((s: any) => setVpn(s)))
    cleanups.push(net.onNetUserLocation((l: any) => setUserLocation(l)))
    cleanups.push(net.onNetPreciseLocation((c: any) => setPreciseLocation(c)))
    cleanups.push(net.onSpeedTestProgress((p: number) => setSpeedTestProgress(p)))

    return () => cleanups.forEach((fn) => fn && fn())
  }, [])

  const refreshVPN = useCallback(async () => {
    const net = (window as any).net
    if (net) await net.refreshNetVPN()
  }, [])

  const lookupGeoIP = useCallback(async (ip: string) => {
    const net = (window as any).net
    return net ? await net.lookupNetGeoIP(ip) : null
  }, [])

  const clearGeoIPCache = useCallback(async () => {
    const net = (window as any).net
    if (net) await net.clearNetGeoIPCache()
  }, [])

  const runSpeedTest = useCallback(async () => {
    const net = (window as any).net
    if (net) await net.runSpeedTest()
  }, [])

  const runDNSTest = useCallback(async () => {
    const net = (window as any).net
    return net ? await net.runDNSTest() : null
  }, [])

  const runCustomDNSTest = useCallback(async (servers: string[]) => {
    const net = (window as any).net
    return net ? await net.runCustomDNSTest(servers) : null
  }, [])

  const getDefaultDNSServers = useCallback(async () => {
    const net = (window as any).net
    return net ? await net.getDefaultDNSServers() : []
  }, [])

  const getBandwidthSnapshot = useCallback(async () => {
    const net = (window as any).net
    return net ? await net.getNetBandwidthSnapshot() : null
  }, [])

  const getTopBandwidthUsers = useCallback(async (limit?: number) => {
    const net = (window as any).net
    return net ? await net.getNetTopBandwidthUsers(limit) : []
  }, [])

  const getQualityHeatmap = useCallback(async () => {
    const net = (window as any).net
    return net ? await net.getNetQualityHeatmap() : null
  }, [])

  const runTraceroute = useCallback(async () => {
    const net = (window as any).net
    return net ? await net.runNetTraceroute() : null
  }, [])

  const getTopology = useCallback(async () => {
    const net = (window as any).net
    return net ? await net.getNetTopology() : null
  }, [])

  return {
    netUpdate,
    traffic,
    alerts,
    health,
    outages,
    vpn,
    userLocation,
    preciseLocation,
    speedTestProgress,
    refreshVPN,
    lookupGeoIP,
    clearGeoIPCache,
    runSpeedTest,
    runDNSTest,
    runCustomDNSTest,
    getDefaultDNSServers,
    getBandwidthSnapshot,
    getTopBandwidthUsers,
    getQualityHeatmap,
    runTraceroute,
    getTopology,
  }
}
