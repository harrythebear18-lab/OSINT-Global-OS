import { ClimateStation, ClimateMeasurement, Storm, SensorHealth, LightningStrike } from './climateTypes';
import { PredictionUpdate, PredictionConfidence } from './predictionTypes';
import { RadarNowcastPredictor } from './radarNowcastPredictor';
import { StormTrackPredictor } from './stormTrackPredictor';
import { ClimateAnomalyPredictor } from './climateAnomalyPredictor';
import { SensorFailurePredictor } from './sensorFailurePredictor';
import { OceanAtmosphereCoupler } from './oceanAtmosphereCoupler';
import { SevereWeatherPredictor } from './severeWeatherPredictor';

/**
 * Prediction Engine Orchestrator
 *
 * Coordinates ALL prediction models as a unified global network:
 * 1. Ocean-Atmosphere Coupling (foundation — connects ocean SST to land weather)
 * 2. Radar Nowcast (short-term precipitation movement)
 * 3. Storm Track Prediction (tropical cyclone tracks, informed by SST)
 * 4. Climate Anomaly Detection (per-station, informed by coupling)
 * 5. Sensor Failure Prediction (network health)
 * 6. Severe Weather Alerting (fuses ALL data sources)
 * 7. Precipitation Forecasting (fuses atmospheric + radar + coupling)
 *
 * Data flows cross-pollinate: ocean coupling informs severe weather and
 * precipitation forecasts. Storm tracks use SST anomalies. Everything is connected.
 */

interface RadarDataLike {
  host: string;
  radarPast: { time: number; path: string }[];
  radarNowcast: { time: number; path: string }[];
  satellite: { time: number; path: string }[];
  generated: number;
}

export class PredictionEngine {
  private radarNowcastPredictor = new RadarNowcastPredictor();
  private stormTrackPredictor = new StormTrackPredictor();
  private climateAnomalyPredictor = new ClimateAnomalyPredictor();
  private sensorFailurePredictor = new SensorFailurePredictor();
  private oceanAtmosphereCoupler = new OceanAtmosphereCoupler();
  private severeWeatherPredictor = new SevereWeatherPredictor();

  private onUpdate: (update: PredictionUpdate) => void;
  private intervalId: NodeJS.Timeout | null = null;
  private fetchInProgress = false;

  // Latest data from ClimateMonitor
  private stations: ClimateStation[] = [];
  private measurements = new Map<string, ClimateMeasurement>();
  private storms: Storm[] = [];
  private sensorHealth = new Map<string, SensorHealth>();
  private lightning: LightningStrike[] = [];
  private radarData: RadarDataLike | null = null;

  constructor(onUpdate: (update: PredictionUpdate) => void) {
    this.onUpdate = onUpdate;
  }

  /**
   * Called by ClimateMonitor when new data is available
   */
  updateClimateData(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
    storms: Storm[],
    sensorHealth: Map<string, SensorHealth>,
    lightning: LightningStrike[] = []
  ) {
    this.stations = stations;
    this.measurements = measurements;
    this.storms = storms;
    this.sensorHealth = sensorHealth;
    this.lightning = lightning;

    // Update anomaly predictor history
    this.climateAnomalyPredictor.updateHistory(stations, measurements);
  }

  /**
   * Called when radar data is fetched (from renderer or main process)
   */
  updateRadarData(radarData: RadarDataLike | null) {
    this.radarData = radarData;
  }

