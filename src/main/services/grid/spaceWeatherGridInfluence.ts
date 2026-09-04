// Cross-domain influence: space weather → grid risk alerts
// Geomagnetic storms (G2+) can cause transformer damage, voltage instability,
// and GPS degradation. Solar flares (M/X class) can cause radio blackouts
// and GPS degradation affecting aircraft and vessel navigation.

import { GridAsset, GridAlert } from './gridTypes';
import { SpaceWeatherData } from '../climate/climateTypes';

// Generate grid risk alerts from space weather conditions
export function generateSpaceWeatherGridAlerts(
  spaceWx: SpaceWeatherData,
  assets: GridAsset[]
): GridAlert[] {
  const alerts: GridAlert[] = [];
  const now = Date.now();

  const kp = spaceWx.kpIndex ?? 0;
  const hasGeoStorm = spaceWx.geomagneticStorms.length > 0;
  const hasMajorFlare = spaceWx.solarFlares.some(f => f.classType === 'X' || (f.classType === 'M' && f.intensity >= 5));

  // Only generate alerts for significant space weather
  if (kp < 5 && !hasGeoStorm && !hasMajorFlare) return alerts;

  // Determine severity from Kp index
  let severity: GridAlert['severity'] = 'info';
  let stormScale = 'G1';
  if (kp >= 9) { severity = 'critical'; stormScale = 'G5'; }
  else if (kp >= 8) { severity = 'critical'; stormScale = 'G4'; }
  else if (kp >= 7) { severity = 'warning'; stormScale = 'G3'; }
  else if (kp >= 6) { severity = 'warning'; stormScale = 'G2'; }
  else if (kp >= 5) { severity = 'info'; stormScale = 'G1'; }

  // Geomagnetic storms primarily affect:
  // 1. Power grid transformers (GIC - Geomagnetically Induced Currents)
  // 2. Data centers (power quality, GPS timing)
  // 3. Substations (voltage instability)

  const affectedTypes = ['power_plant', 'substation', 'transformer', 'data_center', 'ai_center'];

  for (const asset of assets) {
    if (!asset.active) continue;
    if (!affectedTypes.includes(asset.type)) continue;

    let message = '';
    let alertType: GridAlert['type'] = 'regional_anomaly';

    if (asset.type === 'power_plant' || asset.type === 'substation' || asset.type === 'transformer') {
      message = `${stormScale} geomagnetic storm (Kp=${kp.toFixed(1)}) — risk of GIC-induced transformer damage, voltage instability`;
      alertType = 'interconnect_failure';
    } else if (asset.type === 'data_center' || asset.type === 'ai_center') {
      message = `${stormScale} geomagnetic storm (Kp=${kp.toFixed(1)}) — risk of GPS timing errors, power quality issues`;
      alertType = 'pipeline_error';
    }

    if (!message) continue;

    alerts.push({
      id: `spacewx-${stormScale}-${asset.id}-${now}`,
      timestamp: now,
      type: alertType,
      assetId: asset.id,
      assetName: asset.name,
      source: asset.source,
      lat: asset.lat,
      lon: asset.lon,
      message,
      severity,
      weatherCorrelated: false,
      spaceWeatherCorrelated: true,
    } as GridAlert & { spaceWeatherCorrelated: boolean });
  }

  // If there are major solar flares, alert all data centers about radio/GPS degradation
  if (hasMajorFlare) {
    const majorFlare = spaceWx.solarFlares.find(f => f.classType === 'X' || (f.classType === 'M' && f.intensity >= 5));
    if (majorFlare) {
      const flareClass = `${majorFlare.classType}${majorFlare.intensity.toFixed(1)}`;
      for (const asset of assets) {
        if (!asset.active) continue;
        if (asset.type !== 'data_center' && asset.type !== 'ai_center') continue;

        alerts.push({
          id: `solarflare-${flareClass}-${asset.id}-${now}`,
          timestamp: now,
          type: 'pipeline_error',
          assetId: asset.id,
          assetName: asset.name,
          source: asset.source,
          lat: asset.lat,
          lon: asset.lon,
          message: `${flareClass} solar flare detected — risk of GPS timing degradation, HF radio blackout`,
          severity: majorFlare.classType === 'X' ? 'warning' : 'info',
          weatherCorrelated: false,
          spaceWeatherCorrelated: true,
        } as GridAlert & { spaceWeatherCorrelated: boolean });
      }
    }
  }

  return alerts;
}
