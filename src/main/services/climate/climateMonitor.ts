import { ClimateStation, ClimateMeasurement, ClimateStats, TrafficDataPoint, ClimateAlert, DataSource, IntegritySummary, IntegrityUpdate, SensorHealth, DataFlowHealth, CrossVerification, Storm, LightningStrike, Vessel, RegionalAverage, Aircraft, Earthquake, SpaceWeatherData, Wildfire } from './climateTypes';
import { ErddapFetcher } from './dataFetcher';
import { WeatherFetcher, StormFetcher, LightningFetcher, AircraftFetcher, SeismicFetcher, SpaceWeatherFetcher, WildfireFetcher } from './weatherFetcher';
import { SensorVerifier } from './sensorVerifier';
import { DataFlowMonitor } from './dataFlowMonitor';
import { ResultsVerifier } from './resultsVerifier';
import { HeuristicWatchdog } from './heuristicWatchdog';
import { VesselFetcher } from './vesselFetcher';
import { classifyRegion } from './regionClassification';
import { PredictionEngine } from './predictionEngine';

const STALE_DATA_MINUTES = 120;

const SOURCE_EXPECTED_INTERVAL_MS: Record<DataSource, number> = {
  NOAA_NDBC: 10 * 60 * 1000,
  ARGO: 10 * 24 * 60 * 60 * 1000,
  BGC_ARGO: 10 * 24 * 60 * 60 * 1000,
  NOAA_ERDDAP: 10 * 60 * 1000,
  GTSPP: 24 * 60 * 60 * 1000,
  TAO_PIRATA: 24 * 60 * 60 * 1000,
  PMEL_CO2: 3 * 60 * 60 * 1000,
  NWS_WEATHER: 60 * 60 * 1000,
  NHC_STORM: 2 * 60 * 1000,
  BLITZORTUNG_LIGHTNING: 60 * 1000,
};

const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000;
const INVALIDATION_RESET_MS = 2 * 60 * 60 * 1000;

export class ClimateMonitor {
  private stations: ClimateStation[] = [];
  private measurements = new Map<string, ClimateMeasurement>();
  private previousStationIds = new Set<string>();
  private onUpdate: (stations: ClimateStation[], measurements: [string, ClimateMeasurement][], stats: ClimateStats) => void;
  private onTraffic: (data: TrafficDataPoint) => void;
  private onAlert: (alert: ClimateAlert) => void;
  private onIntegrityUpdate: (update: IntegrityUpdate) => void;
  private intervalId: NodeJS.Timeout | null = null;
  private fetchInProgress = false;
  private snoozeUntil = 0;
  private whitelistedStations = new Set<string>();
  private invalidatedStations = new Map<string, { reason: string; since: number }>();
  private lastMeasurementTimestamps = new Map<string, number>();

  private sensorVerifier: SensorVerifier;
  private dataFlowMonitor: DataFlowMonitor;
  private resultsVerifier: ResultsVerifier;
  private heuristicWatchdog: HeuristicWatchdog;
  private predictionEngine: PredictionEngine | null = null;
  private lastSensorHealth = new Map<string, SensorHealth>();

  private lastIntegritySummary: IntegritySummary | null = null;
  private lastStorms: Storm[] = [];
  private lastLightning: LightningStrike[] = [];
  private lastAircraft: Aircraft[] = [];
  private lastVessels: Vessel[] = [];
  private lastEarthquakes: Earthquake[] = [];
  private lastSpaceWeather: SpaceWeatherData | null = null;
  private lastWildfires: Wildfire[] = [];

  // Viewport bounds set by the renderer — used to cull vessels/aircraft before sending over IPC
  private viewportBounds: { n: number; s: number; e: number; w: number } | null = null;

