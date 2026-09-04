import { ClimateStation } from './climateTypes';
import { SensorHealth } from './climateTypes';
import { SensorFailurePrediction, RiskLevel, PredictionConfidence } from './predictionTypes';

/**
 * Sensor Failure Prediction Predictor
 *
 * Predicts the probability of sensor failure using multiple contributing factors:
 * 1. Drift detection — sensors with calibration drift are more likely to fail
 * 2. Transmission degradation — increasing intervals between transmissions
 * 3. Field completeness decay — sensors losing fields over time
 * 4. Consecutive failures — repeated missed transmissions
 * 5. Uptime decline — low uptime percentage indicates hardware issues
 *
 * Method: Weighted logistic regression model combining all factors into a
 * failure probability score (0-1).
 */

interface Factor {
  factor: string;
  weight: number;
  detail: string;
  score: number; // 0-1 contribution
}

function riskFromProbability(p: number): RiskLevel {
  if (p >= 0.8) return 'critical';
  if (p >= 0.6) return 'high';
  if (p >= 0.3) return 'moderate';
  if (p >= 0.1) return 'low';
  return 'none';
}

function confidenceFromData(h: SensorHealth): PredictionConfidence {
  if (h.transmissionCount >= 20) return 'high';
  if (h.transmissionCount >= 10) return 'medium';
  return 'low';
}

function estimateTimeToFailure(p: number, h: SensorHealth): string {
  if (p < 0.1) return 'No imminent failure predicted';
  if (p < 0.3) return 'Possible degradation within 7-14 days';

  // Estimate based on consecutive failures and staleness
  const timeSinceTx = Date.now() - h.lastTransmission;
  const hoursSinceTx = timeSinceTx / (1000 * 60 * 60);

  if (h.consecutiveFailures >= 5) return 'Failure likely within hours';
  if (h.consecutiveFailures >= 3) return 'Failure likely within 1-2 days';
  if (hoursSinceTx > 6) return 'Failure likely within 1-3 days';
  if (p >= 0.8) return 'Failure likely within 1-5 days';
  return 'Degradation expected within 3-7 days';
}

function recommendationFor(p: number, h: SensorHealth): string {
  if (p < 0.1) return 'Continue routine monitoring';
  if (h.driftDetected) return 'Schedule calibration check — drift detected';
  if (h.consecutiveFailures >= 3) return 'Inspect station — repeated transmission failures';
  if (h.transmissionRegularity < 0.4) return 'Check communication link — irregular transmissions';
  if (h.uptimePercent < 50) return 'Schedule maintenance — low uptime';
  if (p >= 0.6) return 'Priority maintenance — high failure probability';
  return 'Monitor closely — early degradation signs';
}

export class SensorFailurePredictor {
  /**
   * Predict failure probability for a single sensor
   */
  predict(station: ClimateStation, health: SensorHealth): SensorFailurePrediction | null {
    const factors: Factor[] = [];

    // Factor 1: Drift detection (weight: 0.25)
    if (health.driftDetected) {
      const driftSeverity = health.driftDetails.length;
      factors.push({
        factor: 'Calibration Drift',
        weight: 0.25,
        detail: `${driftSeverity} field(s) with drift: ${health.driftDetails.join('; ')}`,
        score: Math.min(1, 0.6 + driftSeverity * 0.15),
      });
    } else if (health.calibrationStatus === 'unknown') {
      factors.push({
        factor: 'Calibration Drift',
        weight: 0.25,
        detail: 'Insufficient baseline for drift detection',
        score: 0.2,
      });
    } else {
      factors.push({
        factor: 'Calibration Drift',
        weight: 0.25,
        detail: 'No drift detected',
        score: 0,
      });
    }

    // Factor 2: Transmission regularity (weight: 0.20)
    if (health.transmissionRegularity < 0.7) {
      factors.push({
        factor: 'Transmission Regularity',
        weight: 0.20,
        detail: `Regularity: ${(health.transmissionRegularity * 100).toFixed(0)}% (below 70% threshold)`,
        score: Math.min(1, (0.7 - health.transmissionRegularity) * 2),
      });
    } else {
      factors.push({
        factor: 'Transmission Regularity',
        weight: 0.20,
        detail: `Regularity: ${(health.transmissionRegularity * 100).toFixed(0)}% — normal`,
        score: 0,
      });
    }

    // Factor 3: Consecutive failures (weight: 0.25)
    if (health.consecutiveFailures > 0) {
      factors.push({
        factor: 'Consecutive Failures',
        weight: 0.25,
        detail: `${health.consecutiveFailures} consecutive failed transmissions`,
        score: Math.min(1, health.consecutiveFailures * 0.25),
      });
    } else {
      factors.push({
        factor: 'Consecutive Failures',
        weight: 0.25,
        detail: 'No consecutive failures',
        score: 0,
      });
    }

    // Factor 4: Uptime (weight: 0.15)
    if (health.uptimePercent < 80) {
      factors.push({
        factor: 'Uptime Decline',
        weight: 0.15,
        detail: `Uptime: ${health.uptimePercent.toFixed(1)}% (below 80%)`,
        score: Math.min(1, (80 - health.uptimePercent) / 80),
      });
    } else {
      factors.push({
        factor: 'Uptime Decline',
        weight: 0.15,
        detail: `Uptime: ${health.uptimePercent.toFixed(1)}% — healthy`,
        score: 0,
      });
    }

    // Factor 5: Field completeness (weight: 0.15)
    const missingRatio = health.fieldsExpected.length > 0
      ? health.fieldsMissing.length / health.fieldsExpected.length
      : 0;
    if (missingRatio > 0) {
      factors.push({
        factor: 'Field Completeness',
        weight: 0.15,
        detail: `Missing ${health.fieldsMissing.length}/${health.fieldsExpected.length} fields: ${health.fieldsMissing.join(', ')}`,
        score: Math.min(1, missingRatio),
      });
    } else {
      factors.push({
        factor: 'Field Completeness',
        weight: 0.15,
        detail: 'All expected fields present',
        score: 0,
      });
    }

    // Compute weighted failure probability
    let probability = 0;
    for (const f of factors) {
      probability += f.score * f.weight;
    }
    probability = Math.min(1, Math.max(0, probability));

    // Only report if there's meaningful risk
    if (probability < 0.05) return null;

    const risk = riskFromProbability(probability);
    const confidence = confidenceFromData(health);

    return {
      stationId: station.id,
      stationName: station.name,
      source: station.source,
      stationType: station.type,
      lat: station.lat,
      lon: station.lon,
      currentStatus: health.status,
      failureProbability: probability,
      riskLevel: risk,
      estimatedTimeToFailure: estimateTimeToFailure(probability, health),
      contributingFactors: factors
        .filter(f => f.score > 0)
        .sort((a, b) => b.score * b.weight - a.score * a.weight)
        .map(f => ({ factor: f.factor, weight: f.weight, detail: f.detail })),
      confidence,
      method: 'Weighted logistic model (drift + transmission + failures + uptime + completeness)',
      recommendation: recommendationFor(probability, health),
    };
  }

  /**
   * Predict failures for all sensors
   */
  predictAll(
    stations: ClimateStation[],
    sensorHealth: Map<string, SensorHealth>
  ): SensorFailurePrediction[] {
    const predictions: SensorFailurePrediction[] = [];

    for (const station of stations) {
      const health = sensorHealth.get(station.id);
      if (!health) continue;

      const pred = this.predict(station, health);
      if (pred) predictions.push(pred);
    }

    // Sort by failure probability (highest first)
    predictions.sort((a, b) => b.failureProbability - a.failureProbability);

    return predictions;
  }
}
