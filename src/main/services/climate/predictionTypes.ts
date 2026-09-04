// ─── Prediction / Forecasting Types ───
// Shared between main process and renderer

export type PredictionType = 'radar_nowcast' | 'storm_track' | 'climate_anomaly' | 'sensor_failure' | 'ocean_atmosphere_coupling' | 'severe_weather' | 'precipitation_forecast';

export type PredictionConfidence = 'high' | 'medium' | 'low';

export type RiskLevel = 'none' | 'low' | 'moderate' | 'high' | 'critical';

// ─── Radar Nowcasting ───

export interface RadarNowcastCell {
  lat: number;
  lon: number;
  intensity: number; // 0-1 estimated precipitation intensity
  radiusKm: number;
}

export interface RadarNowcast {
  timestamp: number;
  validUntil: number;
  cells: RadarNowcastCell[];
  motionVector: { latPerHour: number; lonPerHour: number };
  confidence: PredictionConfidence;
  method: string;
  framesUsed: number;
}

// ─── Storm Track Prediction ───

export interface StormTrackPredictionPoint {
  lat: number;
  lon: number;
  hoursFromNow: number;
  windSpeedKt?: number;
  pressureMB?: number;
  intensity: string;
  confidenceRadiusKm: number;
}

export interface StormTrackPrediction {
  stormId: string;
  stormName: string;
  timestamp: number;
  currentLat: number;
  currentLon: number;
  currentIntensity: string;
  predictedTrack: StormTrackPredictionPoint[];
  steeringFlow: { speedKt: number; directionDeg: number };
  confidence: PredictionConfidence;
  method: string;
  notes: string[];
}

// ─── Climate Anomaly Prediction ───

export interface ClimateAnomalyPrediction {
  stationId: string;
  stationName: string;
  source: string;
  lat: number;
  lon: number;
  field: string;
  currentValue: number;
  baselineMean: number;
  baselineStdDev: number;
  currentZScore: number;
  predictedValue: number;
  predictedZScore: number;
  trendPerDay: number;
  hoursAhead: number;
  riskLevel: RiskLevel;
  confidence: PredictionConfidence;
  method: string;
  message: string;
}

// ─── Sensor Failure Prediction ───

export interface SensorFailurePrediction {
  stationId: string;
  stationName: string;
  source: string;
  stationType: string;
  lat: number;
  lon: number;
  currentStatus: string;
  failureProbability: number; // 0-1
  riskLevel: RiskLevel;
  estimatedTimeToFailure: string;
  contributingFactors: { factor: string; weight: number; detail: string }[];
  confidence: PredictionConfidence;
  method: string;
  recommendation: string;
}

// ─── Ocean-Atmosphere Coupling ───

export interface SSTRegionAnomaly {
  regionId: string;
  regionName: string;
  regionType: 'ocean' | 'land';
  centerLat: number;
  centerLon: number;
  stationCount: number;
  avgAnomaly: number; // deviation from climatic baseline in °C
  maxAnomaly: number;
  minAnomaly: number;
  field: string; // waterTemp, airTemp, etc.
}

export interface TeleconnectionIndex {
  name: string; // e.g., 'ENSO', 'PDO', 'NAO_proxy'
  fullName: string;
  value: number; // index value, typically -2 to +2
  category: string; // e.g., 'El Niño', 'La Niña', 'Neutral'
  description: string;
  confidence: PredictionConfidence;
  contributingRegions: string[];
}

export interface OceanLandCorrelation {
  oceanRegion: string;
  landRegion: string;
  field: string;
  correlation: number; // -1 to 1
  lagHours: number; // ocean leads land by this many hours
  significance: number; // 0-1
  description: string;
}

export interface OceanAtmosphereCoupling {
  timestamp: number;
  sstAnomalies: SSTRegionAnomaly[];
  teleconnectionIndices: TeleconnectionIndex[];
  correlations: OceanLandCorrelation[];
  globalMeanSSTAnomaly: number;
  globalMeanAirTempAnomaly: number;
  coupledPattern: string; // description of the dominant coupled pattern
  confidence: PredictionConfidence;
  method: string;
  notes: string[];
}

// ─── Severe Weather Alerting ───

export interface SevereWeatherAlert {
  id: string;
  timestamp: number;
  alertType: 'tornado_risk' | 'hurricane_risk' | 'thunderstorm_risk' | 'flood_risk' | 'heatwave_risk' | 'cold_spell_risk' | 'high_wind_risk' | 'storm_surge_risk';
  severity: RiskLevel;
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  title: string;
  description: string;
  validFrom: number;
  validUntil: number;
  contributingFactors: { factor: string; value: string; weight: number }[];
  confidence: PredictionConfidence;
  affectedRegions: string[];
}

export interface SevereWeatherPrediction {
  timestamp: number;
  alerts: SevereWeatherAlert[];
  globalRiskIndex: number; // 0-1
  method: string;
  notes: string[];
}

// ─── Precipitation Forecast ───

export interface PrecipitationForecastCell {
  lat: number;
  lon: number;
  hoursFromNow: number;
  intensityMm: number; // estimated mm/h
  probability: number; // 0-1
  confidenceRadiusKm: number;
}

export interface PrecipitationForecast {
  timestamp: number;
  validUntil: number;
  cells: PrecipitationForecastCell[];
  maxIntensityMm: number;
  coveragePercent: number;
  confidence: PredictionConfidence;
  method: string;
  notes: string[];
}

// ─── Aggregate Prediction Update ───

export interface PredictionUpdate {
  timestamp: number;
  radarNowcast: RadarNowcast | null;
  stormTracks: StormTrackPrediction[];
  climateAnomalies: ClimateAnomalyPrediction[];
  sensorFailures: SensorFailurePrediction[];
  oceanAtmosphereCoupling: OceanAtmosphereCoupling | null;
  severeWeather: SevereWeatherPrediction | null;
  precipitationForecast: PrecipitationForecast | null;
  summary: {
    totalPredictions: number;
    highRiskCount: number;
    criticalRiskCount: number;
    avgConfidence: number;
  };
}
