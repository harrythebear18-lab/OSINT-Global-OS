// Climate / Ocean types — ported from climate-tracker for standalone unified dashboard

export type DataSource = 'NOAA_NDBC' | 'ARGO' | 'BGC_ARGO' | 'NOAA_ERDDAP' | 'GTSPP' | 'TAO_PIRATA' | 'PMEL_CO2' | 'NWS_WEATHER' | 'NHC_STORM' | 'BLITZORTUNG_LIGHTNING';

export type OceanBasin = 'north_pacific' | 'south_pacific' | 'north_atlantic' | 'south_atlantic' | 'indian' | 'arctic' | 'southern_ocean';

export type Continent = 'north_america' | 'south_america' | 'europe' | 'africa' | 'asia' | 'oceania' | 'antarctica';

export type RegionType = 'ocean' | 'land';

export type RegionId = OceanBasin | Continent;

export interface RegionalAverage {
  regionId: RegionId;
  regionType: RegionType;
  name: string;
  avgTemp: number;
  stationCount: number;
  minTemp: number;
  maxTemp: number;
  centerLat: number;
  centerLon: number;
}

export type StationType = 'buoy' | 'argo_float' | 'bgc_argo_float' | 'carbon_station' | 'weather_station' | 'storm' | 'lightning';

export type IntegrityStatus = 'verified' | 'warning' | 'failed' | 'stale' | 'unknown' | 'invalidated';

export interface ClimateStation {
  id: string;
  name: string;
  type: StationType;
  source: DataSource;
  lat: number;
  lon: number;
  elevation?: number;
  depth?: number;
  country?: string;
  region?: string;
  owner?: string;
  lastUpdate: number;
  active: boolean;
  invalidated?: boolean;
  invalidationReason?: string;
}

export interface ClimateMeasurement {
  stationId: string;
  timestamp: number;
  waterTemp?: number;
  airTemp?: number;
  windSpeed?: number;
  windDir?: number;
  waveHeight?: number;
  wavePeriod?: number;
  pressure?: number;
  salinity?: number;
  co2?: number;
  chl?: number;
  currentSpeed?: number;
  currentDir?: number;
  depth?: number;
  oxygen?: number;
  nitrate?: number;
  ph?: number;
}

export interface StormTrackPoint {
  lat: number;
  lon: number;
  timestamp: number;
  windSpeedKt?: number;
  pressureMB?: number;
  category?: string;
  forecastHour?: number;
}

export interface Storm {
  id: string;
  name: string;
  basin: string;
  type: string;
  classification: string;
  intensity: string;
  lat: number;
  lon: number;
  windSpeedKt?: number;
  pressureMB?: number;
  movementDir?: string;
  movementSpeedKt?: number;
  lastUpdate: number;
  track: StormTrackPoint[];
  forecastTrack: StormTrackPoint[];
}

export interface LightningStrike {
  id: string;
  lat: number;
  lon: number;
  timestamp: number;
  amplitude?: number;
  polarity?: 'positive' | 'negative';
}

export interface Vessel {
  imo: string;
  name: string;
  lat: number;
  lon: number;
  speed?: number;
  course?: number;
  draft?: number;
  vesselType?: string;
  flag?: string;
  navStatus?: string;
  destination?: string;
  timestamp: number;
}

export interface Aircraft {
  icao24: string;       // Unique ICAO 24-bit transponder address (hex)
  callsign: string;     // Flight callsign (e.g. "BAW123")
  lat: number;
  lon: number;
  altitudeM?: number;       // Barometric altitude in meters
  altitudeFt?: number;      // Altitude in feet
  velocityMs?: number;      // Velocity in m/s
  heading?: number;         // True track in degrees
  verticalRate?: number;    // Vertical rate in m/s
  onGround: boolean;
  originCountry: string;    // Origin country ISO2
  lastContact: number;      // Unix timestamp (seconds)
  firstSeen: number;        // When we first saw this aircraft
  category?: string;        // Aircraft category description
}

