import { ClimateStation, ClimateMeasurement } from './climateTypes';
import { ALL_OCEAN_BASINS, ALL_CONTINENTS, classifyRegion } from './regionClassification';
import {
  OceanAtmosphereCoupling,
  SSTRegionAnomaly,
  TeleconnectionIndex,
  OceanLandCorrelation,
  PredictionConfidence,
} from './predictionTypes';

/**
 * Ocean-Atmosphere Coupling Model
 *
 * Connects ocean SST anomalies to land weather patterns. This is the foundation
 * for a unified global climate network model — instead of treating ocean buoys
 * and land weather stations as separate reactive systems, this model:
 *
 * 1. Computes regional SST anomalies from NDBC buoys + Argo floats
 * 2. Computes regional land temperature anomalies from METAR/weather stations
 * 3. Detects teleconnection patterns (ENSO proxy, PDO-like, NAO proxy)
 * 4. Correlates ocean region anomalies with land region anomalies
 * 5. Identifies the dominant coupled pattern (e.g., El Niño conditions)
 *
 * Climatic baselines are approximated from latitudinal expected temperatures
 * (Hadley Cell circulation model) since we don't have a 30-year climatology DB.
 * As more historical data accumulates, the baselines shift toward observed means.
 */

// Climatic baseline temperatures by latitude band (approximate annual means)
// These are rough Hadley Cell model approximations
function climaticBaselineTemp(lat: number, field: string): number {
  const absLat = Math.abs(lat);
  if (field === 'waterTemp') {
    // Ocean temps: warm near equator (~28°C), cold near poles (~-1°C)
    return 28 - (absLat / 90) * 29;
  }
  if (field === 'airTemp') {
    // Land temps: hot near equator (~27°C), very cold near poles (~-25°C)
    return 27 - (absLat / 90) * 52;
  }
  return 0;
}

interface RegionData {
  regionId: string;
  regionName: string;
  regionType: 'ocean' | 'land';
  centerLat: number;
  centerLon: number;
  field: string;
  values: number[];
  anomalies: number[];
  stationIds: Set<string>;
}