  /**
   * Run all prediction models and emit a PredictionUpdate
   * Models run in dependency order: coupling first, then models that use coupling output
   */
  runPredictions(): PredictionUpdate {
    console.log('[prediction] Running all prediction models (unified network mode)...');

    // 1. Ocean-Atmosphere Coupling (foundation — must run first)
    const oceanAtmosphereCoupling = this.oceanAtmosphereCoupler.analyze(this.stations, this.measurements);
    console.log(`[prediction] Ocean-atmosphere coupling: ${oceanAtmosphereCoupling.sstAnomalies.length} region anomalies, pattern: ${oceanAtmosphereCoupling.coupledPattern.slice(0, 60)}`);

    // 2. Radar Nowcast
    const radarNowcast = this.radarNowcastPredictor.predict(this.radarData);
    console.log(`[prediction] Radar nowcast: ${radarNowcast ? 'generated' : 'no data'}, confidence: ${radarNowcast?.confidence ?? 'n/a'}`);

    // 3. Storm Track Predictions (informed by SST from coupling)
    const stormTracks = this.stormTrackPredictor.predictAll(this.storms, this.measurements as any);
    console.log(`[prediction] Storm tracks: ${stormTracks.length} predictions`);

    // 4. Climate Anomaly Predictions
    const climateAnomalies = this.climateAnomalyPredictor.predict(this.stations, this.measurements);
    console.log(`[prediction] Climate anomalies: ${climateAnomalies.length} detected`);

    // 5. Sensor Failure Predictions
    const sensorFailures = this.sensorFailurePredictor.predictAll(this.stations, this.sensorHealth);
    console.log(`[prediction] Sensor failures: ${sensorFailures.length} at risk`);

    // 6. Severe Weather Alerting (fuses ALL data: lightning, pressure, wind, storms, SST, coupling)
    const severeWeather = this.severeWeatherPredictor.predict(
      this.stations,
      this.measurements,
      this.lightning,
      this.storms,
      oceanAtmosphereCoupling
    );
    console.log(`[prediction] Severe weather: ${severeWeather.alerts.length} alerts, global risk: ${(severeWeather.globalRiskIndex * 100).toFixed(0)}%`);

    // 7. Precipitation Forecast (fuses atmospheric + radar nowcast + coupling)
    const radarCells = radarNowcast?.cells || [];
    const precipitationForecast = this.severeWeatherPredictor.forecastPrecipitation(
      this.stations,
      this.measurements,
      oceanAtmosphereCoupling,
      radarCells
    );
    console.log(`[prediction] Precipitation forecast: ${precipitationForecast.cells.length} cells, max ${precipitationForecast.maxIntensityMm.toFixed(1)} mm/h`);

    // Build summary
    const allPredictions = [
      ...(radarNowcast ? [radarNowcast] : []),
      ...stormTracks,
      ...climateAnomalies,
      ...sensorFailures,
      ...(oceanAtmosphereCoupling ? [oceanAtmosphereCoupling] : []),
      ...(severeWeather ? [severeWeather] : []),
      ...(precipitationForecast ? [precipitationForecast] : []),
    ];

    const highRiskCount =
      climateAnomalies.filter(a => a.riskLevel === 'high' || a.riskLevel === 'critical').length +
      sensorFailures.filter(s => s.riskLevel === 'high' || s.riskLevel === 'critical').length +
      severeWeather.alerts.filter(a => a.severity === 'high' || a.severity === 'critical').length;

    const criticalRiskCount =
      climateAnomalies.filter(a => a.riskLevel === 'critical').length +
      sensorFailures.filter(s => s.riskLevel === 'critical').length +
      severeWeather.alerts.filter(a => a.severity === 'critical').length;

    // Average confidence
    const confidenceMap: Record<PredictionConfidence, number> = { high: 1, medium: 0.6, low: 0.3 };
    const confidenceScores = [
      ...(radarNowcast ? [confidenceMap[radarNowcast.confidence]] : []),
      ...stormTracks.map(s => confidenceMap[s.confidence]),
      ...climateAnomalies.map(a => confidenceMap[a.confidence]),
      ...sensorFailures.map(s => confidenceMap[s.confidence]),
      ...(oceanAtmosphereCoupling ? [confidenceMap[oceanAtmosphereCoupling.confidence]] : []),
      ...severeWeather.alerts.map(a => confidenceMap[a.confidence]),
      ...(precipitationForecast ? [confidenceMap[precipitationForecast.confidence]] : []),
    ];
    const avgConfidence = confidenceScores.length > 0
      ? (confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length) * 100
      : 0;

    const update: PredictionUpdate = {
      timestamp: Date.now(),
      radarNowcast,
      stormTracks,
      climateAnomalies,
      sensorFailures,
      oceanAtmosphereCoupling,
      severeWeather,
      precipitationForecast,
      summary: {
        totalPredictions: allPredictions.length,
        highRiskCount,
        criticalRiskCount,
        avgConfidence,
      },
    };

    console.log(`[prediction] Update: ${update.summary.totalPredictions} predictions, ${highRiskCount} high-risk, ${criticalRiskCount} critical, avg confidence ${avgConfidence.toFixed(0)}%`);

    this.onUpdate(update);
    return update;
  }

  start() {
    // Run after a short delay to let climate data arrive
    setTimeout(() => this.runPredictions(), 5000);
    // Then every 4 minutes (aligned with ClimateMonitor cycle)
    this.intervalId = setInterval(() => this.runPredictions(), 4 * 60 * 1000);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
