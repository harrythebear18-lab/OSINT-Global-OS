import { ClimateStation, ClimateMeasurement } from './climateTypes';
import { ClimateAnomalyPrediction, RiskLevel, PredictionConfidence } from './predictionTypes';

/**
 * Climate Anomaly Prediction Predictor
 *
 * Detects anomalies in sensor measurements by comparing current values
 * against a rolling baseline, then predicts future values using linear
 * trend extrapolation.
 *
 * Method:
 * 1. Build baseline: rolling mean and std-dev from historical measurements
 * 2. Compute current z-score: (value - mean) / stdDev
 * 3. Compute trend: linear regression slope over recent history
 * 4. Predict future value: current + trend * hoursAhead
 * 5. Risk level based on z-score magnitude and trend direction
 */

const FIELDS_TO_MONITOR = ['waterTemp', 'airTemp', 'salinity', 'co2', 'pressure', 'windSpeed', 'waveHeight'];
const HOURS_AHEAD = 24;
const ZSCORE_THRESHOLDS = { low: 1.5, moderate: 2.0, high: 2.5, critical: 3.0 };

function computeStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

function computeTrend(values: number[], timestamps: number[]): number {
  if (values.length < 3) return 0;
  // Simple linear regression: y = a + b*x
  const n = values.length;
  const xMean = timestamps.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (timestamps[i] - xMean) * (values[i] - yMean);
    den += (timestamps[i] - xMean) ** 2;
  }
  const slopePerMs = den > 0 ? num / den : 0;
  return slopePerMs * (24 * 60 * 60 * 1000); // convert to per-day
}

function riskFromZScore(z: number, trendPerDay: number): RiskLevel {
  const absZ = Math.abs(z);
  const trendAmplifies = (z > 0 && trendPerDay > 0) || (z < 0 && trendPerDay < 0);
  const effectiveZ = trendAmplifies ? absZ + Math.abs(trendPerDay) * 0.1 : absZ;

  if (effectiveZ >= ZSCORE_THRESHOLDS.critical) return 'critical';
  if (effectiveZ >= ZSCORE_THRESHOLDS.high) return 'high';
  if (effectiveZ >= ZSCORE_THRESHOLDS.moderate) return 'moderate';
  if (effectiveZ >= ZSCORE_THRESHOLDS.low) return 'low';
  return 'none';
}

function confidenceFromSamples(n: number): PredictionConfidence {
  if (n >= 20) return 'high';
  if (n >= 10) return 'medium';
  return 'low';
}

interface FieldHistory {
  values: number[];
  timestamps: number[];
}

export class ClimateAnomalyPredictor {
  private history = new Map<string, Map<string, FieldHistory>>(); // stationId -> field -> history
  private maxHistory = 100;

  /**
   * Update internal history with new measurements
   */
  updateHistory(stations: ClimateStation[], measurements: Map<string, ClimateMeasurement>) {
    for (const station of stations) {
      const m = measurements.get(station.id);
      if (!m) continue;

      let stationHist = this.history.get(station.id);
      if (!stationHist) {
        stationHist = new Map();
        this.history.set(station.id, stationHist);
      }

      for (const field of FIELDS_TO_MONITOR) {
        const val = (m as any)[field] as number | undefined;
        if (val === undefined || isNaN(val)) continue;

        let fh = stationHist.get(field);
        if (!fh) {
          fh = { values: [], timestamps: [] };
          stationHist.set(field, fh);
        }
        fh.values.push(val);
        fh.timestamps.push(m.timestamp);
        if (fh.values.length > this.maxHistory) {
          fh.values.shift();
          fh.timestamps.shift();
        }
      }
    }
  }

  /**
   * Generate anomaly predictions for all stations with sufficient history
   */
  predict(stations: ClimateStation[], measurements: Map<string, ClimateMeasurement>): ClimateAnomalyPrediction[] {
    const predictions: ClimateAnomalyPrediction[] = [];

    for (const station of stations) {
      const m = measurements.get(station.id);
      if (!m) continue;

      const stationHist = this.history.get(station.id);
      if (!stationHist) continue;

      for (const field of FIELDS_TO_MONITOR) {
        const fh = stationHist.get(field);
        if (!fh || fh.values.length < 5) continue;

        const currentValue = (m as any)[field] as number;
        if (currentValue === undefined || isNaN(currentValue)) continue;

        // Baseline from history (excluding the most recent value)
        const baselineValues = fh.values.slice(0, -1);
        const { mean, stdDev } = computeStats(baselineValues);
        if (stdDev === 0) continue;

        const currentZScore = (currentValue - mean) / stdDev;

        // Only report if there's a meaningful anomaly
        if (Math.abs(currentZScore) < 1.0) continue;

        // Trend from recent history
        const recentN = Math.min(fh.values.length, 20);
        const recentValues = fh.values.slice(-recentN);
        const recentTimestamps = fh.timestamps.slice(-recentN);
        const trendPerDay = computeTrend(recentValues, recentTimestamps);

        // Predict future value
        const predictedValue = currentValue + trendPerDay * (HOURS_AHEAD / 24);
        const predictedZScore = stdDev > 0 ? (predictedValue - mean) / stdDev : 0;

        const risk = riskFromZScore(currentZScore, trendPerDay);
        const confidence = confidenceFromSamples(baselineValues.length);

        let message = '';
        const direction = currentZScore > 0 ? 'above' : 'below';
        const trendDir = trendPerDay > 0 ? 'increasing' : trendPerDay < 0 ? 'decreasing' : 'stable';

        if (risk === 'critical') {
          message = `${field} critically ${direction} baseline (z=${currentZScore.toFixed(1)}), ${trendDir}`;
        } else if (risk === 'high') {
          message = `${field} significantly ${direction} baseline (z=${currentZScore.toFixed(1)}), ${trendDir}`;
        } else if (risk === 'moderate') {
          message = `${field} ${direction} baseline (z=${currentZScore.toFixed(1)}), trend ${trendDir}`;
        } else if (risk === 'low') {
          message = `${field} slightly ${direction} baseline (z=${currentZScore.toFixed(1)})`;
        } else {
          continue; // Skip non-anomalies
        }

        predictions.push({
          stationId: station.id,
          stationName: station.name,
          source: station.source,
          lat: station.lat,
          lon: station.lon,
          field,
          currentValue,
          baselineMean: mean,
          baselineStdDev: stdDev,
          currentZScore,
          predictedValue,
          predictedZScore,
          trendPerDay,
          hoursAhead: HOURS_AHEAD,
          riskLevel: risk,
          confidence,
          method: 'Rolling baseline z-score + linear trend extrapolation',
          message,
        });
      }
    }

    // Sort by risk level (critical first)
    const riskOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, none: 4 };
    predictions.sort((a, b) => (riskOrder[a.riskLevel] ?? 5) - (riskOrder[b.riskLevel] ?? 5));

    return predictions;
  }
}