function computeRegionAnomalies(
  stations: ClimateStation[],
  measurements: Map<string, ClimateMeasurement>,
  field: string,
  regionType: 'ocean' | 'land'
): RegionData[] {
  const regionMap = new Map<string, RegionData>();

  for (const station of stations) {
    const m = measurements.get(station.id);
    if (!m) continue;

    const val = (m as any)[field] as number | undefined;
    if (val === undefined || isNaN(val)) continue;

    const region = classifyRegion(station.lat, station.lon, station.type);
    if (!region || region.regionType !== regionType) continue;

    let rd = regionMap.get(region.regionId);
    if (!rd) {
      rd = {
        regionId: region.regionId,
        regionName: region.name,
        regionType,
        centerLat: region.centerLat,
        centerLon: region.centerLon,
        field,
        values: [],
        anomalies: [],
        stationIds: new Set(),
      };
      regionMap.set(region.regionId, rd);
    }

    const baseline = climaticBaselineTemp(station.lat, field);
    const anomaly = val - baseline;
    rd.values.push(val);
    rd.anomalies.push(anomaly);
    rd.stationIds.add(station.id);
  }

  return Array.from(regionMap.values());
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Compute ENSO proxy index from equatorial Pacific SST anomalies
 * Niño 3.4 region: 5°N-5°S, 170°W-120°W
 */
function computeENSOIndex(sstAnomalies: SSTRegionAnomaly[]): { value: number; category: string; description: string } {
  // Find North Pacific and South Pacific anomalies near the equator
  const pacificAnomalies = sstAnomalies.filter(
    (a) => (a.regionId === 'north_pacific' || a.regionId === 'south_pacific') && Math.abs(a.centerLat) < 30
  );

  if (pacificAnomalies.length === 0) {
    return { value: 0, category: 'Neutral', description: 'Insufficient Pacific SST data for ENSO assessment' };
  }

  const avgAnomaly = mean(pacificAnomalies.map((a) => a.avgAnomaly));
  const value = clamp(avgAnomaly / 0.8, -2.5, 2.5); // normalize to typical ENSO range

  let category = 'Neutral';
  let description = '';
  if (value >= 1.0) {
    category = 'El Niño';
    description = `Strong El Niño conditions detected (SST anomaly +${avgAnomaly.toFixed(1)}°C in equatorial Pacific)`;
  } else if (value >= 0.5) {
    category = 'El Niño (weak)';
    description = `Weak El Niño conditions (SST anomaly +${avgAnomaly.toFixed(1)}°C)`;
  } else if (value <= -1.0) {
    category = 'La Niña';
    description = `Strong La Niña conditions (SST anomaly ${avgAnomaly.toFixed(1)}°C in equatorial Pacific)`;
  } else if (value <= -0.5) {
    category = 'La Niña (weak)';
    description = `Weak La Niña conditions (SST anomaly ${avgAnomaly.toFixed(1)}°C)`;
  } else {
    description = `ENSO-neutral conditions (SST anomaly ${avgAnomaly.toFixed(1)}°C)`;
  }

  return { value, category, description };
}

/**
 * Compute PDO-like index from North Pacific SST anomalies
 */
function computePDOIndex(sstAnomalies: SSTRegionAnomaly[]): { value: number; category: string; description: string } {
  const npacific = sstAnomalies.find((a) => a.regionId === 'north_pacific');
  if (!npacific) {
    return { value: 0, category: 'Neutral', description: 'Insufficient North Pacific data' };
  }

  const value = clamp(npacific.avgAnomaly / 1.0, -2, 2);
  const category = value > 0.5 ? 'PDO Positive (warm phase)' : value < -0.5 ? 'PDO Negative (cool phase)' : 'PDO Neutral';
  const description = `North Pacific SST anomaly: ${npacific.avgAnomaly.toFixed(2)}°C (PDO ${value > 0 ? 'positive' : 'negative'} phase)`;

  return { value, category, description };
}

/**
 * Compute NAO proxy from North Atlantic SST and pressure patterns
 */
function computeNAOIndex(sstAnomalies: SSTRegionAnomaly[], stations: ClimateStation[], measurements: Map<string, ClimateMeasurement>): { value: number; category: string; description: string } {
  const natl = sstAnomalies.find((a) => a.regionId === 'north_atlantic');
  if (!natl) {
    return { value: 0, category: 'Neutral', description: 'Insufficient North Atlantic data' };
  }

  // Use pressure difference between high and low lat North Atlantic stations as NAO proxy
  let highLatPressure: number[] = [];
  let lowLatPressure: number[] = [];
  for (const s of stations) {
    const m = measurements.get(s.id);
    if (!m || m.pressure === undefined) continue;
    const region = classifyRegion(s.lat, s.lon, s.type);
    if (region?.regionId !== 'north_atlantic') continue;
    if (s.lat > 50) highLatPressure.push(m.pressure);
    else if (s.lat < 40 && s.lat > 20) lowLatPressure.push(m.pressure);
  }

  let pressureDiff = 0;
  if (highLatPressure.length > 0 && lowLatPressure.length > 0) {
    pressureDiff = mean(lowLatPressure) - mean(highLatPressure);
  }

  // NAO positive: lower pressure near Iceland, higher near Azores
  const value = clamp((pressureDiff - 10) / 15, -2, 2); // normalize
  const category = value > 0.5 ? 'NAO Positive' : value < -0.5 ? 'NAO Negative' : 'NAO Neutral';
  const description = `North Atlantic pressure gradient suggests ${category} (SST anomaly: ${natl.avgAnomaly.toFixed(2)}°C)`;

  return { value, category, description };
}

/**
 * Compute ocean→land correlations
 */
function computeCorrelations(
  oceanRegions: RegionData[],
  landRegions: RegionData[]
): OceanLandCorrelation[] {
  const correlations: OceanLandCorrelation[] = [];

  // Known teleconnection pathways
  const pathways: { ocean: string; land: string; field: string; lagHours: number; desc: string }[] = [
    { ocean: 'north_pacific', land: 'north_america', field: 'airTemp', lagHours: 72, desc: 'Pacific SST → North American temperature (PDO influence)' },
    { ocean: 'north_pacific', land: 'asia', field: 'airTemp', lagHours: 48, desc: 'Pacific SST → Asian temperature (AO influence)' },
    { ocean: 'north_atlantic', land: 'europe', field: 'airTemp', lagHours: 48, desc: 'Atlantic SST → European temperature (NAO influence)' },
    { ocean: 'north_atlantic', land: 'north_america', field: 'airTemp', lagHours: 72, desc: 'Atlantic SST → North American temperature (Gulf Stream influence)' },
    { ocean: 'indian', land: 'africa', field: 'airTemp', lagHours: 96, desc: 'Indian Ocean SST → African temperature (monsoon influence)' },
    { ocean: 'indian', land: 'asia', field: 'airTemp', lagHours: 72, desc: 'Indian Ocean SST → Asian temperature (monsoon influence)' },
    { ocean: 'south_pacific', land: 'south_america', field: 'airTemp', lagHours: 120, desc: 'Pacific SST → South American temperature (ENSO influence)' },
    { ocean: 'south_pacific', land: 'oceania', field: 'airTemp', lagHours: 96, desc: 'Pacific SST → Oceania temperature (ENSO influence)' },
  ];

  for (const path of pathways) {
    const ocean = oceanRegions.find((r) => r.regionId === path.ocean && r.field === 'waterTemp');
    const land = landRegions.find((r) => r.regionId === path.land && r.field === path.field);
    if (!ocean || !land) continue;
    if (ocean.anomalies.length < 3 || land.anomalies.length < 3) continue;

    // Simple Pearson correlation between anomaly arrays
    const minLen = Math.min(ocean.anomalies.length, land.anomalies.length);
    const oceanSlice = ocean.anomalies.slice(-minLen);
    const landSlice = land.anomalies.slice(-minLen);
    const correlation = pearsonCorrelation(oceanSlice, landSlice);

    // Significance based on sample size and correlation strength
    const significance = clamp(Math.abs(correlation) * Math.sqrt(minLen / 10), 0, 1);

    correlations.push({
      oceanRegion: path.ocean,
      landRegion: path.land,
      field: path.field,
      correlation,
      lagHours: path.lagHours,
      significance,
      description: path.desc,
    });
  }

  return correlations;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

export class OceanAtmosphereCoupler {
  private sstHistory = new Map<string, { anomalies: number[]; timestamps: number[] }>();
  private landTempHistory = new Map<string, { anomalies: number[]; timestamps: number[] }>();

  /**
   * Main coupling analysis — connects ocean and land data as a unified network
   */
  analyze(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>
  ): OceanAtmosphereCoupling {
    const notes: string[] = [];

    // 1. Compute regional SST anomalies (ocean)
    const oceanRegions = computeRegionAnomalies(stations, measurements, 'waterTemp', 'ocean');
    const sstAnomalies: SSTRegionAnomaly[] = oceanRegions.map((r) => ({
      regionId: r.regionId,
      regionName: r.regionName,
      regionType: 'ocean' as const,
      centerLat: r.centerLat,
      centerLon: r.centerLon,
      stationCount: r.stationIds.size,
      avgAnomaly: mean(r.anomalies),
      maxAnomaly: Math.max(...r.anomalies),
      minAnomaly: Math.min(...r.anomalies),
      field: 'waterTemp',
    }));

    // 2. Compute regional land temperature anomalies
    const landRegions = computeRegionAnomalies(stations, measurements, 'airTemp', 'land');
    const landAnomalies: SSTRegionAnomaly[] = landRegions.map((r) => ({
      regionId: r.regionId,
      regionName: r.regionName,
      regionType: 'land' as const,
      centerLat: r.centerLat,
      centerLon: r.centerLon,
      stationCount: r.stationIds.size,
      avgAnomaly: mean(r.anomalies),
      maxAnomaly: Math.max(...r.anomalies),
      minAnomaly: Math.min(...r.anomalies),
      field: 'airTemp',
    }));

    // 3. Update history for time-series correlation
    for (const r of oceanRegions) {
      let hist = this.sstHistory.get(r.regionId);
      if (!hist) {
        hist = { anomalies: [], timestamps: [] };
        this.sstHistory.set(r.regionId, hist);
      }
      hist.anomalies.push(mean(r.anomalies));
      hist.timestamps.push(Date.now());
      if (hist.anomalies.length > 50) {
        hist.anomalies.shift();
        hist.timestamps.shift();
      }
    }
    for (const r of landRegions) {
      let hist = this.landTempHistory.get(r.regionId);
      if (!hist) {
        hist = { anomalies: [], timestamps: [] };
        this.landTempHistory.set(r.regionId, hist);
      }
      hist.anomalies.push(mean(r.anomalies));
      hist.timestamps.push(Date.now());
      if (hist.anomalies.length > 50) {
        hist.anomalies.shift();
        hist.timestamps.shift();
      }
    }

    // 4. Compute teleconnection indices
    const allAnomalies = [...sstAnomalies, ...landAnomalies];
    const enso = computeENSOIndex(sstAnomalies);
    const pdo = computePDOIndex(sstAnomalies);
    const nao = computeNAOIndex(sstAnomalies, stations, measurements);

    const teleconnectionIndices: TeleconnectionIndex[] = [
      {
        name: 'ENSO',
        fullName: 'El Niño-Southern Oscillation',
        value: enso.value,
        category: enso.category,
        description: enso.description,
        confidence: sstAnomalies.filter((a) => a.regionId.includes('pacific')).reduce((sum, a) => sum + a.stationCount, 0) >= 5 ? 'high' : 'medium',
        contributingRegions: ['north_pacific', 'south_pacific'],
      },
      {
        name: 'PDO',
        fullName: 'Pacific Decadal Oscillation',
        value: pdo.value,
        category: pdo.category,
        description: pdo.description,
        confidence: (sstAnomalies.find((a) => a.regionId === 'north_pacific')?.stationCount ?? 0) >= 3 ? 'medium' : 'low',
        contributingRegions: ['north_pacific'],
      },
      {
        name: 'NAO',
        fullName: 'North Atlantic Oscillation (proxy)',
        value: nao.value,
        category: nao.category,
        description: nao.description,
        confidence: (sstAnomalies.find((a) => a.regionId === 'north_atlantic')?.stationCount ?? 0) >= 3 ? 'medium' : 'low',
        contributingRegions: ['north_atlantic'],
      },
    ];

    // 5. Compute ocean→land correlations
    const correlations = computeCorrelations(oceanRegions, landRegions);

    // 6. Global means
    const globalMeanSSTAnomaly = sstAnomalies.length > 0 ? mean(sstAnomalies.map((a) => a.avgAnomaly)) : 0;
    const globalMeanAirTempAnomaly = landAnomalies.length > 0 ? mean(landAnomalies.map((a) => a.avgAnomaly)) : 0;

    // 7. Identify dominant coupled pattern
    let coupledPattern = 'No significant coupled pattern detected';
    if (Math.abs(enso.value) >= 0.5) {
      coupledPattern = `${enso.category} pattern dominant — Pacific SST anomalies ${enso.value > 0 ? 'warming' : 'cooling'} land temperatures globally with ~48-96h lag`;
      notes.push(`ENSO index ${enso.value.toFixed(2)}: ${enso.description}`);
    } else if (Math.abs(pdo.value) >= 0.5) {
      coupledPattern = `PDO ${pdo.value > 0 ? 'positive' : 'negative'} phase — North Pacific SST anomalies influencing North American weather`;
      notes.push(`PDO index ${pdo.value.toFixed(2)}: ${pdo.description}`);
    } else if (Math.abs(nao.value) >= 0.5) {
      coupledPattern = `NAO ${nao.value > 0 ? 'positive' : 'negative'} phase — North Atlantic pressure pattern driving European weather`;
      notes.push(`NAO index ${nao.value.toFixed(2)}: ${nao.description}`);
    }

    if (correlations.length > 0) {
      const strongest = correlations.reduce((a, b) => (Math.abs(b.correlation) > Math.abs(a.correlation) ? b : a));
      notes.push(`Strongest ocean→land correlation: ${strongest.description} (r=${strongest.correlation.toFixed(2)})`);
    }

    notes.push(`Global mean SST anomaly: ${globalMeanSSTAnomaly >= 0 ? '+' : ''}${globalMeanSSTAnomaly.toFixed(2)}°C`);
    notes.push(`Global mean air temp anomaly: ${globalMeanAirTempAnomaly >= 0 ? '+' : ''}${globalMeanAirTempAnomaly.toFixed(2)}°C`);
    notes.push(`Ocean regions with data: ${sstAnomalies.length}, Land regions: ${landAnomalies.length}`);

    // Confidence based on data coverage
    const totalOceanStations = sstAnomalies.reduce((sum, a) => sum + a.stationCount, 0);
    const totalLandStations = landAnomalies.reduce((sum, a) => sum + a.stationCount, 0);
    let confidence: PredictionConfidence = 'low';
    if (totalOceanStations >= 20 && totalLandStations >= 10) confidence = 'high';
    else if (totalOceanStations >= 10 && totalLandStations >= 5) confidence = 'medium';

    return {
      timestamp: Date.now(),
      sstAnomalies: allAnomalies,
      teleconnectionIndices,
      correlations,
      globalMeanSSTAnomaly,
      globalMeanAirTempAnomaly,
      coupledPattern,
      confidence,
      method: 'Regional SST anomaly analysis + teleconnection index computation + Pearson ocean→land correlation',
      notes,
    };
  }
}
