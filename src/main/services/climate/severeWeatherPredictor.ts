import { ClimateStation, ClimateMeasurement, Storm, LightningStrike } from './climateTypes';
import { classifyRegion } from './regionClassification';
import {
  SevereWeatherPrediction,
  SevereWeatherAlert,
  PrecipitationForecast,
  PrecipitationForecastCell,
  RiskLevel,
  PredictionConfidence,
} from './predictionTypes';
import { OceanAtmosphereCoupling } from './predictionTypes';

/**
 * Severe Weather + Precipitation Predictor
 *
 * Unified model that combines ALL available data sources as a connected network:
 * - Lightning density (Blitzortung)
 * - Pressure gradients (NDBC buoys + METAR stations)
 * - Wind speed/direction (buoys + weather stations)
 * - Storm cells (NHC + NWS alerts)
 * - SST anomalies (ocean-atmosphere coupling)
 * - Air temperature anomalies
 * - Wave height (coastal flood risk)
 *
 * Instead of reacting to single-station thresholds, this model:
 * 1. Builds a spatial grid of atmospheric conditions
 * 2. Detects clusters of dangerous conditions
 * 3. Issues severe weather alerts with spatial extent and time validity
 * 4. Forecasts precipitation using moisture flux + pressure tendencies + radar nowcast
 */

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

interface AtmosphericGridCell {
  centerLat: number;
  centerLon: number;
  stations: { lat: number; lon: number; pressure?: number; windSpeed?: number; airTemp?: number; waterTemp?: number; waveHeight?: number }[];
  lightningCount: number;
  stormCount: number;
}

/**
 * Build a spatial grid from station data and lightning/storms
 */
function buildSpatialGrid(
  stations: ClimateStation[],
  measurements: Map<string, ClimateMeasurement>,
  lightning: { lat: number; lon: number; timestamp: number }[],
  storms: Storm[],
  cellSizeDeg: number = 5
): AtmosphericGridCell[] {
  const grid = new Map<string, AtmosphericGridCell>();

  // Add station data to grid
  for (const s of stations) {
    const m = measurements.get(s.id);
    if (!m) continue;
    const gridLat = Math.round(s.lat / cellSizeDeg) * cellSizeDeg;
    const gridLon = Math.round(s.lon / cellSizeDeg) * cellSizeDeg;
    const key = `${gridLat},${gridLon}`;
    let cell = grid.get(key);
    if (!cell) {
      cell = { centerLat: gridLat, centerLon: gridLon, stations: [], lightningCount: 0, stormCount: 0 };
      grid.set(key, cell);
    }
    cell.stations.push({
      lat: s.lat,
      lon: s.lon,
      pressure: m.pressure,
      windSpeed: m.windSpeed,
      airTemp: m.airTemp,
      waterTemp: m.waterTemp,
      waveHeight: m.waveHeight,
    });
  }

  // Add lightning counts to grid (last 2 hours)
  const now = Date.now();
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  for (const strike of lightning) {
    if (strike.timestamp < twoHoursAgo) continue;
    const gridLat = Math.round(strike.lat / cellSizeDeg) * cellSizeDeg;
    const gridLon = Math.round(strike.lon / cellSizeDeg) * cellSizeDeg;
    const key = `${gridLat},${gridLon}`;
    let cell = grid.get(key);
    if (!cell) {
      cell = { centerLat: gridLat, centerLon: gridLon, stations: [], lightningCount: 0, stormCount: 0 };
      grid.set(key, cell);
    }
    cell.lightningCount++;
  }

  // Add storm counts to grid
  for (const storm of storms) {
    const gridLat = Math.round(storm.lat / cellSizeDeg) * cellSizeDeg;
    const gridLon = Math.round(storm.lon / cellSizeDeg) * cellSizeDeg;
    const key = `${gridLat},${gridLon}`;
    let cell = grid.get(key);
    if (!cell) {
      cell = { centerLat: gridLat, centerLon: gridLon, stations: [], lightningCount: 0, stormCount: 0 };
      grid.set(key, cell);
    }
    cell.stormCount++;
  }

  return Array.from(grid.values());
}

function riskFromScore(score: number): RiskLevel {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.4) return 'moderate';
  if (score >= 0.2) return 'low';
  return 'none';
}

