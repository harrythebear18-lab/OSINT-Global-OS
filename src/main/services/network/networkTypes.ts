export interface GeoLocation {
  ip: string;
  country: string;
  countryCode: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  isp: string;
  org: string;
  as: string;
  timezone: string;
}

export interface NetworkConnection {
  id: string;
  protocol: 'TCP' | 'UDP';
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  processId: number;
  processName: string;
  geo?: GeoLocation;
  firstSeen: number;
  lastSeen: number;
  bytesSent?: number;
  bytesReceived?: number;
}

export interface VPNStatus {
  isActive: boolean;
  adapterName: string | null;
  adapterType: string | null;
  publicIP: string;
  publicIPGeo?: GeoLocation;
  realIP?: string;
  vpnProvider: string | null;
  dnsServers: string[];
  dnsLeakDetected: boolean;
  webrtcLeakDetected: boolean;
  killSwitchActive: boolean;
  encryptedInterfaces: string[];
  verificationDetails: VPNVerificationDetail[];
}

export interface VPNVerificationDetail {
  check: string;
  status: 'pass' | 'fail' | 'warning' | 'unknown';
  message: string;
}

export interface NetworkStats {
  totalConnections: number;
  activeConnections: number;
  uniqueCountries: number;
  uniqueIPs: number;
  totalBytesSent: number;
  totalBytesReceived: number;
  topProcesses: { name: string; connections: number }[];
  topCountries: { country: string; count: number }[];
}

export interface MonitorUpdate {
  connections: NetworkConnection[];
  stats: NetworkStats;
  myLocation: GeoLocation | null;
  pendingGeoLookups: number;
  timestamp: number;
}

export interface TrafficDataPoint {
  timestamp: number;
  totalConnections: number;
  activeConnections: number;
  newConnections: number;
}

export interface ConnectionAlert {
  id: string;
  timestamp: number;
  type: 'new_connection' | 'new_country' | 'suspicious';
  processName: string;
  remoteAddress: string;
  remotePort: number;
  protocol: 'TCP' | 'UDP';
  geo?: GeoLocation;
  message: string;
}

export interface NetworkHealth {
  status: 'healthy' | 'degraded' | 'critical' | 'offline';
  connectivityScore: number;
  latency: number;
  packetLoss: number;
  lastCheck: number;
  dnsResolution: boolean;
  internetAccess: boolean;
  localNetwork: boolean;
  inferredMedium?: NetworkMedium;
  latencyVariance?: number;
  detectionMethod?: DetectionMethod;
  detectionConfidence?: number;
}

export interface OutageEvent {
  id: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  type: 'internet' | 'dns' | 'local' | 'high_latency' | 'packet_loss';
  severity: 'minor' | 'major' | 'critical';
  description: string;
  resolved: boolean;
  scope?: 'local' | 'isp' | 'area' | 'regional';
  isp?: string;
  failurePoint?: string; // Last successful hop in traceroute
  areaAffected?: string; // Geographic area if known
}

export interface FaultDetectionConfig {
  checkInterval: number;
  latencyThreshold: number;
  packetLossThreshold: number;
  consecutiveFailures: number;
  testHosts: string[];
  dnsServers: string[];
}

export type NetworkMedium = 'copper' | 'fiber' | 'wireless' | 'unknown';

export type DetectionMethod = 'statistical' | 'adapter' | 'speed' | 'name' | 'hybrid';

export interface NetworkInterface {
  name: string;
  description: string;
  medium: NetworkMedium;
  speed: number; // in Mbps
  status: 'up' | 'down' | 'disconnected';
  macAddress: string;
  isPrimary: boolean;
}

export interface MediumDetection {
  medium: NetworkMedium;
  method: DetectionMethod;
  confidence: number; // 0-100
  details: string;
}

export interface MediumThresholds {
  latencyThreshold: number;
  packetLossThreshold: number;
  expectedLatencyRange: { min: number; max: number };
}

export interface UserConfig {
  faultDetection: {
    checkInterval: number;
    latencyThreshold: number;
    packetLossThreshold: number;
    consecutiveFailures: number;
    testHosts: string[];
    dnsServers: string[];
    mediumDetection: {
      enabled: boolean;
      methodWeights: {
        statistical: number;
        adapter: number;
        speed: number;
        name: number;
      };
    };
  };
  alerts: {
    enabled: boolean;
    soundEnabled: boolean;
    desktopNotifications: boolean;
    snoozeDuration: number;
    thresholds: {
      highLatency: number; // ms
      highPacketLoss: number; // percentage
      connectionCount: number; // number of connections
      bandwidthUsage: number; // MB/s
    };
    email: {
      enabled: boolean;
      recipient: string;
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPassword?: string;
    };
    sms: {
      enabled: boolean;
      recipient: string;
      twilioAccountSid?: string;
      twilioAuthToken?: string;
      twilioPhoneNumber?: string;
    };
  };
  ui: {
    showSidebar: boolean;
    showVPN: boolean;
    showHealthPanel: boolean;
  };
}

export interface SpeedTestResult {
  downloadSpeed: number; // Mbps
  uploadSpeed: number; // Mbps
  latency: number; // ms
  jitter: number; // ms
  timestamp: number;
}

export interface DNSTestResult {
  server: string;
  ip: string;
  latency: number; // ms
  success: boolean;
  timestamp: number;
}

export interface TracerouteHop {
  hopNumber: number;
  ipAddress: string;
  hostname?: string;
  latency: number; // ms
  packetLoss: number; // percentage
  attempts: number;
}

export interface BandwidthUsage {
  processName: string;
  processId: number;
  bytesSent: number;
  bytesReceived: number;
  totalBytes: number;
  connections: number;
  timestamp: number;
}

export interface ConnectionQuality {
  remoteAddress: string;
  remotePort: number;
  qualityScore: number; // 0-100
  latency: number;
  packetLoss: number;
  timestamp: number;
}
