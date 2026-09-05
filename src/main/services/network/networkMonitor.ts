import { exec } from 'child_process';
import { NetworkConnection, TrafficDataPoint, ConnectionAlert, NetworkHealth, OutageEvent, BandwidthUsage, ConnectionQuality } from './networkTypes';
import { GeoIPService } from './geoip';
import { FaultDetector } from './faultDetector';
import { BandwidthMonitor } from './bandwidthMonitor';
import { QualityMonitor } from './qualityMonitor';

const isMac = process.platform === 'darwin';

// --- macOS: parse lsof -i -P -n output for network connections ---
// Format: COMMAND   PID  USER  FD  TYPE  DEVICE  SIZE/OFF  NODE NAME
// e.g.:  Chrome    123  user  45u  IPv4  0x123   0t0  TCP 192.168.1.5:52344->142.250.80.46:443 (ESTABLISHED)
const MAC_LSOF_CMD = 'lsof -i -P -n 2>/dev/null';

// --- macOS: parse netstat for listening ports ---
const MAC_NETSTAT_CMD = 'netstat -an -p tcp -p udp 2>/dev/null';

// --- Windows PowerShell scripts (original) ---
const PS_SCRIPT = `
$conns = @()
$tcpConns = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -ne '0.0.0.0' -and $_.RemoteAddress -ne '::' -and $_.RemoteAddress -ne '::1' }
foreach ($conn in $tcpConns) {
    $proc = $null
    try { $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue } catch {}
    $conns += [PSCustomObject]@{
        Protocol = 'TCP'
        LocalAddress = $conn.LocalAddress
        LocalPort = $conn.LocalPort
        RemoteAddress = $conn.RemoteAddress
        RemotePort = $conn.RemotePort
        State = $conn.State
        ProcessId = $conn.OwningProcess
        ProcessName = if ($proc) { $proc.ProcessName } else { 'Unknown' }
    }
}
$udpConns = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -ne '0.0.0.0' -and $_.RemoteAddress -ne '::' }
foreach ($conn in $udpConns) {
    $proc = $null
    try { $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue } catch {}
    $conns += [PSCustomObject]@{
        Protocol = 'UDP'
        LocalAddress = $conn.LocalAddress
        LocalPort = $conn.LocalPort
        RemoteAddress = $conn.RemoteAddress
        RemotePort = 0
        State = 'UDP'
        ProcessId = $conn.OwningProcess
        ProcessName = if ($proc) { $proc.ProcessName } else { 'Unknown' }
    }
}
if ($conns.Count -eq 0) { Write-Output '[]' } else { $conns | ConvertTo-Json -Compress -Depth 2 }
`;

const PS_LISTEN_SCRIPT = `
$ports = @()
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
foreach ($l in $listeners) {
    $ports += [PSCustomObject]@{ Port = $l.LocalPort; Protocol = 'TCP' }
}
$udpListeners = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -ne '::1' -and $_.LocalAddress -ne '127.0.0.1' }
foreach ($u in $udpListeners) {
    $ports += [PSCustomObject]@{ Port = $u.LocalPort; Protocol = 'UDP' }
}
if ($ports.Count -eq 0) { Write-Output '[]' } else { $ports | ConvertTo-Json -Compress -Depth 2 }
`;

export class NetworkMonitor {
  private geoIP: GeoIPService;
  private faultDetector: FaultDetector;
  private connections = new Map<string, NetworkConnection>();
  private interval: NodeJS.Timeout | null = null;
  private onUpdate: (connections: NetworkConnection[]) => void;
  private onTrafficUpdate: (data: TrafficDataPoint) => void;
  private onAlert: (alert: ConnectionAlert) => void;
  private onHealthUpdate: (health: NetworkHealth) => void;
  private onOutage: (outage: OutageEvent) => void;
  private isRunning = false;
  private trafficHistory: TrafficDataPoint[] = [];
  private readonly maxHistoryPoints = 60;
  private knownConnectionIds = new Set<string>();
  private alertCooldowns = new Map<string, number>();
  private whitelistedProcesses = new Set<string>([
    'Toolkit', 'OneDrive', 'OneDriveStandaloneUpdater', 'OneDrive.Sync.Service', 'electron', 'Devin', 'msedge', 'msedgewebview2', 'Idle', 'svchost', 'language_server_windows_x64', 'opera', 'nordvpn-service', 'pwsh', 'remoting_host', 'MpDefenderCoreService', 'SpotifyLauncher', 'gamingservices', 'NordUpdateService',
  ]);
  private snoozedUntil = 0;
  private listeningPorts = new Set<string>();
  private inboundAlertCooldowns = new Map<string, number>();
  private bandwidthMonitor: BandwidthMonitor;
  private qualityMonitor: QualityMonitor;

