// Grid monitor types — ported from grid-monitor, kept separate from climate types
// to preserve both verification systems independently.

export type GridDataSource = 'EIA_GRID' | 'ENTSOE' | 'USGS_EGRID' | 'OPENELEC' | 'SYNTHETIC' | 'DATACENTER_MAP' | 'AI_CLUSTER';

export type AssetType =
  | 'power_plant'
  | 'substation'
  | 'transformer'
  | 'transmission_line'
  | 'renewable_farm'
  | 'battery_storage'
  | 'data_center'
  | 'ai_center'
  | 'edge_node';

export type EnergyType = 'coal' | 'gas' | 'nuclear' | 'hydro' | 'wind' | 'solar' | 'geothermal' | 'battery' | 'mixed' | 'unknown';

export type GridIntegrityStatus = 'verified' | 'warning' | 'failed' | 'stale' | 'unknown' | 'invalidated';

export interface GridAsset {
  id: string;
  name: string;
  type: AssetType;
  source: GridDataSource;
  lat: number;
  lon: number;
  country?: string;
  region?: string;
  owner?: string;
  operator?: string;
  capacityMw?: number;
  energyType?: EnergyType;
  voltageKv?: number;
  lastUpdate: number;
  active: boolean;
  invalidated?: boolean;
  invalidationReason?: string;
  tags?: string[];
}

export interface AssetMeasurement {
  assetId: string;
  timestamp: number;
  voltageKv?: number;
  frequencyHz?: number;
  loadMw?: number;
  generationMw?: number;
  temperatureC?: number;
  carbonIntensityGco2Kwh?: number;
  utilizationPercent?: number;
  pue?: number;
  itLoadMw?: number;
  totalFacilityLoadMw?: number;
  coolingLoadMw?: number;
  availableRacks?: number;
  storedMwh?: number;
  maxStorageMwh?: number;
  throughputTbps?: number;
  latencyMs?: number;
  healthScore?: number;
}

export interface Interconnect {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  type: 'ac_line' | 'dc_line' | 'fiber' | 'waveguide' | 'unknown';
  capacityTbps?: number;
  capacityMw?: number;
  latencyMs?: number;
  active: boolean;
  lastUpdate: number;
}

export interface AssetHealth {
  assetId: string;
  status: GridIntegrityStatus;
  integrityScore: number;
  lastTransmission: number;
  expectedIntervalMs: number;
  actualIntervalMs: number;
  transmissionCount: number;
  missedTransmissions: number;
  transmissionRegularity: number;
  fieldsExpected: string[];
  fieldsReceived: string[];
  fieldsMissing: string[];
  driftDetected: boolean;
  driftDetails: string[];
  calibrationStatus: 'ok' | 'drift' | 'unknown';
  consecutiveFailures: number;
  uptimePercent: number;
  checks: AssetCheck[];
}

export interface AssetCheck {
  check: string;
  status: GridIntegrityStatus;
  message: string;
  value?: string;
}

export interface GridDataFlowHealth {
  source: GridDataSource;
  sourceName: string;
  status: GridIntegrityStatus;
  pipelineScore: number;
  lastFetchTime: number;
  fetchLatencyMs: number;
  avgLatencyMs: number;
  payloadSizeBytes: number;
  assetsExpected: number;
  assetsReceived: number;
  completenessPercent: number;
  duplicateCount: number;
  outOfOrderCount: number;
  missingFieldCount: number;
  totalPackets: number;
  droppedPackets: number;
  pipelineChecks: GridPipelineCheck[];
  latencyHistory: number[];
}

export interface GridPipelineCheck {
  check: string;
  status: GridIntegrityStatus;
  message: string;
}

export interface GridCrossVerification {
  assetId: string;
  assetName: string;
  source: GridDataSource;
  lat: number;
  lon: number;
  status: GridIntegrityStatus;
  verificationScore: number;
  measurement: AssetMeasurement;
  nearbyComparisons: GridNearbyComparison[];
  physicalPlausibility: GridPhysicalCheck[];
  statisticalOutlier: GridStatisticalCheck;
  temporalConsistency: GridTemporalCheck;
  crossSourceAgreement: GridCrossSourceCheck[];
  flags: GridVerificationFlag[];
}

export interface GridNearbyComparison {
  assetId: string;
  assetName: string;
  source: GridDataSource;
  distanceKm: number;
  field: string;
  theirValue: number;
  ourValue: number;
  delta: number;
  withinTolerance: boolean;
}

export interface GridPhysicalCheck {
  field: string;
  value: number;
  min: number;
  max: number;
  passed: boolean;
  message: string;
}

export interface GridStatisticalCheck {
  status: GridIntegrityStatus;
  zScore: number;
  mean: number;
  stdDev: number;
  sampleSize: number;
  message: string;
}

export interface GridTemporalCheck {
  status: GridIntegrityStatus;
  previousValue?: number;
  currentValue: number;
  rateOfChange: number;
  maxExpectedRate: number;
  message: string;
}

export interface GridCrossSourceCheck {
  field: string;
  sources: string[];
  values: number[];
  spread: number;
  agreement: boolean;
  message: string;
}

export interface GridVerificationFlag {
  type:
    | 'asset_drift'
    | 'data_gap'
    | 'statistical_outlier'
    | 'physical_implausible'
    | 'cross_source_mismatch'
    | 'temporal_jump'
    | 'pipeline_error'
    | 'calibration_issue'
    | 'stuck_sensor'
    | 'regional_anomaly'
    | 'capacity_exceeded'
    | 'thermal_stress'
    | 'interconnect_failure'
    | 'missing_data';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  field?: string;
}

