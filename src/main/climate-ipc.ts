/**
 * Climate / Prediction / Grid / Network IPC handler registration.
 *
 * Wires the four "live monitor" subsystems to IPC channels defined in @shared/ipc.
 * Mirrors the wiring in the weather-radar project's electron/main.ts, but adapted
 * to the osint-global-os service APIs (callback-based ClimateMonitor / NetworkMonitor,
 * EventEmitter-based GridMonitor) and the shared IPC channel constants.
 */

import { app, ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { IPC } from '@shared/ipc'
import { ClimateMonitor } from './services/climate/climateMonitor'
import { PredictionEngine } from './services/climate/predictionEngine'
import { GridMonitor } from './services/grid/gridMonitor'
import type { GridMonitorUpdate } from './services/grid/gridMonitor'
import type { GridIntegrityUpdate, GridAlert, MonitorSettings, GridTrafficDataPoint } from './services/grid/gridTypes'
import { NetworkMonitor } from './services/network/networkMonitor'
import { GeoIPService } from './services/network/geoip'
import { VPNDetector } from './services/network/vpnDetector'
import { SpeedTestService } from './services/network/speedTest'
import { DNSTestService } from './services/network/dnsTest'
import { NotificationService } from './services/network/notificationService'
import type {
  NetworkConnection,
  MonitorUpdate,
  TrafficDataPoint,
  ConnectionAlert,
  NetworkHealth,
  OutageEvent,
  UserConfig,
} from './services/network/networkTypes'
import { AircraftFetcher } from './services/climate/weatherFetcher'
import {
  stormsToWeatherEvents,
  lightningToWeatherEvents,
} from './services/grid/weatherGridInfluence'
import { generateSeismicGridAlerts } from './services/grid/seismicGridInfluence'
import { generateSpaceWeatherGridAlerts } from './services/grid/spaceWeatherGridInfluence'
import { generateWeatherAircraftAlerts } from './services/grid/weatherAircraftInfluence'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Safely send an IPC message to the renderer window. */
function sendToRenderer(win: BrowserWindow, channel: string, data: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

/** Input validation for network IPC handlers. */
function validateProcessName(name: unknown): boolean {
  if (typeof name !== 'string') return false
  return /^[a-zA-Z0-9._\-\s]+$/.test(name) && name.length > 0 && name.length <= 256
}

function validateMinutes(minutes: unknown): boolean {
  if (typeof minutes !== 'number') return false
  return minutes >= 0 && minutes <= 1440
}

function validateIP(ip: unknown): boolean {
  if (typeof ip !== 'string') return false
  return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

/**
 * Register all climate, prediction, grid, and network IPC handlers.
 *
 * Instantiates the four live monitors, starts them, wires cross-domain
 * influence, and registers every IPC channel the renderer needs.
 *
 * @returns a cleanup function that stops all monitors and clears timers.
 */
export function registerClimateIpc(mainWindow: BrowserWindow): () => void {
  /* ---- ClimateMonitor (callback-based) ---- */
  const climateMonitor = new ClimateMonitor(
    (stations, measurements, stats) => {
      sendToRenderer(mainWindow, IPC.CLIMATE_UPDATE, { stations, measurements, stats, timestamp: Date.now() })
    },
    (traffic) => {
      sendToRenderer(mainWindow, IPC.CLIMATE_TRAFFIC, traffic)
    },
    (alert) => {
      sendToRenderer(mainWindow, IPC.CLIMATE_ALERT, alert)
    },
    (update) => {
      sendToRenderer(mainWindow, IPC.CLIMATE_INTEGRITY, update)
    },
  )
  climateMonitor.start()

  /* ---- PredictionEngine (callback-based) ---- */
  const predictionEngine = new PredictionEngine((update) => {
    sendToRenderer(mainWindow, IPC.PREDICTION_UPDATE, update)
  })
  climateMonitor.setPredictionEngine(predictionEngine)
  predictionEngine.start()

  /* ---- GridMonitor (EventEmitter-based) ---- */
  const gridMonitor = new GridMonitor({ fetchIntervalMs: 10000 })
  gridMonitor.on('gridUpdate', (update: GridMonitorUpdate) => {
    sendToRenderer(mainWindow, IPC.GRID_UPDATE, {
      ...update,
      measurements: Array.from(update.measurements.entries()),
    })
  })
  gridMonitor.on('integrityUpdate', (update: GridIntegrityUpdate) => {
    sendToRenderer(mainWindow, IPC.GRID_INTEGRITY, update)
  })
  gridMonitor.on('trafficUpdate', (data: GridTrafficDataPoint) => {
    sendToRenderer(mainWindow, IPC.GRID_TRAFFIC, data)
  })
  gridMonitor.on('alert', (alert: GridAlert) => {
    sendToRenderer(mainWindow, IPC.GRID_ALERT, alert)
  })
  gridMonitor.on('settingsUpdate', (settings: MonitorSettings) => {
    sendToRenderer(mainWindow, IPC.GRID_SETTINGS, settings)
  })
  gridMonitor.start()

  /* ---- NetworkMonitor (callback-based) ---- */
  const geoIP = new GeoIPService()
  const vpnDetector = new VPNDetector(geoIP)
  const speedTestService = new SpeedTestService()
  const dnsTestService = new DNSTestService()
  const notificationService = new NotificationService()

  const networkMonitor = new NetworkMonitor(
    geoIP,
    (connections: NetworkConnection[]) => {
      const stats = networkMonitor.getStats(connections)
      const update: MonitorUpdate = {
        connections,
        stats,
        myLocation: null,
        pendingGeoLookups: geoIP.getPendingCount(),
        timestamp: Date.now(),
      }
      sendToRenderer(mainWindow, IPC.NET_UPDATE, update)
    },
    (dataPoint: TrafficDataPoint) => {
      sendToRenderer(mainWindow, IPC.NET_TRAFFIC, dataPoint)
    },
    (alert: ConnectionAlert) => {
      sendToRenderer(mainWindow, IPC.NET_ALERT, alert)
    },
    (health: NetworkHealth) => {
      sendToRenderer(mainWindow, IPC.NET_HEALTH, health)
    },
    (outage: OutageEvent) => {
      sendToRenderer(mainWindow, IPC.NET_OUTAGE, outage)
    },
  )
  networkMonitor.start()

  /* ---- VPN detection (initial + periodic) ---- */
  async function sendNetVPNStatus(): Promise<void> {
    if (mainWindow.isDestroyed()) return
    try {
      const status = await vpnDetector.detect()
      sendToRenderer(mainWindow, IPC.NET_VPN, status)
      if (status.publicIPGeo) {
        sendToRenderer(mainWindow, IPC.NET_USER_LOCATION, status.publicIPGeo)
      }
    } catch (e) {
      console.error('VPN detection error:', e)
    }
  }
  sendNetVPNStatus()
  const vpnTimer = setInterval(() => sendNetVPNStatus(), 30_000)

  /* ---- Cross-domain influence (every 60s) ---- */
  // Feed weather events (storms, lightning) from ClimateMonitor into GridMonitor
  // so it can generate weather-correlated grid risk alerts for assets near
  // hazardous weather. Also feeds seismic events, space weather, and generates
  // weather→aircraft alerts.
  const crossDomainTimer = setInterval(() => {
    const storms = climateMonitor.getStorms()
    const lightning = climateMonitor.getLightning()
    const events = [
      ...stormsToWeatherEvents(storms),
      ...lightningToWeatherEvents(lightning),
    ]
    if (events.length > 0) {
      gridMonitor.setWeatherEvents(events)
    }

    // Seismic → Grid alerts
    const earthquakes = climateMonitor.getEarthquakes()
    if (earthquakes.length > 0) {
      const seismicAlerts = generateSeismicGridAlerts(earthquakes, gridMonitor.getAssets())
      for (const alert of seismicAlerts) {
        gridMonitor.emit('alert', alert)
      }
    }

    // Space weather → Grid alerts
    const spaceWx = climateMonitor.getSpaceWeather()
    if (spaceWx) {
      const spaceWxAlerts = generateSpaceWeatherGridAlerts(spaceWx, gridMonitor.getAssets())
      for (const alert of spaceWxAlerts) {
        gridMonitor.emit('alert', alert)
      }
    }

    // Weather → Aircraft alerts
    const aircraft = climateMonitor.getAircraft()
    if (events.length > 0 && aircraft.length > 0) {
      const aircraftAlerts = generateWeatherAircraftAlerts(events, aircraft)
      if (aircraftAlerts.length > 0) {
        sendToRenderer(mainWindow, IPC.AIRCRAFT_WEATHER_ALERTS, aircraftAlerts)
      }
    }
  }, 60_000)

  /* ------------------------------------------------------------------ */
  /* IPC handlers — Climate                                              */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IPC.CLIMATE_WHITELIST, (_e, stationId: string) => {
    climateMonitor.whitelistStation(stationId)
  })

  ipcMain.handle(IPC.CLIMATE_UNWHITELIST, (_e, stationId: string) => {
    climateMonitor.unwhitelistStation(stationId)
  })

  ipcMain.handle(IPC.CLIMATE_SNOOZE, (_e, ms: number) => {
    climateMonitor.setSnooze(ms)
  })

  ipcMain.handle(IPC.CLIMATE_GET_SNOOZE, () => {
    return climateMonitor.isSnoozed()
  })

  // Viewport bounds — renderer sends current map viewport so backend can cull
  // vessels/aircraft to only what's visible (reduces IPC payload dramatically).
  // Uses ipcMain.on (one-way) not ipcMain.handle (request/response).
  ipcMain.on(IPC.CLIMATE_SET_VIEWPORT, (_e, bounds: { n: number; s: number; e: number; w: number } | null) => {
    climateMonitor.setViewportBounds(bounds)
  })

  /* ------------------------------------------------------------------ */
  /* IPC handlers — Aircraft (on-demand)                                 */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IPC.AIRCRAFT_METADATA, async (_e, icao24: string) => {
    return await AircraftFetcher.fetchMetadata(icao24)
  })

  ipcMain.handle(IPC.AIRCRAFT_TRACK, async (_e, icao24: string) => {
    return await AircraftFetcher.fetchTrack(icao24)
  })

  /* ------------------------------------------------------------------ */
  /* IPC handlers — Windy webcam proxy                                  */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IPC.WINDY_FETCH, async (_e, url: string, apiKey: string) => {
    try {
      const res = await fetch(url, {
        headers: { 'x-windy-api-key': apiKey },
      })
      const text = await res.text()
      return { ok: res.ok, status: res.status, body: text }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, status: 0, body: msg }
    }
  })

  /* ------------------------------------------------------------------ */
  /* IPC handlers — Grid                                                 */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IPC.GRID_WHITELIST, (_e, assetId: string) => {
    gridMonitor.whitelistAsset(assetId)
  })

  ipcMain.handle(IPC.GRID_UNWHITELIST, (_e, assetId: string) => {
    gridMonitor.unwhitelistAsset(assetId)
  })

  ipcMain.handle(IPC.GRID_GET_WHITELIST, () => {
    return gridMonitor.getWhitelist()
  })

  ipcMain.handle(IPC.GRID_SNOOZE, (_e, minutes: number) => {
    gridMonitor.snoozeAlerts(minutes)
  })

  ipcMain.handle(IPC.GRID_GET_SNOOZE, () => {
    return gridMonitor.isSnoozed()
  })

  ipcMain.handle(IPC.GRID_GET_SETTINGS, () => {
    return gridMonitor.getSettings()
  })

  ipcMain.handle(IPC.GRID_UPDATE_SETTINGS, (_e, partial: Partial<MonitorSettings>) => {
    gridMonitor.updateSettings(partial)
  })

  ipcMain.handle(IPC.GRID_SET_CROSS_DOMAIN, (_e, enabled: boolean) => {
    gridMonitor.setCrossDomainEnabled(enabled)
  })

  ipcMain.handle(IPC.GRID_GET_CROSS_DOMAIN, () => {
    return gridMonitor.isCrossDomainEnabled()
  })

  /* ------------------------------------------------------------------ */
  /* IPC handlers — Network                                              */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IPC.NET_VPN_REFRESH, async () => {
    const status = await vpnDetector.detect()
    if (status.publicIPGeo) {
      sendToRenderer(mainWindow, IPC.NET_USER_LOCATION, status.publicIPGeo)
    }
    return status
  })

  ipcMain.handle(IPC.NET_GEOIP_LOOKUP, async (_e, ip: string) => {
    if (!validateIP(ip)) return null
    return geoIP.lookup(ip)
  })

  ipcMain.handle(IPC.NET_GEOIP_CLEAR_CACHE, () => {
    geoIP.clearCache()
  })

  ipcMain.handle(IPC.NET_ALERTS_WHITELIST, (_e, processName: string) => {
    if (!validateProcessName(processName)) return
    networkMonitor.whitelistProcess(processName)
  })

  ipcMain.handle(IPC.NET_ALERTS_UNWHITELIST, (_e, processName: string) => {
    if (!validateProcessName(processName)) return
    networkMonitor.unwhitelistProcess(processName)
  })

  ipcMain.handle(IPC.NET_ALERTS_GET_WHITELIST, () => {
    return networkMonitor.getWhitelistedProcesses()
  })

  ipcMain.handle(IPC.NET_ALERTS_SNOOZE, (_e, minutes: number) => {
    if (!validateMinutes(minutes)) return
    networkMonitor.setSnooze(minutes * 60 * 1000)
  })

  ipcMain.handle(IPC.NET_ALERTS_IS_SNOOZED, () => {
    return networkMonitor.isSnoozed()
  })

  ipcMain.handle(IPC.NET_HEALTH_GET_CURRENT, () => {
    return networkMonitor.getNetworkHealth()
  })

  ipcMain.handle(IPC.NET_HEALTH_GET_OUTAGE_HISTORY, () => {
    return networkMonitor.getOutageHistory()
  })

  ipcMain.handle(IPC.NET_HEALTH_GET_ACTIVE_OUTAGE, () => {
    return networkMonitor.getActiveOutage()
  })

  ipcMain.handle(IPC.NET_CONFIG_SAVE, (_e, config: UserConfig) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'net-user-config.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
      const fd = networkMonitor.getFaultDetector()
      if (fd && config.faultDetection) {
        fd.updateConfig({
          checkInterval: config.faultDetection.checkInterval,
          latencyThreshold: config.faultDetection.latencyThreshold,
          packetLossThreshold: config.faultDetection.packetLossThreshold,
          consecutiveFailures: config.faultDetection.consecutiveFailures,
        })
      }
      if (config.alerts?.email) {
        notificationService.setEmailConfig(config.alerts.email)
      }
      if (config.alerts?.sms) {
        notificationService.setSMSConfig(config.alerts.sms)
      }
      return true
    } catch (error) {
      console.error('Failed to save net config:', error)
      return false
    }
  })

  ipcMain.handle(IPC.NET_CONFIG_LOAD, () => {
    try {
      const configPath = path.join(app.getPath('userData'), 'net-user-config.json')
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      }
      return null
    } catch (error) {
      console.error('Failed to load net config:', error)
      return null
    }
  })

  ipcMain.handle(IPC.NET_SPEEDTEST_RUN, async () => {
    try {
      return await speedTestService.runSpeedTest()
    } catch (error) {
      console.error('Speed test failed:', error)
      return null
    }
  })

  ipcMain.handle(IPC.NET_DNSTEST_RUN, async () => {
    try {
      return await dnsTestService.testAllServers()
    } catch (error) {
      console.error('DNS test failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_DNSTEST_CUSTOM, async (_e, servers: string[]) => {
    try {
      return await dnsTestService.testCustomServers(servers)
    } catch (error) {
      console.error('Custom DNS test failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_DNSTEST_DEFAULTS, () => {
    return dnsTestService.getDefaultServers()
  })

  ipcMain.handle(IPC.NET_EXPORT_OUTAGE_HISTORY, (_e, format: 'csv' | 'json') => {
    try {
      const history = networkMonitor.getOutageHistory()
      const userDataPath = app.getPath('userData')
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      let filePath: string
      let content: string
      if (format === 'csv') {
        filePath = path.join(userDataPath, `net-outage-history-${ts}.csv`)
        const headers = ['ID', 'Start', 'End', 'Duration', 'Type', 'Severity', 'Description', 'Resolved']
        const rows = history.map((o) => [
          o.id,
          new Date(o.startTime).toISOString(),
          o.endTime ? new Date(o.endTime).toISOString() : '',
          o.duration || '',
          o.type,
          o.severity,
          o.description,
          o.resolved,
        ])
        content = [headers, ...rows].map((r) => r.join(',')).join('\n')
      } else {
        filePath = path.join(userDataPath, `net-outage-history-${ts}.json`)
        content = JSON.stringify(history, null, 2)
      }
      fs.writeFileSync(filePath, content, 'utf-8')
      return filePath
    } catch (error) {
      console.error('Failed to export outage history:', error)
      return null
    }
  })

  ipcMain.handle(IPC.NET_EXPORT_CONNECTION_LOGS, (_e, format: 'csv' | 'json') => {
    try {
      const connections = networkMonitor.getConnections()
      const userDataPath = app.getPath('userData')
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      let filePath: string
      let content: string
      if (format === 'csv') {
        filePath = path.join(userDataPath, `net-connection-logs-${ts}.csv`)
        const headers = ['ID', 'Process', 'Remote IP', 'Remote Port', 'Protocol', 'State', 'First Seen', 'Last Seen']
        const rows = connections.map((c) => [
          c.id,
          c.processName,
          c.remoteAddress,
          c.remotePort,
          c.protocol,
          c.state,
          new Date(c.firstSeen).toISOString(),
          new Date(c.lastSeen).toISOString(),
        ])
        content = [headers, ...rows].map((r) => r.join(',')).join('\n')
      } else {
        filePath = path.join(userDataPath, `net-connection-logs-${ts}.json`)
        content = JSON.stringify(connections, null, 2)
      }
      fs.writeFileSync(filePath, content, 'utf-8')
      return filePath
    } catch (error) {
      console.error('Failed to export connection logs:', error)
      return null
    }
  })

  ipcMain.handle(IPC.NET_REPORT_GENERATE, () => {
    try {
      const userDataPath = app.getPath('userData')
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const reportPath = path.join(userDataPath, `net-health-report-${ts}.json`)
      const health = networkMonitor.getHealth()
      const outageHistory = networkMonitor.getOutageHistory()
      const connections = networkMonitor.getConnections()
      const report = {
        generatedAt: Date.now(),
        currentHealth: health,
        outageHistory: {
          totalOutages: outageHistory.length,
          resolved: outageHistory.filter((o) => o.resolved).length,
        },
        connections: {
          total: connections.length,
          uniqueIPs: new Set(connections.map((c) => c.remoteAddress)).size,
        },
      }
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
      return reportPath
    } catch (error) {
      console.error('Failed to generate health report:', error)
      return null
    }
  })

  ipcMain.handle(IPC.NET_NOTIFICATION_TEST_EMAIL, async (_e, subject: string, message: string) => {
    try {
      return await notificationService.sendEmailAlert(subject, message)
    } catch (error) {
      console.error('Test email failed:', error)
      return false
    }
  })

  ipcMain.handle(IPC.NET_NOTIFICATION_TEST_SMS, async (_e, message: string) => {
    try {
      return await notificationService.sendSMSAlert(message)
    } catch (error) {
      console.error('Test SMS failed:', error)
      return false
    }
  })

  ipcMain.handle(IPC.NET_BANDWIDTH_GET_SNAPSHOT, () => {
    try {
      return networkMonitor.getBandwidthMonitor().captureSnapshot()
    } catch (error) {
      console.error('Bandwidth snapshot failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_BANDWIDTH_GET_HISTORY, (_e, processName: string, processId: number) => {
    try {
      return networkMonitor.getBandwidthMonitor().getBandwidthHistory(processName, processId)
    } catch (error) {
      console.error('Bandwidth history failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_BANDWIDTH_GET_TOP_USERS, (_e, limit: number = 10) => {
    try {
      return networkMonitor.getBandwidthMonitor().getTopBandwidthUsers(limit)
    } catch (error) {
      console.error('Top bandwidth users failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_BANDWIDTH_GET_TOTAL, () => {
    try {
      return networkMonitor.getBandwidthMonitor().getTotalBandwidth()
    } catch (error) {
      console.error('Total bandwidth failed:', error)
      return { sent: 0, received: 0, total: 0 }
    }
  })

  ipcMain.handle(IPC.NET_QUALITY_GET_SNAPSHOT, () => {
    try {
      return networkMonitor.getQualityMonitor().captureQualitySnapshot()
    } catch (error) {
      console.error('Quality snapshot failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_QUALITY_GET_HISTORY, (_e, remoteAddress: string, remotePort: number) => {
    try {
      return networkMonitor.getQualityMonitor().getQualityHistory(remoteAddress, remotePort)
    } catch (error) {
      console.error('Quality history failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_QUALITY_GET_HEATMAP, () => {
    try {
      return networkMonitor.getQualityMonitor().getQualityHeatmapData()
    } catch (error) {
      console.error('Quality heatmap failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_TRACEROUTE_RUN, async () => {
    try {
      return await networkMonitor.getFaultDetector().performDetailedTraceroute()
    } catch (error) {
      console.error('Traceroute failed:', error)
      return []
    }
  })

  ipcMain.handle(IPC.NET_TOPOLOGY_GET, () => {
    try {
      const connections = networkMonitor.getConnections()
      const nodes = new Map<string, { id: string; label: string; type: string; x?: number; y?: number }>()
      const edges: Array<{ source: string; target: string; latency?: number; quality?: number }> = []
      nodes.set('local', { id: 'local', label: 'Local Machine', type: 'local', x: 50, y: 50 })
      const ipGroups = new Map<string, { count: number; protocols: Set<string> }>()
      for (const conn of connections) {
        if (!ipGroups.has(conn.remoteAddress)) {
          ipGroups.set(conn.remoteAddress, { count: 0, protocols: new Set() })
        }
        ipGroups.get(conn.remoteAddress)!.count++
      }
      let index = 0
      for (const [ip] of ipGroups) {
        const angle = (index / Math.max(ipGroups.size, 1)) * 2 * Math.PI
        const radius = 30 + Math.random() * 20
        nodes.set(ip, {
          id: ip,
          label: ip,
          type: 'remote',
          x: 50 + radius * Math.cos(angle),
          y: 50 + radius * Math.sin(angle),
        })
        edges.push({ source: 'local', target: ip })
        index++
      }
      return { nodes: Array.from(nodes.values()), edges, timestamp: Date.now() }
    } catch (error) {
      console.error('Topology map failed:', error)
      return { nodes: [], edges: [], timestamp: Date.now() }
    }
  })

  /* ------------------------------------------------------------------ */
  /* Cleanup                                                             */
  /* ------------------------------------------------------------------ */

  return () => {
    clearInterval(crossDomainTimer)
    clearInterval(vpnTimer)
    climateMonitor.stop()
    predictionEngine.stop()
    gridMonitor.stop()
    networkMonitor.stop()
  }
}