export class SevereWeatherPredictor {
  /**
   * Generate severe weather alerts from the unified data network
   */
  predict(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
    lightning: { lat: number; lon: number; timestamp: number }[],
    storms: Storm[],
    coupling: OceanAtmosphereCoupling | null
  ): SevereWeatherPrediction {
    const notes: string[] = [];
    const alerts: SevereWeatherAlert[] = [];
    const now = Date.now();

    const grid = buildSpatialGrid(stations, measurements, lightning, storms);

    // ENSO influence: El Niño increases storm activity in some regions
    const ensoIndex = coupling?.teleconnectionIndices.find((t) => t.name === 'ENSO');
    const ensoBoost = ensoIndex ? Math.abs(ensoIndex.value) * 0.15 : 0;

    for (const cell of grid) {
      if (cell.stations.length === 0 && cell.lightningCount === 0 && cell.stormCount === 0) continue;

      const pressures = cell.stations.map((s) => s.pressure).filter((p): p is number => p !== undefined);
      const windSpeeds = cell.stations.map((s) => s.windSpeed).filter((w): w is number => w !== undefined);
      const airTemps = cell.stations.map((s) => s.airTemp).filter((t): t is number => t !== undefined);
      const waterTemps = cell.stations.map((s) => s.waterTemp).filter((t): t is number => t !== undefined);
      const waveHeights = cell.stations.map((s) => s.waveHeight).filter((w): w is number => w !== undefined);

      const avgPressure = pressures.length > 0 ? mean(pressures) : 1013;
      const maxWind = windSpeeds.length > 0 ? Math.max(...windSpeeds) : 0;
      const avgAirTemp = airTemps.length > 0 ? mean(airTemps) : 20;
      const avgWaterTemp = waterTemps.length > 0 ? mean(waterTemps) : 20;
      const maxWave = waveHeights.length > 0 ? Math.max(...waveHeights) : 0;

      const region = classifyRegion(cell.centerLat, cell.centerLon, 'weather_station');
      const regionName = region?.name || 'Unknown';

      // === Thunderstorm risk ===
      let thunderstormScore = 0;
      const factors: { factor: string; value: string; weight: number }[] = [];

      if (cell.lightningCount > 0) {
        const lightningScore = Math.min(cell.lightningCount / 20, 1) * 0.4;
        thunderstormScore += lightningScore + ensoBoost;
        factors.push({ factor: 'Lightning density', value: `${cell.lightningCount} strikes/2h`, weight: lightningScore });
      }
      if (avgPressure < 1005) {
        const pressureScore = Math.min((1005 - avgPressure) / 25, 1) * 0.3;
        thunderstormScore += pressureScore;
        factors.push({ factor: 'Low pressure', value: `${avgPressure.toFixed(0)} hPa`, weight: pressureScore });
      }
      if (maxWind > 20) {
        const windScore = Math.min(maxWind / 50, 1) * 0.2;
        thunderstormScore += windScore;
        factors.push({ factor: 'Wind speed', value: `${maxWind.toFixed(0)} m/s`, weight: windScore });
      }
      if (avgWaterTemp > 26 && avgAirTemp > 25) {
        const thermoScore = 0.15;
        thunderstormScore += thermoScore;
        factors.push({ factor: 'Thermodynamic potential', value: `SST ${avgWaterTemp.toFixed(1)}°C, Air ${avgAirTemp.toFixed(1)}°C`, weight: thermoScore });
      }

      if (thunderstormScore >= 0.3) {
        const severity = riskFromScore(thunderstormScore);
        if (severity !== 'none') {
          alerts.push({
            id: `thunderstorm-${cell.centerLat}-${cell.centerLon}-${now}`,
            timestamp: now,
            alertType: 'thunderstorm_risk',
            severity,
            centerLat: cell.centerLat,
            centerLon: cell.centerLon,
            radiusKm: 200,
            title: `${severity === 'critical' ? 'Severe' : severity === 'high' ? 'Significant' : 'Possible'} Thunderstorm Risk — ${regionName}`,
            description: `${cell.lightningCount} lightning strikes in 2h, pressure ${avgPressure.toFixed(0)} hPa, max wind ${maxWind.toFixed(0)} m/s. ${ensoIndex && Math.abs(ensoIndex.value) >= 0.5 ? `Influenced by ${ensoIndex.category} conditions.` : ''}`,
            validFrom: now,
            validUntil: now + 6 * 60 * 60 * 1000,
            contributingFactors: factors,
            confidence: cell.stations.length >= 3 ? 'high' : cell.stations.length >= 1 ? 'medium' : 'low',
            affectedRegions: [regionName],
          });
        }
      }

      // === High wind risk ===
      if (maxWind > 25) {
        const windRiskScore = Math.min(maxWind / 60, 1);
        const severity = riskFromScore(windRiskScore);
        if (severity !== 'none' && severity !== 'low') {
          alerts.push({
            id: `highwind-${cell.centerLat}-${cell.centerLon}-${now}`,
            timestamp: now,
            alertType: 'high_wind_risk',
            severity,
            centerLat: cell.centerLat,
            centerLon: cell.centerLon,
            radiusKm: 150,
            title: `High Wind Risk — ${regionName}`,
            description: `Sustained winds ${maxWind.toFixed(0)} m/s detected. ${cell.stormCount > 0 ? 'Storm system in area.' : ''}`,
            validFrom: now,
            validUntil: now + 3 * 60 * 60 * 1000,
            contributingFactors: [
              { factor: 'Max wind speed', value: `${maxWind.toFixed(0)} m/s`, weight: windRiskScore },
            ],
            confidence: 'high',
            affectedRegions: [regionName],
          });
        }
      }

      // === Hurricane/tropical cyclone risk ===
      if (cell.stormCount > 0) {
        const nearbyStorms = storms.filter((s) => haversineKm(s.lat, s.lon, cell.centerLat, cell.centerLon) < 300);
        for (const storm of nearbyStorms) {
          const windKt = storm.windSpeedKt ?? 0;
          if (windKt < 34) continue;
          const stormScore = Math.min(windKt / 137, 1);
          const severity = riskFromScore(stormScore);
          alerts.push({
            id: `hurricane-${storm.id}-${now}`,
            timestamp: now,
            alertType: 'hurricane_risk',
            severity,
            centerLat: storm.lat,
            centerLon: storm.lon,
            radiusKm: 300 + windKt * 2,
            title: `${storm.classification || 'Tropical System'} — ${storm.name}`,
            description: `${storm.intensity} with ${windKt} kt winds, pressure ${storm.pressureMB ?? 'unknown'} hPa. SST in region: ${avgWaterTemp.toFixed(1)}°C. ${avgWaterTemp > 26.5 ? 'Warm waters may support intensification.' : 'Cool waters may weaken system.'}`,
            validFrom: now,
            validUntil: now + 24 * 60 * 60 * 1000,
            contributingFactors: [
              { factor: 'Wind speed', value: `${windKt} kt`, weight: Math.min(windKt / 137, 1) * 0.5 },
              { factor: 'SST', value: `${avgWaterTemp.toFixed(1)}°C`, weight: avgWaterTemp > 26.5 ? 0.3 : 0.1 },
              { factor: 'ENSO influence', value: ensoIndex?.category || 'N/A', weight: ensoBoost },
            ],
            confidence: 'high',
            affectedRegions: [regionName, storm.basin],
          });
        }
      }

      // === Flood risk (coastal) ===
      if (maxWave > 3 || (maxWave > 2 && avgPressure < 1000)) {
        const floodScore = Math.min(maxWave / 8, 1) + (avgPressure < 1000 ? 0.2 : 0);
        const severity = riskFromScore(floodScore);
        if (severity !== 'none' && severity !== 'low') {
          alerts.push({
            id: `flood-${cell.centerLat}-${cell.centerLon}-${now}`,
            timestamp: now,
            alertType: 'flood_risk',
            severity,
            centerLat: cell.centerLat,
            centerLon: cell.centerLon,
            radiusKm: 100,
            title: `Coastal Flood Risk — ${regionName}`,
            description: `Wave height ${maxWave.toFixed(1)} m, pressure ${avgPressure.toFixed(0)} hPa. ${cell.stormCount > 0 ? 'Storm surge possible.' : ''}`,
            validFrom: now,
            validUntil: now + 12 * 60 * 60 * 1000,
            contributingFactors: [
              { factor: 'Wave height', value: `${maxWave.toFixed(1)} m`, weight: Math.min(maxWave / 8, 1) * 0.6 },
              { factor: 'Pressure', value: `${avgPressure.toFixed(0)} hPa`, weight: avgPressure < 1000 ? 0.3 : 0.1 },
            ],
            confidence: 'medium',
            affectedRegions: [regionName],
          });
        }
      }

      // === Heatwave risk ===
      if (avgAirTemp > 35) {
        const heatScore = Math.min((avgAirTemp - 35) / 10, 1);
        const severity = riskFromScore(heatScore);
        if (severity !== 'none') {
          // Check if ENSO is contributing
          const ensoContribution = ensoIndex && ensoIndex.value > 0.5 ? 0.2 : 0;
          alerts.push({
            id: `heatwave-${cell.centerLat}-${cell.centerLon}-${now}`,
            timestamp: now,
            alertType: 'heatwave_risk',
            severity: riskFromScore(heatScore + ensoContribution),
            centerLat: cell.centerLat,
            centerLon: cell.centerLon,
            radiusKm: 200,
            title: `Heatwave Risk — ${regionName}`,
            description: `Air temperature ${avgAirTemp.toFixed(1)}°C. ${ensoIndex && ensoIndex.value > 0.5 ? `Amplified by ${ensoIndex.category} conditions.` : ''}`,
            validFrom: now,
            validUntil: now + 48 * 60 * 60 * 1000,
            contributingFactors: [
              { factor: 'Air temperature', value: `${avgAirTemp.toFixed(1)}°C`, weight: heatScore * 0.7 },
              { factor: 'ENSO influence', value: ensoIndex?.category || 'Neutral', weight: ensoContribution },
            ],
            confidence: 'high',
            affectedRegions: [regionName],
          });
        }
      }

      // === Cold spell risk ===
      if (avgAirTemp < -15) {
        const coldScore = Math.min((-15 - avgAirTemp) / 25, 1);
        const severity = riskFromScore(coldScore);
        if (severity !== 'none') {
          alerts.push({
            id: `coldspell-${cell.centerLat}-${cell.centerLon}-${now}`,
            timestamp: now,
            alertType: 'cold_spell_risk',
            severity,
            centerLat: cell.centerLat,
            centerLon: cell.centerLon,
            radiusKm: 200,
            title: `Cold Spell Risk — ${regionName}`,
            description: `Air temperature ${avgAirTemp.toFixed(1)}°C. ${ensoIndex && ensoIndex.value < -0.5 ? `Amplified by ${ensoIndex.category} conditions.` : ''}`,
            validFrom: now,
            validUntil: now + 48 * 60 * 60 * 1000,
            contributingFactors: [
              { factor: 'Air temperature', value: `${avgAirTemp.toFixed(1)}°C`, weight: coldScore },
            ],
            confidence: 'high',
            affectedRegions: [regionName],
          });
        }
      }
    }

    // Sort by severity
    const riskOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, none: 4 };
    alerts.sort((a, b) => (riskOrder[a.severity] ?? 5) - (riskOrder[b.severity] ?? 5));