export interface AircraftMetadata {
  icao24: string;
  registration: string;       // e.g. "D-AIBD"
  manufacturerName: string;   // e.g. "Airbus"
  model: string;              // e.g. "A319"
  typecode: string;           // e.g. "A319"
  icaoAircraftClass: string;  // e.g. "L2J"
  operator: string;           // e.g. "Lufthansa"
  operatorCallsign: string;   // e.g. "Lufthansa"
  owner: string;
  categoryDescription: string;
}

export interface FlightTrackPoint {
  time: number;          // Unix timestamp (seconds)
  lat: number;
  lon: number;
  altitudeM?: number;
  heading?: number;
  onGround: boolean;
}

// ─── Seismic (USGS Earthquake API) ───

export interface Earthquake {
  id: string;               // USGS event id
  mag: number;              // Magnitude
  place: string;            // Human-readable location description
  lat: number;
  lon: number;
  depth: number;            // Depth in km
  time: number;             // Unix timestamp (ms)
  url: string;              // USGS detail page URL
  tsunami: boolean;         // Tsunami warning flag
  sig: number;              // Significance score (0-1000+)
  mmi?: number;             // Modified Mercalli Intensity
  alertLevel?: 'green' | 'yellow' | 'orange' | 'red';
}

// ─── Space Weather (NOAA SWPC) ───

export interface SolarFlare {
  id: string;
  classType: string;        // C, M, X class
  peakTime: number;         // Unix timestamp (ms)
  location?: string;        // e.g. "N15W28"
  intensity: number;        // e.g. 5.2 for M5.2
}

export interface GeomagneticStorm {
  id: string;
  startTime: number;        // Unix timestamp (ms)
  endTime?: number;
  kpIndex: number;          // 0-9 (G1=5, G2=6, G3=7, G4=8, G5=9)
  scale: string;            // "G1" through "G5" or "Minor" etc
  description: string;
}

export interface SpaceWeatherData {
  solarFlares: SolarFlare[];
  geomagneticStorms: GeomagneticStorm[];
  kpIndex?: number;         // Current planetary K-index
  auroraViewline?: number;  // Latitude of aurora visibility
  solarWindSpeed?: number;  // km/s
  solarWindDensity?: number; // protons/cm³
  timestamp: number;
}

// ─── Wildfire (NASA FIRMS) ───

export interface Wildfire {
  id: string;
  lat: number;
  lon: number;
  brightness: number;       // Kelvin (detection temperature)
  scan: number;             // Scan resolution in degrees
  track: number;            // Track resolution in degrees
  acqDate: number;          // Unix timestamp (ms)
  confidence: 'low' | 'nominal' | 'high' | string;
  frp: number;              // Fire Radiative Power (MW)
  satellite: string;        // Satellite source (e.g. "MODIS", "VIIRS")
  daynight: 'D' | 'N';      // Day or night detection
}

// ─── Sensor Verification Layer ───

export interface SensorHealth {
  stationId: string;
  status: IntegrityStatus;
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
  checks: SensorCheck[];
}

export interface SensorCheck {
  check: string;
  status: IntegrityStatus;
  message: string;
  value?: string;
}

// ─── Data Flow Verification Layer ───

export interface DataFlowHealth {
  source: DataSource;
  sourceName: string;
  status: IntegrityStatus;
  pipelineScore: number;
  lastFetchTime: number;
  fetchLatencyMs: number;
  avgLatencyMs: number;
  payloadSizeBytes: number;
  stationsExpected: number;
  stationsReceived: number;
  completenessPercent: number;
  duplicateCount: number;
  outOfOrderCount: number;
  missingFieldCount: number;
  totalPackets: number;
  droppedPackets: number;
  pipelineChecks: PipelineCheck[];
  latencyHistory: number[];
}

export interface PipelineCheck {
  check: string;
  status: IntegrityStatus;
  message: string;
}

// ─── Results Verification Layer ───