export interface GridIntegritySummary {
  overallScore: number;
  sensorLayerScore: number;
  dataFlowLayerScore: number;
  resultsLayerScore: number;
  totalAssetsMonitored: number;
  assetsVerified: number;
  assetsWarning: number;
  assetsFailed: number;
  pipelinesActive: number;
  pipelinesDegraded: number;
  resultsValidated: number;
  resultsFlagged: number;
  totalFlags: number;
  criticalFlags: number;
  warningFlags: number;
  dataPointsVerified: number;
  crossSourceMatches: number;
  crossSourceMismatches: number;
}

export interface GridStats {
  totalAssets: number;
  activeAssets: number;
  powerPlants: number;
  substations: number;
  transformers: number;
  renewableFarms: number;
  batteryStorages: number;
  dataCenters: number;
  aiCenters: number;
  edgeNodes: number;
  totalGenerationMw: number;
  totalLoadMw: number;
  avgUtilization: number;
  anomalies: number;
  dataFreshness: number;
  totalCapacityMw: number;
}

export interface GridMonitorUpdate {
  assets: GridAsset[];
  measurements: [string, AssetMeasurement][];
  interconnects: Interconnect[];
  stats: GridStats;
  timestamp: number;
  pendingFetches: number;
}

export interface GridIntegrityUpdate {
  assetHealth: [string, AssetHealth][];
  dataFlowHealth: GridDataFlowHealth[];
  crossVerifications: GridCrossVerification[];
  summary: GridIntegritySummary;
  timestamp: number;
  newAssets?: GridAsset[];
}

export interface GridTrafficDataPoint {
  timestamp: number;
  totalAssets: number;
  activeAssets: number;
  newMeasurements: number;
  avgUtilization: number;
  totalLoadMw: number;
  integrityScore: number;
  assetsVerified: number;
  assetsFlagged: number;
}

export interface GridAlert {
  id: string;
  timestamp: number;
  type:
    | 'asset_drift'
    | 'data_gap'
    | 'statistical_outlier'
    | 'physical_implausible'
    | 'cross_source_mismatch'
    | 'temporal_jump'
    | 'pipeline_error'
    | 'calibration_issue'
    | 'new_asset'
    | 'asset_offline'
    | 'stuck_sensor'
    | 'regional_anomaly'
    | 'capacity_exceeded'
    | 'thermal_stress'
    | 'interconnect_failure';
  assetId: string;
  assetName: string;
  source: GridDataSource;
  lat: number;
  lon: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  field?: string;
  weatherCorrelated?: boolean;
}

export interface MonitorSettings {
  fetchIntervalMs: number;
  showParticles: boolean;
  showInterconnects: boolean;
  alertSeverityThreshold: 'info' | 'warning' | 'critical';
}

export const DEFAULT_SETTINGS: MonitorSettings = {
  fetchIntervalMs: 10000,
  showParticles: true,
  showInterconnects: true,
  alertSeverityThreshold: 'info',
};

export const SOURCE_NAMES: Record<GridDataSource, string> = {
  EIA_GRID: 'U.S. EIA Grid Monitor',
  ENTSOE: 'ENTSO-E Transparency Platform',
  USGS_EGRID: 'EPA eGRID',
  OPENELEC: 'Open Electricity',
  SYNTHETIC: 'Synthetic Test Feed',
  DATACENTER_MAP: 'DataCenterMap Public Index',
  AI_CLUSTER: 'AI Cluster Registry',
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  power_plant: 'Power Plant',
  substation: 'Substation',
  transformer: 'Transformer',
  transmission_line: 'Transmission Line',
  renewable_farm: 'Renewable Farm',
  battery_storage: 'Battery Storage',
  data_center: 'Data Center',
  ai_center: 'AI Center',
  edge_node: 'Edge Node',
};

export const ENERGY_TYPE_COLORS: Record<EnergyType, string> = {
  coal: '#44403c',
  gas: '#f97316',
  nuclear: '#8b5cf6',
  hydro: '#0ea5e9',
  wind: '#10b981',
  solar: '#facc15',
  geothermal: '#ef4444',
  battery: '#a855f7',
  mixed: '#6b7280',
  unknown: '#4b5563',
};

export const ENERGY_TYPE_LABELS: Record<EnergyType, string> = {
  coal: 'Coal',
  gas: 'Natural Gas',
  nuclear: 'Nuclear',
  hydro: 'Hydroelectric',
  wind: 'Wind',
  solar: 'Solar',
  geothermal: 'Geothermal',
  battery: 'Battery',
  mixed: 'Mixed',
  unknown: 'Unknown',
};

// ─── Aliases matching original grid-monitor type names ───
// The ported backend files import these names; aliasing avoids editing all 8 files.
export type IntegrityStatus = GridIntegrityStatus;
export type DataFlowHealth = GridDataFlowHealth;
export type PipelineCheck = GridPipelineCheck;
export type CrossVerification = GridCrossVerification;
export type NearbyComparison = GridNearbyComparison;
export type PhysicalCheck = GridPhysicalCheck;
export type StatisticalCheck = GridStatisticalCheck;
export type TemporalCheck = GridTemporalCheck;
export type CrossSourceCheck = GridCrossSourceCheck;
export type VerificationFlag = GridVerificationFlag;
export type IntegritySummary = GridIntegritySummary;
export type IntegrityUpdate = GridIntegrityUpdate;
export type TrafficDataPoint = GridTrafficDataPoint;
export type DataSource = GridDataSource;
