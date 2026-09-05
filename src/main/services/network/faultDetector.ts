import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app, Notification } from 'electron';
import { NetworkHealth, OutageEvent, FaultDetectionConfig, NetworkMedium, MediumThresholds, DetectionMethod, MediumDetection, TracerouteHop } from './networkTypes';

// Rate limiter for external API calls
class RateLimiter {
  private lastCall = 0;
  private minInterval: number;

  constructor(minIntervalMs: number) {
    this.minInterval = minIntervalMs;
  }

  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minInterval - elapsed));
    }
    this.lastCall = Date.now();
  }
}

// Sanitize strings for PowerShell to prevent injection
function sanitizePowerShellString(str: string): string {
  // Remove potentially dangerous characters
  return str.replace(/[;&|`$(){}[\]<>]/g, '');
}

// Retry with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

const DEFAULT_CONFIG: FaultDetectionConfig = {
  checkInterval: 5000,
  latencyThreshold: 100,
  packetLossThreshold: 5,
  consecutiveFailures: 3,
  testHosts: ['8.8.8.8', '1.1.1.1', 'google.com', 'cloudflare.com'],
  dnsServers: ['8.8.8.8', '1.1.1.1'],
};

const MEDIUM_THRESHOLDS: Record<NetworkMedium, MediumThresholds> = {
  fiber: {
    latencyThreshold: 30,
    packetLossThreshold: 2,
    expectedLatencyRange: { min: 1, max: 20 },
  },
  copper: {
    latencyThreshold: 100,
    packetLossThreshold: 5,
    expectedLatencyRange: { min: 5, max: 50 },
  },
  wireless: {
    latencyThreshold: 150,
    packetLossThreshold: 8,
    expectedLatencyRange: { min: 10, max: 100 },
  },
  unknown: {
    latencyThreshold: 100,
    packetLossThreshold: 5,
    expectedLatencyRange: { min: 1, max: 100 },
  },
};

export class FaultDetector {
  private config: FaultDetectionConfig;
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private onHealthUpdate: (health: NetworkHealth) => void;
  private onOutage: (outage: OutageEvent) => void;
  private currentHealth: NetworkHealth;
  private consecutiveFailures = 0;
  private activeOutage: OutageEvent | null = null;
  private outageHistory: OutageEvent[] = [];
  private latencyHistory: number[] = [];
  private readonly outageHistoryPath: string;
  private readonly maxLatencyHistory = 30;
  private inferredMedium: NetworkMedium = 'unknown';
  private mediumConfidence = 0;
  private readonly minSamplesForInference = 15;
  private healthHistory: NetworkHealth[] = [];
  private readonly maxHealthHistoryPoints = 10080; // 7 days at 1-minute intervals
  private detectionMethod: DetectionMethod = 'hybrid';
  private adapterInfo: { name: string; speed: number; mediaType?: string } | null = null;
  private ispInfo: { name: string; asn: string } | null = null;
  private lastTraceroute: string | null = null;
  private lastAdapterCheck = 0;
  private readonly adapterCheckInterval = 30000; // Check for adapter changes every 30s
  private apiRateLimiter = new RateLimiter(1000); // Max 1 API call per second
  private readonly isMac = process.platform === 'darwin';

  constructor(
    onHealthUpdate: (health: NetworkHealth) => void,
    onOutage: (outage: OutageEvent) => void,
    config?: Partial<FaultDetectionConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onHealthUpdate = onHealthUpdate;
    this.onOutage = onOutage;
    this.currentHealth = this.getInitialHealth();
    
    // Set up outage history file path
    const userDataPath = app.getPath('userData');
    this.outageHistoryPath = path.join(userDataPath, 'outage-history.json');
    
    // Load outage history from disk
    this.loadOutageHistory();
  }

  getConfig(): FaultDetectionConfig {
    return { ...this.config };
  }

  private getInitialHealth(): NetworkHealth {
    return {
      status: 'offline',
      connectivityScore: 0,
      latency: 0,
      packetLoss: 0,
      lastCheck: Date.now(),
      dnsResolution: false,
      internetAccess: false,
      localNetwork: false,
    };
  }

  private loadOutageHistory() {
    try {
      if (fs.existsSync(this.outageHistoryPath)) {
        const data = fs.readFileSync(this.outageHistoryPath, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.outageHistory = parsed;
        }
      }
    } catch (error) {
      console.error('Failed to load outage history:', error);
    }
  }

  private saveOutageHistory() {
    try {
      fs.writeFileSync(this.outageHistoryPath, JSON.stringify(this.outageHistory, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save outage history:', error);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.check();
    this.interval = setInterval(() => this.check(), this.config.checkInterval);
    this.detectAdapterInfo();
    this.detectISPInfo();
  }

  stop() {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async detectAdapterInfo() {
    if (this.isMac) {
      return this.detectAdapterInfoMac();
    }
    return this.detectAdapterInfoWindows();
  }

  private async detectAdapterInfoMac() {
    return retryWithBackoff(async () => {
      return new Promise<void>((resolve) => {
        exec(
          'networksetup -listallhardwareports',
          { timeout: 5000 },
          (error, stdout) => {
            if (error || !stdout.trim()) {
              resolve();
              return;
            }
            try {
              const lines = stdout.split('\n');
              let name = '';
              let device = '';
              let mediaType = '';
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('Hardware Port:')) {
                  name = lines[i].replace('Hardware Port:', '').trim();
                } else if (lines[i].startsWith('Device:')) {
                  device = lines[i].replace('Device:', '').trim();
                  if (device && name) {
                    if (/wi-?fi|airport|wlan/i.test(name)) {
                      mediaType = '802.11 (Wi-Fi)';
                    } else if (/ethernet|thunderbolt|usb/i.test(name)) {
                      mediaType = '802.3 (Ethernet)';
                    } else {
                      mediaType = name;
                    }
                    break;
                  }
                }
              }
              if (name) {
                let speed = 0;
                if (device) {
                  try {
                    const ifconfigOut = require('child_process').execSync(
                      `ifconfig ${device} 2>/dev/null`,
                      { timeout: 3000, encoding: 'utf-8' }
                    );
                    const mediaMatch = ifconfigOut.match(/media:\s*(\S+)/);
                    if (mediaMatch) mediaType = mediaMatch[1];
                  } catch { /* ignore */ }
                }
                this.adapterInfo = { name, speed, mediaType };
              }
            } catch {
              // ignore parse errors
            }
            resolve();
          }
        );
      });
    }, 2, 500).catch(() => {
      // Silently fail on retry exhaustion
    });
  }

  private async detectAdapterInfoWindows() {
    const PS_ADAPTER_SCRIPT = `
    $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
    if ($adapter) {
      [PSCustomObject]@{
        Name = $adapter.Name
        Description = $adapter.InterfaceDescription
        Speed = $adapter.LinkSpeed
        MediaType = $adapter.MediaType
      }
    } else {
      $null
    }
    `;

    return retryWithBackoff(async () => {
      return new Promise<void>((resolve, reject) => {
        const encoded = Buffer.from(PS_ADAPTER_SCRIPT, 'utf16le').toString('base64');
        exec(
          `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
          { windowsHide: true },
          (error, stdout) => {
            if (error || !stdout.trim()) {
              if (error) reject(error);
              else resolve();
              return;
            }
            try {
              const data = JSON.parse(stdout.trim());
              if (data) {
                this.adapterInfo = {
                  name: data.Name,
                  speed: this.parseSpeed(data.Speed),
                  mediaType: data.MediaType,
                };
              }
            } catch {
              // ignore parse errors
            }
            resolve();
          }
        );
      });
    }, 2, 500).catch(() => {
      // Silently fail on retry exhaustion
    });
  }

  private parseSpeed(speedStr: string): number {
    // Parse "1 Gbps" or "100 Mbps" to Mbps
    const match = speedStr.match(/(\d+)\s*(G|M)?bps/i);
    if (!match) return 0;
    const value = parseInt(match[1], 10);
    const unit = match[2]?.toUpperCase();
    if (unit === 'G') return value * 1000;
    return value;
  }

  private async detectISPInfo() {
    await this.apiRateLimiter.throttle();

    if (this.isMac) {
      return new Promise<void>((resolve) => {
        exec(
          'curl -s --max-time 10 https://ip-api.com/json/',
          { timeout: 12000 },
          (error, stdout) => {
            if (error || !stdout.trim()) {
              resolve();
              return;
            }
            try {
              const data = JSON.parse(stdout.trim());
              if (data && data.isp) {
                this.ispInfo = {
                  name: data.isp,
                  asn: data.as || '',
                };
              }
            } catch {
              // ignore parse errors
            }
            resolve();
          }
        );
      });
    }

    return new Promise<void>((resolve) => {
      exec(
        'powershell -NoProfile -NonInteractive -Command "(Invoke-RestMethod -Uri \'https://ip-api.com/json/\').isp, (Invoke-RestMethod -Uri \'https://ip-api.com/json/\').as"',
        { windowsHide: true, timeout: 10000 },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve();
            return;
          }
          try {
            const parts = stdout.trim().split('\n');
            if (parts.length >= 2) {
              this.ispInfo = {
                name: parts[0].trim(),
                asn: parts[1].trim(),
              };
            }
          } catch {
            // ignore parse errors
          }
          resolve();
        }
      );
    });
  }

  private async performTraceroute(): Promise<string> {
    if (this.isMac) {
      return new Promise((resolve) => {
        exec(
          'traceroute -m 10 -w 2 8.8.8.8',
          { timeout: 15000 },
          (error, stdout) => {
            if (error || !stdout.trim()) {
              resolve('unknown');
              return;
            }
            const lines = stdout.trim().split('\n').filter(line => line.trim());
            const lastLine = lines[lines.length - 1]?.trim() || 'unknown';
            const ipMatch = lastLine.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
            const lastHop = ipMatch ? ipMatch[1] : lastLine;
            this.lastTraceroute = lastHop;
            resolve(lastHop);
          }
        );
      });
    }

    const PS_TRACEROUTE_SCRIPT = `
    Test-NetConnection -ComputerName 8.8.8.8 -TraceRoute -Hops 10 | Select-Object -ExpandProperty TraceRoute | Select-Object -First 10 | ForEach-Object { $_ }
    `;

    return new Promise((resolve) => {
      const encoded = Buffer.from(PS_TRACEROUTE_SCRIPT, 'utf16le').toString('base64');
      exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { windowsHide: true, timeout: 10000 },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve('unknown');
            return;
          }
          const hops = stdout.trim().split('\n').filter(line => line.trim());
          const lastHop = hops[hops.length - 1]?.trim() || 'unknown';
          this.lastTraceroute = lastHop;
          resolve(lastHop);
        }
      );
    });
  }

  async performDetailedTraceroute(): Promise<TracerouteHop[]> {
    const hops: TracerouteHop[] = [];
    const target = '8.8.8.8';
    const maxHops = 10;
    const attemptsPerHop = 3;

    for (let hop = 1; hop <= maxHops; hop++) {
      const hopResults: number[] = [];
      
      for (let attempt = 0; attempt < attemptsPerHop; attempt++) {
        const latency = await this.pingHop(target, hop);
        if (latency > 0) {
          hopResults.push(latency);
        }
      }

      if (hopResults.length > 0) {
        const avgLatency = hopResults.reduce((a, b) => a + b, 0) / hopResults.length;
        const packetLoss = ((attemptsPerHop - hopResults.length) / attemptsPerHop) * 100;
        
        hops.push({
          hopNumber: hop,
          ipAddress: `hop-${hop}`,
          latency: Math.round(avgLatency),
          packetLoss: Math.round(packetLoss * 10) / 10,
          attempts: attemptsPerHop,
        });
      } else {
        hops.push({
          hopNumber: hop,
          ipAddress: '*',
          latency: 0,
          packetLoss: 100,
          attempts: attemptsPerHop,
        });
      }
    }

    return hops;
  }

  private async pingHop(target: string, ttl: number): Promise<number> {
    const cmd = this.isMac
      ? `ping -c 1 -m ${ttl} -W 2000 ${target}`
      : `ping -n 1 -i ${ttl} ${target}`;
    const opts = this.isMac ? { timeout: 3000 } : { windowsHide: true, timeout: 2000 };

    return new Promise((resolve) => {
      exec(cmd, opts, (error, stdout) => {
        if (error) {
          resolve(0);
          return;
        }

        const match = stdout.match(/time[=<](\d+\.?\d*)\s*ms/i);
        if (match) {
          resolve(Math.round(parseFloat(match[1])));
        } else {
          resolve(0);
        }
      });
    });
  }

  private async checkForAdapterChanges() {
    if (this.isMac) {
      return this.detectAdapterInfoMac();
    }

    const PS_ADAPTER_SCRIPT = `
    $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
    if ($adapter) {
      [PSCustomObject]@{
        Name = $adapter.Name
        Description = $adapter.InterfaceDescription
        Speed = $adapter.LinkSpeed
        MediaType = $adapter.MediaType
      }
    } else {
      $null
    }
    `;

    return new Promise<void>((resolve) => {
      const encoded = Buffer.from(PS_ADAPTER_SCRIPT, 'utf16le').toString('base64');
      exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { windowsHide: true },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve();
            return;
          }
          try {
            const data = JSON.parse(stdout.trim());
            if (data) {
              const newAdapter = {
                name: data.Name,
                speed: this.parseSpeed(data.Speed),
                mediaType: data.MediaType,
              };

              // Check if adapter changed
              if (!this.adapterInfo || 
                  this.adapterInfo.name !== newAdapter.name || 
                  this.adapterInfo.speed !== newAdapter.speed) {
                console.log('Network adapter changed, re-detecting info');
                this.adapterInfo = newAdapter;
                
                // Reset detection state for new adapter
                this.inferredMedium = 'unknown';
                this.mediumConfidence = 0;
                this.latencyHistory = [];
                
                // Re-detect ISP info
                this.detectISPInfo();
              }
            }
          } catch {
            // ignore parse errors
          }
          resolve();
        }
      );
    });
  }

  private async check() {
    try {
      // Periodically check for adapter changes
      const now = Date.now();
      if (now - this.lastAdapterCheck > this.adapterCheckInterval) {
        await this.checkForAdapterChanges();
        this.lastAdapterCheck = now;
      }

      const results = await Promise.allSettled([
        this.checkLocalNetwork(),
        this.checkDNS(),
        this.checkInternetConnectivity(),
        this.measureLatency(),
      ]);

      const localNetwork = results[0].status === 'fulfilled' ? results[0].value : false;
      const dnsResolution = results[1].status === 'fulfilled' ? results[1].value : false;
      const internetAccess = results[2].status === 'fulfilled' ? results[2].value : false;
      const latency = results[3].status === 'fulfilled' ? results[3].value : 0;

      // Update latency history
      this.latencyHistory.push(latency);
      if (this.latencyHistory.length > this.maxLatencyHistory) {
        this.latencyHistory.shift();
      }

      const avgLatency = this.averageLatency();
      const packetLoss = this.estimatePacketLoss();
      const latencyVariance = this.calculateLatencyVariance();
      const inferredMedium = this.inferNetworkMedium(avgLatency, latencyVariance);

      // Determine health status
      const health: NetworkHealth = {
        status: this.determineStatus(localNetwork, dnsResolution, internetAccess, avgLatency, packetLoss),
        connectivityScore: this.calculateConnectivityScore(localNetwork, dnsResolution, internetAccess, avgLatency, packetLoss),
        latency: avgLatency,
        packetLoss,
        lastCheck: Date.now(),
        dnsResolution,
        internetAccess,
        localNetwork,
        inferredMedium,
        latencyVariance,
        detectionMethod: this.detectionMethod,
        detectionConfidence: this.mediumConfidence,
      };

      this.currentHealth = health;
      this.onHealthUpdate(health);

      // Save to health history for historical analysis
      this.healthHistory.push(health);
      if (this.healthHistory.length > this.maxHealthHistoryPoints) {
        this.healthHistory.shift();
      }

      // Check for outages
      this.detectOutages(health);

      // Reset consecutive failures on success
      if (health.status !== 'offline') {
        this.consecutiveFailures = 0;
      } else {
        this.consecutiveFailures++;
      }
    } catch (error) {
      console.error('Fault detection check error:', error);
      this.consecutiveFailures++;
      
      if (this.consecutiveFailures >= this.config.consecutiveFailures && !this.activeOutage) {
        this.triggerOutage('internet', 'critical', 'Network connectivity lost');
      }
    }
  }

  private async checkLocalNetwork(): Promise<boolean> {
    const cmd = this.isMac ? 'ping -c 1 -t 1 127.0.0.1' : 'ping -n 1 -w 1000 127.0.0.1';
    const opts = this.isMac ? { timeout: 2000 } : { windowsHide: true };
    return new Promise((resolve) => {
      exec(cmd, opts, (error) => {
        resolve(!error);
      });
    });
  }

  private async checkDNS(): Promise<boolean> {
    const dnsServer = this.config.dnsServers[0];
    const opts = this.isMac ? { timeout: 3000 } : { windowsHide: true, timeout: 3000 };
    return new Promise((resolve) => {
      exec(`nslookup google.com ${dnsServer}`, opts, (error) => {
        resolve(!error);
      });
    });
  }

  private async checkInternetConnectivity(): Promise<boolean> {
    const testHost = this.config.testHosts[0];
    const cmd = this.isMac ? `ping -c 1 -t 2 ${testHost}` : `ping -n 1 -w 2000 ${testHost}`;
    const opts = this.isMac ? { timeout: 3000 } : { windowsHide: true };
    return new Promise((resolve) => {
      exec(cmd, opts, (error) => {
        resolve(!error);
      });
    });
  }

  setTestHosts(hosts: string[]) {
    if (hosts && hosts.length > 0) {
      this.config.testHosts = hosts;
    }
  }

  getTestHosts(): string[] {
    return [...this.config.testHosts];
  }

  setDetectionMethodWeights(weights: { statistical: number; adapter: number; speed: number; name: number }) {
    // Store weights for use in combineDetections
    // This would require modifying the combineDetections method to use these weights
    // For now, we'll store them and they can be applied in future enhancements
  }

  getDetectionMethodWeights(): { statistical: number; adapter: number; speed: number; name: number } {
    // Return default weights
    return {
      statistical: 1.0,
      adapter: 1.5,
      speed: 1.2,
      name: 0.8,
    };
  }

  private async measureLatency(): Promise<number> {
    const testHost = this.config.testHosts[0];
    const cmd = this.isMac ? `ping -c 1 ${testHost}` : `ping -n 1 ${testHost}`;
    const opts = this.isMac ? { timeout: 3000 } : { windowsHide: true, timeout: 3000 };
    return new Promise((resolve) => {
      exec(cmd, opts, (error, stdout) => {
        if (error) {
          resolve(0);
          return;
        }
        
        const match = stdout.match(/time[=<](\d+\.?\d*)\s*ms/i);
        if (match) {
          resolve(Math.round(parseFloat(match[1])));
        } else {
          resolve(0);
        }
      });
    });
  }

  private averageLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    const validLatencies = this.latencyHistory.filter(l => l > 0);
    if (validLatencies.length === 0) return 0;
    return validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length;
  }

  private calculateLatencyVariance(): number {
    if (this.latencyHistory.length === 0) return 0;
    const validLatencies = this.latencyHistory.filter(l => l > 0);
    if (validLatencies.length < 2) return 0;
    
    // Use a rolling window of the most recent 20 samples for more responsive jitter
    const recentHistory = validLatencies.slice(-20);
    
    // Calculate inter-arrival jitter (difference between consecutive pings)
    const interArrivals: number[] = [];
    for (let i = 1; i < recentHistory.length; i++) {
      interArrivals.push(Math.abs(recentHistory[i] - recentHistory[i - 1]));
    }
    
    // Calculate mean inter-arrival jitter
    const meanInterArrival = interArrivals.reduce((a, b) => a + b, 0) / interArrivals.length;
    
    // Calculate standard deviation of latency (traditional jitter)
    const avg = this.averageLatency();
    const squaredDiffs = recentHistory.map(l => Math.pow(l - avg, 2));
    const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length);
    
    // Combine both metrics for a more comprehensive jitter score
    // Weight inter-arrival jitter higher as it's more sensitive to network instability
    return Math.round((meanInterArrival * 0.7 + stdDev * 0.3));
  }

  private estimatePacketLoss(): number {
    if (this.latencyHistory.length === 0) return 0;
    const failures = this.latencyHistory.filter(l => l === 0).length;
    return (failures / this.latencyHistory.length) * 100;
  }

  private inferNetworkMedium(avgLatency: number, variance: number): NetworkMedium {
    const detections: MediumDetection[] = [];

    // Method 1: Statistical (latency/jitter)
    const statistical = this.detectByStatistics(avgLatency, variance);
    if (statistical) detections.push(statistical);

    // Method 2: Adapter media type (Windows)
    const adapter = this.detectByAdapter();
    if (adapter) detections.push(adapter);

    // Method 3: Speed-based inference
    const speed = this.detectBySpeed();
    if (speed) detections.push(speed);

    // Method 4: Adapter name parsing
    const name = this.detectByName();
    if (name) detections.push(name);

    // Hybrid: Weight all detections
    return this.combineDetections(detections);
  }

  private detectByStatistics(avgLatency: number, variance: number): MediumDetection | null {
    if (this.latencyHistory.length < this.minSamplesForInference) {
      return null;
    }

    const validLatencies = this.latencyHistory.filter(l => l > 0);
    if (validLatencies.length < this.minSamplesForInference) {
      return null;
    }

    let medium: NetworkMedium = 'unknown';
    let confidence = 0;

    // Fiber characteristics: very low latency, very low variance (jitter)
    if (avgLatency <= 15 && variance <= 5) {
      medium = 'fiber';
      confidence = 85;
    }
    // Copper characteristics: moderate latency, moderate variance
    else if (avgLatency >= 10 && avgLatency <= 60 && variance <= 20) {
      medium = 'copper';
      confidence = 75;
    }
    // Wireless characteristics: higher latency, higher variance (jitter spikes)
    else if (avgLatency >= 20 && variance >= 15) {
      medium = 'wireless';
      confidence = 80;
    }

    if (medium === 'unknown') return null;

    return {
      medium,
      method: 'statistical',
      confidence,
      details: `Latency: ${avgLatency.toFixed(1)}ms, Jitter: ${variance.toFixed(1)}ms`,
    };
  }

  private detectByAdapter(): MediumDetection | null {
    if (!this.adapterInfo?.mediaType) return null;

    const mediaType = this.adapterInfo.mediaType.toLowerCase();
    let medium: NetworkMedium = 'unknown';

    if (mediaType.includes('fiber') || mediaType.includes('optical') || mediaType.includes('802.3')) {
      medium = 'fiber';
    } else if (mediaType.includes('wireless') || mediaType.includes('wi-fi') || mediaType.includes('802.11')) {
      medium = 'wireless';
    } else if (mediaType.includes('ethernet') || mediaType.includes('802.3')) {
      medium = 'copper';
    }

    if (medium === 'unknown') return null;

    return {
      medium,
      method: 'adapter',
      confidence: 95, // High confidence from OS
      details: `Adapter: ${this.adapterInfo.name}, MediaType: ${this.adapterInfo.mediaType}`,
    };
  }

  private detectBySpeed(): MediumDetection | null {
    if (!this.adapterInfo?.speed) return null;

    const speed = this.adapterInfo.speed;
    let medium: NetworkMedium = 'unknown';
    let confidence = 60;

    if (speed >= 10000) {
      // 10Gbps+ likely fiber
      medium = 'fiber';
      confidence = 70;
    } else if (speed >= 1000) {
      // 1Gbps could be fiber or copper
      medium = 'copper';
      confidence = 50;
    } else if (speed <= 300) {
      // Lower speeds typically wireless or older copper
      medium = 'wireless';
      confidence = 55;
    }

    if (medium === 'unknown') return null;

    return {
      medium,
      method: 'speed',
      confidence,
      details: `Link speed: ${speed}Mbps`,
    };
  }

  private detectByName(): MediumDetection | null {
    if (!this.adapterInfo?.name) return null;

    const name = this.adapterInfo.name.toLowerCase();
    const description = this.adapterInfo.name.toLowerCase();
    let medium: NetworkMedium = 'unknown';
    let confidence = 65;

    // Check for mobile hotspot specifically
    if (name.includes('mobile') || name.includes('hotspot') || name.includes('cellular') ||
        name.includes('lte') || name.includes('5g') || name.includes('4g') ||
        description.includes('mobile') || description.includes('hotspot') || description.includes('cellular')) {
      medium = 'wireless';
      confidence = 95; // High confidence for mobile hotspot
    }
    // Check for regular Wi-Fi
    else if (name.includes('wi-fi') || name.includes('wifi') || name.includes('wireless') ||
        description.includes('wi-fi') || description.includes('wifi') || description.includes('wireless')) {
      medium = 'wireless';
      confidence = 80;
    } else if (name.includes('fiber') || name.includes('optical') || name.includes('sfp') ||
               description.includes('fiber') || description.includes('optical') || description.includes('sfp')) {
      medium = 'fiber';
      confidence = 85;
    } else if (name.includes('ethernet') || name.includes('eth') || name.includes('lan')) {
      medium = 'copper';
      confidence = 60;
    }

    if (medium === 'unknown') return null;

    return {
      medium,
      method: 'name',
      confidence,
      details: `Adapter name: ${this.adapterInfo.name}`,
    };
  }

  private combineDetections(detections: MediumDetection[]): NetworkMedium {
    if (detections.length === 0) return 'unknown';

    // Weight by method reliability
    const weights: Record<DetectionMethod, number> = {
      adapter: 0.4,    // OS detection is most reliable
      statistical: 0.3, // Statistical analysis is good
      name: 0.2,       // Name parsing is moderate
      speed: 0.1,      // Speed is least reliable alone
      hybrid: 0.5,     // Combined is best
    };

    const scores: Record<NetworkMedium, number> = {
      fiber: 0,
      copper: 0,
      wireless: 0,
      unknown: 0,
    };

    for (const detection of detections) {
      const weight = weights[detection.method] || 0.25;
      const weightedScore = (detection.confidence / 100) * weight;
      scores[detection.medium] += weightedScore;
    }

    // Find highest scoring medium
    let bestMedium: NetworkMedium = 'unknown';
    let bestScore = 0;

    for (const [medium, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestMedium = medium as NetworkMedium;
      }
    }

    // Use the highest individual confidence from detections matching the chosen medium
    const matchingDetections = detections.filter(d => d.medium === bestMedium);
    const highestConfidence = matchingDetections.length > 0 
      ? Math.max(...matchingDetections.map(d => d.confidence))
      : 0;

    this.mediumConfidence = highestConfidence;
    this.inferredMedium = bestMedium;

    // Determine primary detection method for UI
    if (detections.find(d => d.method === 'adapter')) {
      this.detectionMethod = 'adapter';
    } else if (detections.find(d => d.method === 'statistical')) {
      this.detectionMethod = 'statistical';
    } else if (detections.length > 1) {
      this.detectionMethod = 'hybrid';
    } else {
      this.detectionMethod = detections[0]?.method || 'statistical';
    }

    return this.mediumConfidence >= 30 ? bestMedium : 'unknown';
  }

  private determineStatus(
    localNetwork: boolean,
    dnsResolution: boolean,
    internetAccess: boolean,
    latency: number,
    packetLoss: number
  ): NetworkHealth['status'] {
    const thresholds = MEDIUM_THRESHOLDS[this.inferredMedium] || MEDIUM_THRESHOLDS.unknown;
    
    if (!localNetwork) return 'offline';
    if (!internetAccess) return 'critical';
    if (!dnsResolution) return 'critical';
    if (packetLoss > thresholds.packetLossThreshold) return 'degraded';
    if (latency > thresholds.latencyThreshold) return 'degraded';
    return 'healthy';
  }

  private calculateConnectivityScore(
    localNetwork: boolean,
    dnsResolution: boolean,
    internetAccess: boolean,
    latency: number,
    packetLoss: number
  ): number {
    const thresholds = MEDIUM_THRESHOLDS[this.inferredMedium] || MEDIUM_THRESHOLDS.unknown;
    
    let score = 0;
    if (localNetwork) score += 25;
    if (dnsResolution) score += 25;
    if (internetAccess) score += 25;
    
    // Latency score (0-25) - medium-specific
    if (latency === 0) {
      // No latency data
    } else if (latency <= thresholds.expectedLatencyRange.max) {
      score += 25;
    } else if (latency <= thresholds.expectedLatencyRange.max * 2) {
      score += 20;
    } else if (latency <= thresholds.expectedLatencyRange.max * 3) {
      score += 15;
    } else if (latency <= thresholds.expectedLatencyRange.max * 5) {
      score += 10;
    } else {
      score += 5;
    }

    // Penalize packet loss - medium-specific
    const packetLossPenalty = packetLoss / thresholds.packetLossThreshold;
    score = score * (1 - Math.min(1, packetLossPenalty));
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private detectOutages(health: NetworkHealth) {
    const now = Date.now();

    // Check for new outage
    if (!this.activeOutage && health.status === 'offline') {
      this.triggerOutage('internet', 'critical', 'Network completely offline');
    } else if (!this.activeOutage && health.status === 'critical') {
      if (!health.internetAccess) {
        this.triggerOutage('internet', 'major', 'Internet access lost');
      } else if (!health.dnsResolution) {
        this.triggerOutage('dns', 'major', 'DNS resolution failure');
      }
    } else if (!this.activeOutage && health.status === 'degraded') {
      if (health.packetLoss > this.config.packetLossThreshold * 2) {
        this.triggerOutage('packet_loss', 'minor', `High packet loss: ${health.packetLoss.toFixed(1)}%`);
      } else if (health.latency > this.config.latencyThreshold * 3) {
        this.triggerOutage('high_latency', 'minor', `High latency: ${health.latency}ms`);
      }
    }

    // Check if outage is resolved
    if (this.activeOutage && health.status === 'healthy') {
      this.resolveOutage();
    }
  }

  private async triggerOutage(type: OutageEvent['type'], severity: OutageEvent['severity'], description: string) {
    const now = Date.now();
    
    // Determine outage scope
    let scope: OutageEvent['scope'] = 'local';
    let failurePoint = 'unknown';
    
    if (type === 'internet' || type === 'dns') {
      // Perform traceroute to identify failure point
      failurePoint = await this.performTraceroute();
      
      // Analyze failure point to determine scope
      if (failurePoint.includes('192.168.') || failurePoint.includes('10.') || failurePoint.includes('172.')) {
        scope = 'local'; // Failed at local network
      } else if (this.ispInfo && failurePoint.includes(this.ispInfo.asn) || 
                 failurePoint.includes(this.ispInfo?.name || '')) {
        scope = 'isp'; // Failed at ISP
      } else {
        scope = 'area'; // Failed beyond ISP, likely area/regional
      }
    }

    const outage: OutageEvent = {
      id: `outage-${now}`,
      startTime: now,
      type,
      severity,
      description,
      resolved: false,
      scope,
      isp: this.ispInfo?.name,
      failurePoint,
      areaAffected: scope === 'area' ? 'Regional' : undefined,
    };

    this.activeOutage = outage;
    this.outageHistory.push(outage);
    if (this.outageHistory.length > 500) this.outageHistory.shift();
    this.saveOutageHistory();
    this.onOutage(outage);

    // Show desktop notification
    this.showOutageNotification(outage);
  }

  private showOutageNotification(outage: OutageEvent) {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: `Network ${outage.severity.toUpperCase()}: ${outage.type}`,
      body: outage.description,
      urgency: outage.severity === 'critical' ? 'critical' : 'normal',
    });

    notification.show();

    // Play sound for critical issues
    if (outage.severity === 'critical') {
      this.playAlertSound();
    }
  }

  private playAlertSound() {
    const cmd = this.isMac
      ? 'afplay /System/Library/Sounds/Ping.aiff'
      : 'powershell -NoProfile -NonInteractive -Command "[console]::beep(800, 200)"';
    const opts = this.isMac ? {} : { windowsHide: true };
    exec(cmd, opts, () => {
      // Ignore errors
    });
  }

  private resolveOutage() {
    if (!this.activeOutage) return;

    const now = Date.now();
    this.activeOutage.endTime = now;
    this.activeOutage.duration = now - this.activeOutage.startTime;
    this.activeOutage.resolved = true;
    
    this.saveOutageHistory();
    this.onOutage({ ...this.activeOutage });
    this.activeOutage = null;
  }

  getCurrentHealth(): NetworkHealth {
    return this.currentHealth;
  }

  getHealthHistory(): NetworkHealth[] {
    return [...this.healthHistory];
  }

  getHealthHistoryForPeriod(hours: number): NetworkHealth[] {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return this.healthHistory.filter(h => h.lastCheck >= cutoff);
  }

  analyzeOutagePatterns(): {
    totalOutages: number;
    averageDuration: number;
    mostCommonType: string;
    mostCommonSeverity: string;
    hourlyDistribution: Record<number, number>;
  } {
    const resolvedOutages = this.outageHistory.filter(o => o.resolved && o.duration);
    
    if (resolvedOutages.length === 0) {
      return {
        totalOutages: 0,
        averageDuration: 0,
        mostCommonType: 'none',
        mostCommonSeverity: 'none',
        hourlyDistribution: {},
      };
    }

    const typeCounts = resolvedOutages.reduce((acc, o) => {
      acc[o.type] = (acc[o.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const severityCounts = resolvedOutages.reduce((acc, o) => {
      acc[o.severity] = (acc[o.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const hourlyDistribution = resolvedOutages.reduce((acc, o) => {
      const hour = new Date(o.startTime).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const avgDuration = resolvedOutages.reduce((sum, o) => sum + (o.duration || 0), 0) / resolvedOutages.length;

    return {
      totalOutages: resolvedOutages.length,
      averageDuration: Math.round(avgDuration),
      mostCommonType: Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
      mostCommonSeverity: Object.entries(severityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
      hourlyDistribution,
    };
  }

  calculateNetworkQualityScore(): number {
    if (this.healthHistory.length < 10) return 50; // Not enough data

    const recentHealth = this.healthHistory.slice(-60); // Last hour at 1-minute intervals
    
    const avgLatency = recentHealth.reduce((sum, h) => sum + h.latency, 0) / recentHealth.length;
    const avgPacketLoss = recentHealth.reduce((sum, h) => sum + h.packetLoss, 0) / recentHealth.length;
    const avgConnectivity = recentHealth.reduce((sum, h) => sum + h.connectivityScore, 0) / recentHealth.length;
    
    // Calculate quality score (0-100)
    let score = avgConnectivity;
    
    // Penalize high latency
    if (avgLatency > 100) score -= 10;
    if (avgLatency > 200) score -= 10;
    if (avgLatency > 500) score -= 20;
    
    // Penalize packet loss
    if (avgPacketLoss > 1) score -= 10;
    if (avgPacketLoss > 5) score -= 20;
    if (avgPacketLoss > 10) score -= 30;
    
    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  getOutageHistory(): OutageEvent[] {
    return [...this.outageHistory];
  }

  getActiveOutage(): OutageEvent | null {
    return this.activeOutage;
  }

  updateConfig(config: Partial<FaultDetectionConfig>) {
    this.config = { ...this.config, ...config };
    
    // Restart with new interval if changed
    if (config.checkInterval && this.isRunning) {
      this.stop();
      this.start();
    }
  }
}