export interface CrossVerification {
  stationId: string;
  stationName: string;
  source: DataSource;
  lat: number;
  lon: number;
  status: IntegrityStatus;
  verificationScore: number;
  measurement: ClimateMeasurement;
  nearbyComparisons: NearbyComparison[];
  physicalPlausibility: PhysicalCheck[];
  statisticalOutlier: StatisticalCheck;
  temporalConsistency: TemporalCheck;
  crossSourceAgreement: CrossSourceCheck[];
  flags: VerificationFlag[];
}

export interface NearbyComparison {
  stationId: string;
  stationName: string;
  source: DataSource;
  distanceKm: number;
  field: string;
  theirValue: number;
  ourValue: number;
  delta: number;
  withinTolerance: boolean;
}

export interface PhysicalCheck {
  field: string;
  value: number;
  min: number;
  max: number;
  passed: boolean;
  message: string;
}

export interface StatisticalCheck {
  status: IntegrityStatus;
  zScore: number;
  mean: number;
  stdDev: number;
  sampleSize: number;
  message: string;
}

export interface TemporalCheck {
  status: IntegrityStatus;
  previousValue?: number;
  currentValue: number;
  rateOfChange: number;
  maxExpectedRate: number;
  message: string;
}

export interface CrossSourceCheck {
  field: string;
  sources: string[];
  values: number[];
  spread: number;
  agreement: boolean;
  message: string;
}

export interface VerificationFlag {
  type: 'sensor_drift' | 'data_gap' | 'statistical_outlier' | 'physical_implausible' | 'cross_source_mismatch' | 'temporal_jump' | 'pipeline_error' | 'calibration_issue' | 'stuck_sensor' | 'field_correlation' | 'regional_anomaly' | 'cluster_outlier' | 'data_uniformity' | 'argo_reference_mismatch' | 'bathymetry_mismatch' | 'density_anomaly' | 'missing_data';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  field?: string;
}

// ─── Aggregate Integrity ───

export interface IntegritySummary {
  overallScore: number;
  sensorLayerScore: number;
  dataFlowLayerScore: number;
  resultsLayerScore: number;
  totalSensorsMonitored: number;
  sensorsVerified: number;
  sensorsWarning: number;
  sensorsFailed: number;
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

// ─── Stats & Updates ───

export interface ClimateStats {
  totalStations: number;
  activeStations: number;
  buoys: number;
  argoFloats: number;
  bgcArgoFloats: number;
  carbonStations: number;
  weatherStations: number;
  avgWaterTemp: number;
  avgAirTemp: number;
  maxWaterTemp: number;
  minWaterTemp: number;
  avgCO2: number;
  avgWaveHeight: number;
  anomalies: number;
  dataFreshness: number;
  regionalAverages: RegionalAverage[];
}

export interface IntegrityUpdate {
  sensorHealth: [string, SensorHealth][];
  dataFlowHealth: DataFlowHealth[];
  crossVerifications: CrossVerification[];
  summary: IntegritySummary;
  timestamp: number;
  storms?: Storm[];
  lightningStrikes?: LightningStrike[];
  vessels?: Vessel[];
  aircraft?: Aircraft[];
  earthquakes?: Earthquake[];
  spaceWeather?: SpaceWeatherData;
  wildfires?: Wildfire[];
  newStations?: ClimateStation[];
}

export interface TrafficDataPoint {
  timestamp: number;
  totalStations: number;
  activeStations: number;
  newMeasurements: number;
  avgWaterTemp: number;
  avgCO2: number;
  integrityScore: number;
  sensorsVerified: number;
  sensorsFlagged: number;
}

export interface ClimateAlert {
  id: string;
  timestamp: number;
  type: 'sensor_drift' | 'data_gap' | 'statistical_outlier' | 'physical_implausible' | 'cross_source_mismatch' | 'temporal_jump' | 'pipeline_error' | 'calibration_issue' | 'new_sensor' | 'sensor_offline' | 'stuck_sensor' | 'field_correlation' | 'regional_anomaly' | 'cluster_outlier' | 'data_uniformity';
  stationId: string;
  stationName: string;
  source: DataSource;
  lat: number;
  lon: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  field?: string;
}