  constructor(
    onUpdate: (stations: ClimateStation[], measurements: [string, ClimateMeasurement][], stats: ClimateStats) => void,
    onTraffic: (data: TrafficDataPoint) => void,
    onAlert: (alert: ClimateAlert) => void,
    onIntegrityUpdate: (update: IntegrityUpdate) => void
  ) {
    this.onUpdate = onUpdate;
    this.onTraffic = onTraffic;
    this.onAlert = onAlert;
    this.onIntegrityUpdate = onIntegrityUpdate;

    this.sensorVerifier = new SensorVerifier((alert) => this.emitAlert(alert));
    this.dataFlowMonitor = new DataFlowMonitor((alert) => this.emitAlert(alert));
    this.resultsVerifier = new ResultsVerifier((alert) => this.emitAlert(alert));
    this.heuristicWatchdog = new HeuristicWatchdog((alert) => this.emitAlert(alert));
  }

  setPredictionEngine(engine: PredictionEngine) {
    this.predictionEngine = engine;
  }

  private emitAlert(alert: ClimateAlert) {
    if (this.isSnoozed()) return;
    if (this.whitelistedStations.has(alert.stationId)) return;
    this.onAlert(alert);
  }

  start() {
    this.fetchAll();
    this.intervalId = setInterval(() => this.fetchAll(), 4 * 60 * 1000);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  getPendingCount(): number {
    return this.fetchInProgress ? 1 : 0;
  }

  whitelistStation(stationId: string) {
    this.whitelistedStations.add(stationId);
  }

  unwhitelistStation(stationId: string) {
    this.whitelistedStations.delete(stationId);
  }

  getWhitelistedStations(): string[] {
    return Array.from(this.whitelistedStations);
  }

  setSnooze(ms: number) {
    this.snoozeUntil = ms > 0 ? Date.now() + ms : 0;
  }

  isSnoozed(): boolean {
    return Date.now() < this.snoozeUntil;
  }

  // Expose latest weather data for cross-domain influence (Phase 3)
  getStorms(): Storm[] {
    return this.lastStorms;
  }

  getLightning(): LightningStrike[] {
    return this.lastLightning;
  }

  getAircraft(): Aircraft[] {
    return this.lastAircraft;
  }

  getEarthquakes(): Earthquake[] {
    return this.lastEarthquakes;
  }

  getSpaceWeather(): SpaceWeatherData | null {
    return this.lastSpaceWeather;
  }

  getWildfires(): Wildfire[] {
    return this.lastWildfires;
  }

  // Expose stations + measurements for the HTTP server (HyperForge integration)
  getStations(): ClimateStation[] {
    return this.stations;
  }

  getMeasurements(): Map<string, ClimateMeasurement> {
    return this.measurements;
  }

  /** Called by the renderer via IPC to set the current map viewport bounds. */
  setViewportBounds(bounds: { n: number; s: number; e: number; w: number } | null) {
    this.viewportBounds = bounds;
    // Also update the AircraftFetcher so it queries OpenSky with a bounding box
    // (dramatically reduces fetch payload and API credits)
    AircraftFetcher.setBounds(bounds);
  }

  /** Cull an array of lat/lon objects to the current viewport (with padding). Returns all if no viewport set. */
  private cullToViewport<T extends { lat: number; lon: number }>(items: T[], padDeg = 10): T[] {
    if (!this.viewportBounds) return items;
    const { n, s, e, w } = this.viewportBounds;
    // Handle viewport padding and longitude wrapping
    const south = s - padDeg;
    const north = n + padDeg;
    const west = w - padDeg;
    const east = e + padDeg;
    // If viewport spans most of the globe, just return everything
    if (north - south > 170) return items;
    return items.filter((item) => {
      if (item.lat < south || item.lat > north) return false;
      // Handle longitude wrap-around
      if (west < -180 && east > 180) return true;
      if (west < -180) {
        return item.lon >= west + 360 || item.lon <= east;
      }
      if (east > 180) {
        return item.lon >= west || item.lon <= east - 360;
      }
      return item.lon >= west && item.lon <= east;
    });
  }

  private async fetchAll() {
    if (this.fetchInProgress) return;
    this.fetchInProgress = true;

    const allStations: ClimateStation[] = [];
    const allMeasurements = new Map<string, ClimateMeasurement>();
    const dataFlowResults: DataFlowHealth[] = [];

    const sourceConfigs: { source: DataSource; fetchFn: () => Promise<{ stations: ClimateStation[]; measurements: Map<string, ClimateMeasurement> }> }[] = [
      { source: 'NOAA_NDBC', fetchFn: async () => ErddapFetcher.fetchNDBC() },
      { source: 'TAO_PIRATA', fetchFn: async () => ErddapFetcher.fetchTAO() },
      { source: 'TAO_PIRATA', fetchFn: async () => ErddapFetcher.fetchTAOCurrents() },
      { source: 'TAO_PIRATA', fetchFn: async () => ErddapFetcher.fetchTAOSalinity() },
      { source: 'GTSPP', fetchFn: async () => ErddapFetcher.fetchGTSPP() },
      { source: 'ARGO', fetchFn: async () => ErddapFetcher.fetchArgo() },
      { source: 'PMEL_CO2', fetchFn: async () => ErddapFetcher.fetchCO2() },
      { source: 'NWS_WEATHER', fetchFn: async () => WeatherFetcher.fetchNWS() },
    ];

    const fetchResults = await Promise.all(
      sourceConfigs.map(async (cfg) => {
        const startTime = Date.now();
        try {
          const result = await cfg.fetchFn();
          const latency = Date.now() - startTime;
          const payloadSize = JSON.stringify(result).length;

          const flowHealth = this.dataFlowMonitor.recordFetch(
            cfg.source,
            latency,
            payloadSize,
            result.stations.length,
            result.stations.length,
            new Map(Array.from(result.measurements.entries()).map(([k, v]) => [k, { timestamp: v.timestamp, stationId: k }])),
            true
          );
          dataFlowResults.push(flowHealth);

          return result;
        } catch (e) {
          const latency = Date.now() - startTime;
          const flowHealth = this.dataFlowMonitor.recordFetch(
            cfg.source,
            latency,
            0,
            0,
            0,
            new Map(),
            false
          );
          dataFlowResults.push(flowHealth);
          return null;
        }
      })
    );

    for (const result of fetchResults) {
      if (result) {
        allStations.push(...result.stations);
        result.measurements.forEach((v, k) => allMeasurements.set(k, v));
      }
    }

    const newStations: ClimateStation[] = [];
    for (const s of allStations) {
      if (!this.previousStationIds.has(s.id)) {
        newStations.push(s);
        this.emitAlert({
          id: `new_sensor_${s.id}_${Date.now()}`,
          timestamp: Date.now(),
          type: 'new_sensor',
          stationId: s.id,
          stationName: s.name,
          source: s.source,
          lat: s.lat,
          lon: s.lon,
          message: `New sensor detected: ${s.name} (${s.source})`,
          severity: 'info',
        });
      }
    }

    const quickStats = this.computeStats(allStations, allMeasurements);
    this.stations = allStations;
    this.measurements = allMeasurements;
    this.previousStationIds = new Set(allStations.map((s) => s.id));
    this.onUpdate(allStations, Array.from(allMeasurements.entries()), quickStats);

    this.onTraffic({
      timestamp: Date.now(),
      totalStations: allStations.length,
      activeStations: allStations.filter((s) => s.active).length,
      newMeasurements: allMeasurements.size,
      avgWaterTemp: quickStats.avgWaterTemp,
      avgCO2: quickStats.avgCO2,
      integrityScore: 0,
      sensorsVerified: 0,
      sensorsFlagged: 0,
    });

    const sensorHealth = this.sensorVerifier.verify(allStations, allMeasurements);
    this.lastSensorHealth = sensorHealth;

    const crossVerifications = await this.resultsVerifier.verify(allStations, allMeasurements);

    this.heuristicWatchdog.verify(allStations, allMeasurements, crossVerifications);

    this.applyInvalidation(allStations, allMeasurements, crossVerifications);

    const [storms, lightning, vessels, aircraft, earthquakes, spaceWeather, wildfires] = await Promise.all([
      StormFetcher.fetchActiveStorms(),
      LightningFetcher.fetchRecent(),
      VesselFetcher.fetchVessels(),
      AircraftFetcher.fetchAircraft(),
      SeismicFetcher.fetchRecent(),
      SpaceWeatherFetcher.fetch(),
      WildfireFetcher.fetchRecent(),
    ]);
    this.lastStorms = storms;
    this.lastLightning = lightning;
    this.lastVessels = vessels;
    this.lastAircraft = aircraft;
    this.lastEarthquakes = earthquakes;
    this.lastSpaceWeather = spaceWeather;
    this.lastWildfires = wildfires;

    const summary = this.computeIntegritySummary(sensorHealth, dataFlowResults, crossVerifications);
    this.lastIntegritySummary = summary;

    const stats = this.computeStats(allStations, allMeasurements);

    this.onIntegrityUpdate({
      sensorHealth: Array.from(sensorHealth.entries()),
      dataFlowHealth: dataFlowResults,
      crossVerifications,
      summary,
      timestamp: Date.now(),
      storms,
      lightningStrikes: lightning,
      vessels: this.cullToViewport(vessels),
      aircraft: this.cullToViewport(aircraft),
      earthquakes,
      spaceWeather,
      wildfires: this.cullToViewport(wildfires),
      newStations,
    });

    this.onTraffic({
      timestamp: Date.now(),
      totalStations: allStations.length,
      activeStations: allStations.filter((s) => s.active).length,
      newMeasurements: allMeasurements.size,
      avgWaterTemp: stats.avgWaterTemp,
      avgCO2: stats.avgCO2,
      integrityScore: summary.overallScore,
      sensorsVerified: summary.sensorsVerified,
      sensorsFlagged: summary.sensorsWarning + summary.sensorsFailed,
    });

    // Feed data to prediction engine and trigger a prediction cycle
    if (this.predictionEngine) {
      this.predictionEngine.updateClimateData(allStations, allMeasurements, storms, sensorHealth, this.lastLightning);
      this.predictionEngine.runPredictions();
    }

    this.fetchInProgress = false;
  }

  private applyInvalidation(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
    crossVerifications: CrossVerification[]
  ) {
    const INVALIDATING_FLAG_TYPES = new Set([
      'cluster_outlier',
      'cross_source_mismatch',
      'regional_anomaly',
      'stuck_sensor',
    ]);

    for (const ver of crossVerifications) {
      const station = stations.find((s) => s.id === ver.stationId);
      const isArgo = station?.source === 'ARGO' || station?.source === 'BGC_ARGO';
      const isCO2 = station?.source === 'PMEL_CO2';

      const invalidatingFlags = ver.flags.filter(
        (f) => !isArgo && !isCO2 && INVALIDATING_FLAG_TYPES.has(f.type) && f.severity === 'critical'
      );

      if (invalidatingFlags.length > 0) {
        const existing = this.invalidatedStations.get(ver.stationId);

        if (!existing) {
          const reason = invalidatingFlags
            .map((f) => `${f.type}: ${f.message}`)
            .join('; ');
          this.invalidatedStations.set(ver.stationId, {
            reason,
            since: Date.now(),
          });
        }
      }
    }

    const toReset: string[] = [];
    for (const [stationId, info] of this.invalidatedStations) {
      const m = measurements.get(stationId);
      if (!m) continue;

      const prevTs = this.lastMeasurementTimestamps.get(stationId);
      const currentTs = m.timestamp;

      if (prevTs !== undefined && currentTs !== prevTs && currentTs > prevTs) {
        toReset.push(stationId);
        continue;
      }

      const station = stations.find((s) => s.id === stationId);
      if (station) {
        if (Date.now() - info.since > INVALIDATION_RESET_MS) {
          toReset.push(stationId);
        }
      }
    }

    for (const stationId of toReset) {
      this.invalidatedStations.delete(stationId);
    }

    for (const [stationId, m] of measurements) {
      this.lastMeasurementTimestamps.set(stationId, m.timestamp);
    }

    // Clean up timestamps for stations that no longer exist
    const currentIds = new Set(measurements.keys());
    for (const id of this.lastMeasurementTimestamps.keys()) {
      if (!currentIds.has(id)) this.lastMeasurementTimestamps.delete(id);
    }

    for (const station of stations) {
      const inv = this.invalidatedStations.get(station.id);
      if (inv) {
        station.invalidated = true;
        station.invalidationReason = inv.reason;
      } else {
        station.invalidated = false;
        station.invalidationReason = undefined;
      }
    }

    for (const ver of crossVerifications) {
      if (this.invalidatedStations.has(ver.stationId)) {
        ver.status = 'invalidated';
        ver.verificationScore = 0;
      }
    }
  }

  private computeIntegritySummary(
    sensorHealth: Map<string, SensorHealth>,
    dataFlow: DataFlowHealth[],
    crossVerifications: CrossVerification[]
  ): IntegritySummary {
    const sensors = Array.from(sensorHealth.values());
    const sensorsVerified = sensors.filter((s) => s.status === 'verified').length;
    const sensorsWarning = sensors.filter((s) => s.status === 'warning').length;
    const sensorsFailed = sensors.filter((s) => s.status === 'failed').length;

    const sensorLayerScore = sensors.length > 0
      ? sensors.reduce((a, s) => a + s.integrityScore, 0) / sensors.length
      : 0;

    const pipelinesActive = dataFlow.filter((d) => d.status === 'verified').length;
    const pipelinesDegraded = dataFlow.filter((d) => d.status === 'warning' || d.status === 'failed').length;
    const dataFlowLayerScore = dataFlow.length > 0
      ? dataFlow.reduce((a, d) => a + d.pipelineScore, 0) / dataFlow.length
      : 0;

    const resultsValidated = crossVerifications.length;
    const resultsFlagged = crossVerifications.filter((v) => v.flags.length > 0).length;
    const resultsLayerScore = crossVerifications.length > 0
      ? crossVerifications.reduce((a, v) => a + v.verificationScore, 0) / crossVerifications.length
      : 0;

    let totalFlags = 0;
    let criticalFlags = 0;
    let warningFlags = 0;
    let crossSourceMatches = 0;
    let crossSourceMismatches = 0;

    for (const v of crossVerifications) {
      for (const f of v.flags) {
        totalFlags++;
        if (f.severity === 'critical') criticalFlags++;
        else if (f.severity === 'warning') warningFlags++;
      }
      for (const cs of v.crossSourceAgreement) {
        if (cs.agreement) crossSourceMatches++;
        else crossSourceMismatches++;
      }
    }

    const overallScore = (sensorLayerScore + dataFlowLayerScore + resultsLayerScore) / 3;

    return {
      overallScore,
      sensorLayerScore,
      dataFlowLayerScore,
      resultsLayerScore,
      totalSensorsMonitored: sensors.length,
      sensorsVerified,
      sensorsWarning,
      sensorsFailed,
      pipelinesActive,
      pipelinesDegraded,
      resultsValidated,
      resultsFlagged,
      totalFlags,
      criticalFlags,
      warningFlags,
      dataPointsVerified: this.measurements.size,
      crossSourceMatches,
      crossSourceMismatches,
    };
  }

  private computeStats(stations: ClimateStation[], measurements: Map<string, ClimateMeasurement>): ClimateStats {
    const activeStations = stations.filter((s) => s.active);
    const buoys = stations.filter((s) => s.type === 'buoy').length;
    const argoFloats = stations.filter((s) => s.type === 'argo_float').length;
    const bgcArgoFloats = stations.filter((s) => s.type === 'bgc_argo_float').length;
    const carbonStations = stations.filter((s) => s.type === 'carbon_station').length;
    const weatherStations = stations.filter((s) => s.type === 'weather_station').length;

    const regionData = new Map<string, { temps: number[]; latSum: number; lonSum: number; count: number }>();

    let freshCount = 0;
    const co2Values: number[] = [];
    const waveHeights: number[] = [];

    for (const s of stations) {
      const m = measurements.get(s.id);
      if (!m) continue;

      if (Date.now() - m.timestamp < STALE_DATA_MINUTES * 60 * 1000) freshCount++;

      if (m.co2 !== undefined && m.co2 > 300 && m.co2 < 600) {
        co2Values.push(m.co2);
      }
      if (m.waveHeight !== undefined && m.waveHeight >= 0 && m.waveHeight < 30) {
        waveHeights.push(m.waveHeight);
      }

      const region = classifyRegion(s.lat, s.lon, s.type);
      if (!region) continue;

      const isOcean = region.regionType === 'ocean';
      const temp = isOcean ? m.waterTemp : m.airTemp;
      if (temp === undefined || temp <= -80 || temp >= 60) continue;
      if (isOcean && (temp <= -5 || temp >= 50)) continue;

      const key = region.regionId;
      if (!regionData.has(key)) {
        regionData.set(key, { temps: [], latSum: 0, lonSum: 0, count: 0 });
      }
      const rd = regionData.get(key)!;
      rd.temps.push(temp);
      rd.latSum += s.lat;
      rd.lonSum += s.lon;
      rd.count++;
    }

    const regionalAverages: RegionalAverage[] = [];
    for (const [regionId, rd] of regionData) {
      if (rd.temps.length === 0) continue;
      const avgTemp = rd.temps.reduce((a, b) => a + b, 0) / rd.temps.length;
      const minTemp = Math.min(...rd.temps);
      const maxTemp = Math.max(...rd.temps);
      const centerLat = rd.latSum / rd.count;
      const centerLon = rd.lonSum / rd.count;

      const oceanIds = new Set(['north_pacific', 'south_pacific', 'north_atlantic', 'south_atlantic', 'indian', 'arctic', 'southern_ocean']);
      const isOcean = oceanIds.has(regionId);

      const oceanNames: Record<string, string> = {
        north_pacific: 'North Pacific',
        south_pacific: 'South Pacific',
        north_atlantic: 'North Atlantic',
        south_atlantic: 'South Atlantic',
        indian: 'Indian Ocean',
        arctic: 'Arctic Ocean',
        southern_ocean: 'Southern Ocean',
      };
      const continentNames: Record<string, string> = {
        north_america: 'North America',
        south_america: 'South America',
        europe: 'Europe',
        africa: 'Africa',
        asia: 'Asia',
        oceania: 'Oceania',
        antarctica: 'Antarctica',
      };

      regionalAverages.push({
        regionId: regionId as any,
        regionType: isOcean ? 'ocean' : 'land',
        name: isOcean ? oceanNames[regionId] ?? regionId : continentNames[regionId] ?? regionId,
        avgTemp,
        stationCount: rd.temps.length,
        minTemp,
        maxTemp,
        centerLat,
        centerLon,
      });
    }

    const oceanRegions = regionalAverages.filter((r) => r.regionType === 'ocean');
    const landRegions = regionalAverages.filter((r) => r.regionType === 'land');

    const avgFromRegions = (regions: RegionalAverage[]): number => {
      if (regions.length === 0) return 0;
      return regions.reduce((a, r) => a + r.avgTemp, 0) / regions.length;
    };

    const allWaterTemps = oceanRegions.map((r) => r.avgTemp);
    const allAirTemps = landRegions.map((r) => r.avgTemp);

    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0);
    const min = (arr: number[]) => (arr.length > 0 ? Math.min(...arr) : 0);

    return {
      totalStations: stations.length,
      activeStations: activeStations.length,
      buoys,
      argoFloats,
      bgcArgoFloats,
      carbonStations,
      weatherStations,
      avgWaterTemp: avgFromRegions(oceanRegions),
      avgAirTemp: avgFromRegions(landRegions),
      maxWaterTemp: max(allWaterTemps),
      minWaterTemp: min(allWaterTemps),
      avgCO2: avg(co2Values),
      avgWaveHeight: avg(waveHeights),
      anomalies: 0,
      dataFreshness: measurements.size > 0 ? (freshCount / measurements.size) * 100 : 0,
      regionalAverages,
    };
  }
}