  constructor(
    geoIP: GeoIPService,
    onUpdate: (connections: NetworkConnection[]) => void,
    onTrafficUpdate: (data: TrafficDataPoint) => void,
    onAlert: (alert: ConnectionAlert) => void,
    onHealthUpdate: (health: NetworkHealth) => void,
    onOutage: (outage: OutageEvent) => void
  ) {
    this.geoIP = geoIP;
    this.onUpdate = onUpdate;
    this.onTrafficUpdate = onTrafficUpdate;
    this.onAlert = onAlert;
    this.onHealthUpdate = onHealthUpdate;
    this.onOutage = onOutage;
    
    this.bandwidthMonitor = new BandwidthMonitor();
    this.qualityMonitor = new QualityMonitor();
    
    this.faultDetector = new FaultDetector(
      onHealthUpdate,
      onOutage
    );
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
    this.interval = setInterval(() => this.poll(), 3000);
    this.faultDetector.start();
  }

  stop() {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.faultDetector.stop();
  }

  private async poll() {
    try {
      const rawConnections = await this.getConnectionsInternal();
      const now = Date.now();

      // Refresh listening ports periodically
      if (this.listeningPorts.size === 0 || now % 10000 < 3000) {
        await this.refreshListeningPorts();
      }

      // Update or add connections
      const newIPs = new Set<string>();
      const newConnections: NetworkConnection[] = [];
      for (const conn of rawConnections) {
        const id = `${conn.protocol}-${conn.localAddress}:${conn.localPort}-${conn.remoteAddress}:${conn.remotePort}`;
        const existing = this.connections.get(id);

        if (existing) {
          existing.lastSeen = now;
          existing.state = conn.state;
          existing.processName = conn.processName;
          
          // Update bandwidth tracking
          this.bandwidthMonitor.updateProcessBandwidth(
            conn.processName,
            conn.processId,
            0, // bytes sent - would need to track this over time
            0  // bytes received - would need to track this over time
          );
        } else {
          const newConn: NetworkConnection = { ...conn, id, firstSeen: now, lastSeen: now };
          this.connections.set(id, newConn);
          if (!isPrivateIP(conn.remoteAddress)) {
            newIPs.add(conn.remoteAddress);
          }
          newConnections.push(newConn);
          
          // Initialize bandwidth tracking for new connection
          this.bandwidthMonitor.updateProcessBandwidth(
            conn.processName,
            conn.processId,
            0,
            0
          );
        }
      }

      // Generate alerts for new connections (after first scan completes)
      if (this.knownConnectionIds.size > 0 && now > this.snoozedUntil) {
        for (const conn of newConnections) {
          if (isPrivateIP(conn.remoteAddress)) continue;
          if (this.whitelistedProcesses.has(conn.processName)) continue;

          // Check if this is an inbound connection (local port is a listening port)
          const listenKey = `${conn.localPort}-${conn.protocol}`;
          const isInbound = this.listeningPorts.has(listenKey) && conn.state === 'Established';

          if (isInbound) {
            const inboundKey = `inbound-${conn.remoteAddress}-${conn.localPort}`;
            const lastInboundAlert = this.inboundAlertCooldowns.get(inboundKey) || 0;
            if (now - lastInboundAlert > 60000) {
              this.inboundAlertCooldowns.set(inboundKey, now);
              this.onAlert({
                id: `${now}-inbound-${inboundKey}`,
                timestamp: now,
                type: 'suspicious',
                processName: conn.processName,
                remoteAddress: conn.remoteAddress,
                remotePort: conn.remotePort,
                protocol: conn.protocol,
                geo: conn.geo,
                message: `INBOUND: ${conn.remoteAddress} connected to your port ${conn.localPort} (${conn.processName})`,
              });
              continue;
            }
          }

          const alertKey = `${conn.processName}-${conn.remoteAddress}`;
          const lastAlert = this.alertCooldowns.get(alertKey) || 0;
          if (now - lastAlert > 30000) {
            this.alertCooldowns.set(alertKey, now);
            this.onAlert({
              id: `${now}-${alertKey}`,
              timestamp: now,
              type: 'new_connection',
              processName: conn.processName,
              remoteAddress: conn.remoteAddress,
              remotePort: conn.remotePort,
              protocol: conn.protocol,
              geo: conn.geo,
              message: `${conn.processName} connected to ${conn.remoteAddress}:${conn.remotePort}`,
            });
          }
        }
      }
      // Mark all current connections as known
      for (const id of this.connections.keys()) {
        this.knownConnectionIds.add(id);
      }

      // Remove stale connections (not seen in last 15 seconds)
      const staleThreshold = now - 15000;
      for (const [id, conn] of this.connections.entries()) {
        if (conn.lastSeen < staleThreshold) {
          this.connections.delete(id);
        }
      }

      // Lookup GeoIP for new IPs in batch
      if (newIPs.size > 0) {
        const geoResults = await this.geoIP.lookupBatch(Array.from(newIPs));
        for (const [ip, geo] of geoResults.entries()) {
          if (geo) {
            for (const conn of this.connections.values()) {
              if (conn.remoteAddress === ip && !conn.geo) {
                conn.geo = geo;
              }
            }
          }
        }
      }

      // Record traffic data point
      const established = Array.from(this.connections.values()).filter(c => c.state === 'Established').length;
      const dataPoint: TrafficDataPoint = {
        timestamp: now,
        totalConnections: this.connections.size,
        activeConnections: established,
        newConnections: newConnections.length,
      };
      this.trafficHistory.push(dataPoint);
      if (this.trafficHistory.length > this.maxHistoryPoints) {
        this.trafficHistory.shift();
      }
      this.onTrafficUpdate(dataPoint);

      this.onUpdate(Array.from(this.connections.values()));
    } catch (e) {
      console.error('Network monitor poll error:', e);
    }
  }