    // Global risk index
    const globalRiskIndex = alerts.length > 0
      ? Math.min(alerts.reduce((sum, a) => sum + (riskOrder[a.severity] === 0 ? 1 : riskOrder[a.severity] === 1 ? 0.6 : 0.3), 0) / 10, 1)
      : 0;

    notes.push(`${alerts.length} severe weather alerts generated from ${grid.length} grid cells`);
    notes.push(`${lightning.length} lightning strikes, ${storms.length} active storms in network`);
    if (ensoBoost > 0) notes.push(`ENSO boost: +${ensoBoost.toFixed(2)} to thunderstorm scores`);

    return {
      timestamp: now,
      alerts,
      globalRiskIndex,
      method: 'Spatial grid analysis + multi-source fusion (lightning + pressure + wind + SST + storms + ENSO coupling)',
      notes,
    };
  }

  /**
   * Forecast precipitation using atmospheric moisture + pressure tendencies + radar nowcast
   */
  forecastPrecipitation(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
    coupling: OceanAtmosphereCoupling | null,
    radarNowcastCells: { lat: number; lon: number; intensity: number; radiusKm: number }[]
  ): PrecipitationForecast {
    const notes: string[] = [];
    const now = Date.now();
    const cells: PrecipitationForecastCell[] = [];

    // Build grid for precipitation forecasting
    const grid = buildSpatialGrid(stations, measurements, [], [], 5);

    for (const cell of grid) {
      const pressures = cell.stations.map((s) => s.pressure).filter((p): p is number => p !== undefined);
      const windSpeeds = cell.stations.map((s) => s.windSpeed).filter((w): w is number => w !== undefined);
      const airTemps = cell.stations.map((s) => s.airTemp).filter((t): t is number => t !== undefined);
      const waterTemps = cell.stations.map((s) => s.waterTemp).filter((t): t is number => t !== undefined);

      if (pressures.length === 0 && airTemps.length === 0) continue;

      const avgPressure = pressures.length > 0 ? mean(pressures) : 1013;
      const avgWind = windSpeeds.length > 0 ? mean(windSpeeds) : 0;
      const avgAirTemp = airTemps.length > 0 ? mean(airTemps) : 15;
      const avgWaterTemp = waterTemps.length > 0 ? mean(waterTemps) : 15;

      // Precipitation probability model:
      // - Low pressure → higher probability
      // - High humidity (proxy: air temp - dew point, but we use water temp proximity)
      // - Wind speed (moisture transport)
      // - SST anomaly (warm ocean → more evaporation → more precip)
      // - Radar nowcast cells in vicinity

      let prob = 0.1; // baseline

      // Pressure contribution
      if (avgPressure < 1010) {
        prob += Math.min((1010 - avgPressure) / 30, 1) * 0.3;
      }

      // Wind contribution (moisture transport)
      if (avgWind > 5) {
        prob += Math.min(avgWind / 30, 1) * 0.15;
      }

      // Ocean-land temperature contrast (moisture flux)
      if (avgWaterTemp > avgAirTemp + 3) {
        prob += 0.15;
      }

      // ENSO influence
      const enso = coupling?.teleconnectionIndices.find((t) => t.name === 'ENSO');
      if (enso && enso.value > 0.5) {
        prob += 0.1; // El Niño tends to increase precipitation in some regions
      }

      // Radar nowcast contribution
      const nearbyRadar = radarNowcastCells.filter(
 (c) => haversineKm(c.lat, c.lon, cell.centerLat, cell.centerLon) < 200
      );
      if (nearbyRadar.length > 0) {
        const maxIntensity = Math.max(...nearbyRadar.map((c) => c.intensity));
        prob += maxIntensity * 0.3;
      }

      prob = Math.min(prob, 0.95);

      // Only include cells with meaningful precipitation probability
      if (prob < 0.2) continue;

      // Estimate intensity (mm/h) from pressure deficit + wind + moisture
      let intensityMm = 0;
      if (avgPressure < 1005) {
        intensityMm += (1005 - avgPressure) * 0.3;
      }
      intensityMm += avgWind * 0.1;
      if (avgWaterTemp > avgAirTemp + 3) {
        intensityMm += 2;
      }
      if (nearbyRadar.length > 0) {
        intensityMm += Math.max(...nearbyRadar.map((c) => c.intensity)) * 10;
      }
      intensityMm = Math.max(intensityMm, prob * 5); // at least scale with probability

      // Generate forecast cells at 1h, 3h, 6h ahead
      for (const hoursAhead of [1, 3, 6]) {
        // Probability decays slightly with time
        const timeDecay = 1 - (hoursAhead / 12) * 0.3;
        cells.push({
          lat: cell.centerLat,
          lon: cell.centerLon,
          hoursFromNow: hoursAhead,
          intensityMm: Math.round(intensityMm * timeDecay * 10) / 10,
          probability: Math.round(prob * timeDecay * 100) / 100,
          confidenceRadiusKm: 50 + hoursAhead * 20,
        });
      }
    }

    const maxIntensityMm = cells.length > 0 ? Math.max(...cells.map((c) => c.intensityMm)) : 0;
    const coveragePercent = grid.length > 0 ? Math.round((cells.filter((c) => c.hoursFromNow === 1).length / grid.length) * 100) : 0;

    let confidence: PredictionConfidence = 'low';
    const totalStations = grid.reduce((sum, c) => sum + c.stations.length, 0);
    if (totalStations >= 20 && radarNowcastCells.length > 0) confidence = 'high';
    else if (totalStations >= 10) confidence = 'medium';

    notes.push(`${cells.length} precipitation forecast cells from ${grid.length} grid regions`);
    notes.push(`Max intensity: ${maxIntensityMm.toFixed(1)} mm/h, coverage: ${coveragePercent}%`);
    if (radarNowcastCells.length > 0) notes.push(`Blended with ${radarNowcastCells.length} radar nowcast cells`);

    return {
      timestamp: now,
      validUntil: now + 6 * 60 * 60 * 1000,
      cells,
      maxIntensityMm,
      coveragePercent,
      confidence,
      method: 'Atmospheric moisture flux + pressure tendency + SST anomaly + radar nowcast fusion',
      notes,
    };
  }
}
