// Cross-domain influence: seismic events → grid/infrastructure risk alerts
// When earthquakes occur near coastal or inland infrastructure, generate alerts
// for potential damage, tsunami risk, and operational disruption.

import { GridAsset, GridAlert } from './gridTypes';
import { Earthquake } from '../climate/climateTypes';

// Haversine distance in km
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Influence radius based on magnitude
function seismicRadiusKm(mag: number): number {
  if (mag >= 7) return 1000;   // Major earthquake — wide impact
  if (mag >= 6) return 500;
  if (mag >= 5) return 200;
  if (mag >= 4) return 100;
  return 50;
}

// Generate grid risk alerts from earthquakes + grid assets
export function generateSeismicGridAlerts(
  earthquakes: Earthquake[],
  assets: GridAsset[]
): GridAlert[] {
  const alerts: GridAlert[] = [];
  const now = Date.now();

  // Only consider significant earthquakes (M >= 4.0)
  const significant = earthquakes.filter(e => e.mag >= 4.0);

  for (const eq of significant) {
    const radiusKm = seismicRadiusKm(eq.mag);

    for (const asset of assets) {
      if (!asset.active) continue;

      const dist = distanceKm(eq.lat, eq.lon, asset.lat, asset.lon);
      if (dist > radiusKm) continue;

      const proximityFactor = 1 - dist / radiusKm;
      let alertSeverity: GridAlert['severity'] = 'info';

      if (eq.mag >= 7) {
        alertSeverity = proximityFactor > 0.3 ? 'critical' : 'warning';
      } else if (eq.mag >= 6) {
        alertSeverity = proximityFactor > 0.5 ? 'critical' : 'warning';
      } else if (eq.mag >= 5) {
        alertSeverity = proximityFactor > 0.7 ? 'warning' : 'info';
      } else {
        alertSeverity = 'info';
      }

      // Build message based on asset type
      let message = '';
      let alertType: GridAlert['type'] = 'regional_anomaly';

      const magStr = `M${eq.mag.toFixed(1)}`;
      const distStr = dist < 50 ? 'directly nearby' : `${dist.toFixed(0)}km away`;
      const tsunamiStr = eq.tsunami ? ' — TSUNAMI RISK' : '';

      if (asset.type === 'power_plant') {
        message = `${magStr} earthquake ${distStr}${tsunamiStr} — risk of generation shutdown, turbine damage`;
        alertType = 'capacity_exceeded';
      } else if (asset.type === 'substation' || asset.type === 'transformer') {
        message = `${magStr} earthquake ${distStr} — risk of transformer damage, breaker trip`;
        alertType = 'interconnect_failure';
      } else if (asset.type === 'data_center' || asset.type === 'ai_center') {
        message = `${magStr} earthquake ${distStr}${tsunamiStr} — risk of facility damage, cooling failure`;
        alertType = 'pipeline_error';
      } else if (asset.type === 'renewable_farm') {
        message = `${magStr} earthquake ${distStr} — risk of structural damage to turbines/panels`;
        alertType = 'capacity_exceeded';
      } else if (asset.type === 'battery_storage') {
        message = `${magStr} earthquake ${distStr} — risk of thermal runaway, structural damage`;
        alertType = 'thermal_stress';
      } else {
        message = `${magStr} earthquake ${distStr}${tsunamiStr}`;
      }

      if (!message) continue;

      alerts.push({
        id: `seismic-${eq.id}-${asset.id}-${now}`,
        timestamp: now,
        type: alertType,
        assetId: asset.id,
        assetName: asset.name,
        source: asset.source,
        lat: asset.lat,
        lon: asset.lon,
        message,
        severity: alertSeverity,
        weatherCorrelated: false,
        seismicCorrelated: true,
      } as GridAlert & { seismicCorrelated: boolean });
    }
  }

  return alerts;
}