  getTrafficHistory(): TrafficDataPoint[] {
    return [...this.trafficHistory];
  }

  private async refreshListeningPorts(): Promise<void> {
    if (isMac) {
      return this.refreshListeningPortsMac();
    }
    return new Promise((resolve) => {
      const encoded = Buffer.from(PS_LISTEN_SCRIPT, 'utf16le').toString('base64');
      exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { maxBuffer: 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve();
            return;
          }
          try {
            const ports: { Port: number; Protocol: string }[] = JSON.parse(stdout.trim());
            this.listeningPorts.clear();
            for (const p of ports) {
              this.listeningPorts.add(`${p.Port}-${p.Protocol}`);
            }
          } catch {
            // ignore parse errors
          }
          resolve();
        }
      );
    });
  }

  private async refreshListeningPortsMac(): Promise<void> {
    return new Promise((resolve) => {
      exec(
        MAC_NETSTAT_CMD,
        { maxBuffer: 1024 * 1024, timeout: 5000 },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve();
            return;
          }
          this.listeningPorts.clear();
          const lines = stdout.split('\n');
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 4) continue;
            const proto = parts[0].toUpperCase();
            // TCP: tcp4 0 0  *.8080  *.*  LISTEN
            // UDP: udp4 0 0  *.123  *.*
            if (proto === 'TCP4' || proto === 'TCP6' || proto === 'TCP') {
              const state = parts[parts.length - 1];
              if (state !== 'LISTEN') continue;
              const local = parts[3] || parts[1] || '';
              const portMatch = local.match(/\.(\d+)$/);
              if (portMatch) {
                this.listeningPorts.add(`${portMatch[1]}-TCP`);
              }
            } else if (proto === 'UDP4' || proto === 'UDP6' || proto === 'UDP') {
              const local = parts[3] || parts[1] || '';
              const portMatch = local.match(/\.(\d+)$/);
              if (portMatch) {
                this.listeningPorts.add(`${portMatch[1]}-UDP`);
              }
            }
          }
          resolve();
        }
      );
    });
  }

  whitelistProcess(processName: string) {
    this.whitelistedProcesses.add(processName);
  }

  unwhitelistProcess(processName: string) {
    this.whitelistedProcesses.delete(processName);
  }

  getWhitelistedProcesses(): string[] {
    return Array.from(this.whitelistedProcesses);
  }

  setSnooze(durationMs: number) {
    this.snoozedUntil = durationMs > 0 ? Date.now() + durationMs : 0;
  }

  isSnoozed(): boolean {
    return Date.now() < this.snoozedUntil;
  }

  getConnections(): NetworkConnection[] {
    return Array.from(this.connections.values());
  }

  getFaultDetector() {
    return this.faultDetector;
  }

  getHealth() {
    return this.faultDetector.getCurrentHealth();
  }

  getBandwidthMonitor() {
    return this.bandwidthMonitor;
  }

  getQualityMonitor() {
    return this.qualityMonitor;
  }

  private getConnectionsInternal(): Promise<Omit<NetworkConnection, 'id' | 'firstSeen' | 'lastSeen'>[]> {
    if (isMac) {
      return this.getConnectionsMac();
    }
    return new Promise((resolve) => {
      // Use base64 encoding to avoid all escaping issues with PowerShell
      const encodedScript = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

      exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encodedScript}`,
        { maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve([]);
            return;
          }

          try {
            let data = stdout.trim();
            if (data === '') {
              resolve([]);
              return;
            }
            const parsed = JSON.parse(data);
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            const connections = arr.map((c: any) => ({
              protocol: c.Protocol as 'TCP' | 'UDP',
              localAddress: c.LocalAddress,
              localPort: c.LocalPort,
              remoteAddress: c.RemoteAddress,
              remotePort: c.RemotePort,
              state: c.State,
              processId: c.ProcessId,
              processName: c.ProcessName,
            }));
            resolve(connections);
          } catch (e) {
            resolve([]);
          }
        }
      );
    });
  }

  private getConnectionsMac(): Promise<Omit<NetworkConnection, 'id' | 'firstSeen' | 'lastSeen'>[]> {
    return new Promise((resolve) => {
      exec(
        MAC_LSOF_CMD,
        { maxBuffer: 10 * 1024 * 1024, timeout: 5000 },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve([]);
            return;
          }

          const connections: Omit<NetworkConnection, 'id' | 'firstSeen' | 'lastSeen'>[] = [];
          const lines = stdout.split('\n');
          // Skip header line
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) continue;

            const command = parts[0];
            const pid = parseInt(parts[1], 10) || 0;
            const type = parts[4] || parts[3]; // IPv4 or IPv6
            const nameIdx = parts.findIndex(p => p === 'TCP' || p === 'UDP');
            if (nameIdx === -1) continue;
            const proto = parts[nameIdx];
            const nameField = parts.slice(nameIdx + 1).join(' ');

            // Parse: local->remote (state) or local->remote
            // e.g. 192.168.1.5:52344->142.250.80.46:443 (ESTABLISHED)
            // e.g. *:8080 (LISTEN)
            const arrowMatch = nameField.match(/^(.+?)->(.+?)(?:\s+\((\w+)\))?$/);
            const listenMatch = nameField.match(/^(.+?)(?:\s+\((\w+)\))?$/);

            let localAddr = '';
            let localPort = 0;
            let remoteAddr = '';
            let remotePort = 0;
            let state = '';

            if (arrowMatch) {
              const local = arrowMatch[1];
              const remote = arrowMatch[2];
              state = arrowMatch[3] || '';
              const localParts = local.split(':');
              const remoteParts = remote.split(':');
              localPort = parseInt(localParts[localParts.length - 1], 10) || 0;
              localAddr = localParts.slice(0, -1).join(':');
              remotePort = parseInt(remoteParts[remoteParts.length - 1], 10) || 0;
              remoteAddr = remoteParts.slice(0, -1).join(':');
            } else if (listenMatch) {
              const local = listenMatch[1];
              state = listenMatch[2] || '';
              const localParts = local.split(':');
              localPort = parseInt(localParts[localParts.length - 1], 10) || 0;
              localAddr = localParts.slice(0, -1).join(':');
              remoteAddr = '*';
              remotePort = 0;
            } else {
              continue;
            }

            // Skip local-only and wildcard-only connections with no remote
            if (proto === 'TCP' && !remoteAddr && state !== 'LISTEN') continue;
            if (remoteAddr === '*' || remoteAddr === '') continue;
            if (remoteAddr === '0.0.0.0' || remoteAddr === '::' || remoteAddr === '::1') continue;
            if (remoteAddr.startsWith('127.') || remoteAddr.startsWith('localhost')) continue;

            connections.push({
              protocol: proto as 'TCP' | 'UDP',
              localAddress: localAddr,
              localPort,
              remoteAddress: remoteAddr,
              remotePort,
              state: state || (proto === 'UDP' ? 'UDP' : 'UNKNOWN'),
              processId: pid,
              processName: command,
            });
          }

          resolve(connections);
        }
      );
    });
  }

  getStats(connections: NetworkConnection[]) {
    const countries = new Set<string>();
    const ips = new Set<string>();
    const processCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();

    for (const conn of connections) {
      if (conn.geo) {
        countries.add(conn.geo.country);
        countryCounts.set(conn.geo.country, (countryCounts.get(conn.geo.country) || 0) + 1);
      }
      ips.add(conn.remoteAddress);
      processCounts.set(conn.processName, (processCounts.get(conn.processName) || 0) + 1);
    }

    const topProcesses = Array.from(processCounts.entries())
      .map(([name, connections]) => ({ name, connections }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 10);

    const topCountries = Array.from(countryCounts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalConnections: connections.length,
      activeConnections: connections.filter((c) => c.state === 'Established').length,
      uniqueCountries: countries.size,
      uniqueIPs: ips.size,
      totalBytesSent: 0,
      totalBytesReceived: 0,
      topProcesses,
      topCountries,
    };
  }

  getNetworkHealth(): NetworkHealth {
    return this.faultDetector.getCurrentHealth();
  }

  getOutageHistory(): OutageEvent[] {
    return this.faultDetector.getOutageHistory();
  }

  getActiveOutage(): OutageEvent | null {
    return this.faultDetector.getActiveOutage();
  }
}

function isPrivateIP(ip: string | null | undefined): boolean {
  if (!ip || typeof ip !== 'string') return true;
  if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) return true;
  if (ip.startsWith('fe80:')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (ip.includes(':') && !ip.includes('.')) return true;
  return false;
}
