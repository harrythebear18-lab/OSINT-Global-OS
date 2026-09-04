import { GridAsset, Interconnect, AssetMeasurement } from './gridTypes';

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function buildInterconnects(assets: GridAsset[]): Interconnect[] {
  const links: Interconnect[] = [];
  const linkSet = new Set<string>();
  let id = 0;

  const dcAndAi = assets.filter((a) => a.type === 'data_center' || a.type === 'ai_center' || a.type === 'edge_node');
  const substations = assets.filter((a) => a.type === 'substation' || a.type === 'power_plant' || a.type === 'renewable_farm' || a.type === 'battery_storage');

  for (const dc of dcAndAi) {
    const nearby = substations
      .map((s) => ({ s, d: distanceKm(dc.lat, dc.lon, s.lat, s.lon) }))
      .filter((x) => x.d < 400)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const n of nearby) {
      const s = n.s;
      const key = [dc.id, s.id].sort().join('|');
      if (linkSet.has(key)) continue;
      linkSet.add(key);
      links.push({
        id: `link-${id++}`,
        sourceAssetId: dc.id,
        targetAssetId: s.id,
        type: 'fiber',
        capacityTbps: dc.type === 'ai_center' ? 50 + Math.random() * 100 : 10 + Math.random() * 40,
        latencyMs: Math.round(n.d / 200 * 10),
        active: true,
        lastUpdate: Date.now(),
      });
    }
  }

  for (let i = 0; i < substations.length; i++) {
    for (let j = i + 1; j < substations.length; j++) {
      const a = substations[i];
      const b = substations[j];
      const d = distanceKm(a.lat, a.lon, b.lat, b.lon);
      if (d > 800) continue;
      const key = [a.id, b.id].sort().join('|');
      if (linkSet.has(key)) continue;
      linkSet.add(key);
      links.push({
        id: `link-${id++}`,
        sourceAssetId: a.id,
        targetAssetId: b.id,
        type: d < 400 ? 'ac_line' : 'dc_line',
        capacityMw: Math.round(500 + Math.random() * 2000),
        latencyMs: Math.round(d / 300 * 10),
        active: true,
        lastUpdate: Date.now(),
      });
    }
  }

  const transformers = assets.filter((a) => a.type === 'transformer');
  for (const t of transformers) {
    const nearby = substations
      .map((s) => ({ s, d: distanceKm(t.lat, t.lon, s.lat, s.lon) }))
      .filter((x) => x.d < 300 && x.s.id !== t.id)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const n of nearby) {
      const key = [t.id, n.s.id].sort().join('|');
      if (linkSet.has(key)) continue;
      linkSet.add(key);
      links.push({
        id: `link-${id++}`,
        sourceAssetId: t.id,
        targetAssetId: n.s.id,
        type: 'ac_line',
        capacityMw: Math.round(200 + Math.random() * 800),
        latencyMs: Math.round(n.d / 300 * 10),
        active: true,
        lastUpdate: Date.now(),
      });
    }
  }

  return links;
}

export function generateMeasurements(assets: GridAsset[]): Map<string, AssetMeasurement> {
  const m = new Map<string, AssetMeasurement>();
  const now = Date.now();
  for (const asset of assets) {
    const measurement: AssetMeasurement = {
      assetId: asset.id,
      timestamp: now,
    };

    if (asset.type === 'power_plant' || asset.type === 'renewable_farm') {
      const capacity = asset.capacityMw ?? 1000;
      const loadFactor = asset.energyType === 'solar' ? 0.25 : asset.energyType === 'wind' ? 0.35 : asset.energyType === 'hydro' ? 0.45 : 0.7;
      measurement.generationMw = capacity * loadFactor * (0.85 + Math.random() * 0.3);
      measurement.loadMw = measurement.generationMw;
      measurement.voltageKv = asset.voltageKv ?? (asset.type === 'power_plant' ? 400 : 220);
      measurement.frequencyHz = 50 + (Math.random() - 0.5) * 0.2;
      measurement.temperatureC = 20 + Math.random() * 40;
      measurement.carbonIntensityGco2Kwh = asset.energyType === 'coal' ? 850 : asset.energyType === 'gas' ? 450 : asset.energyType === 'nuclear' ? 12 : asset.energyType === 'hydro' ? 24 : 20 + Math.random() * 30;
    } else if (asset.type === 'substation' || asset.type === 'transformer') {
      measurement.voltageKv = asset.voltageKv ?? 220;
      measurement.frequencyHz = 50 + (Math.random() - 0.5) * 0.2;
      measurement.loadMw = Math.random() * 800;
      measurement.temperatureC = 25 + Math.random() * 30;
    } else if (asset.type === 'battery_storage') {
      const capacity = asset.capacityMw ?? 100;
      measurement.storedMwh = capacity * Math.random() * 2;
      measurement.maxStorageMwh = capacity * 2;
      measurement.loadMw = (Math.random() - 0.5) * capacity;
      measurement.temperatureC = 20 + Math.random() * 15;
    } else if (asset.type === 'data_center' || asset.type === 'ai_center') {
      const capacity = asset.capacityMw ?? 50;
      measurement.utilizationPercent = 40 + Math.random() * 50;
      measurement.itLoadMw = capacity * (measurement.utilizationPercent / 100);
      measurement.totalFacilityLoadMw = measurement.itLoadMw * (1.2 + Math.random() * 0.3);
      measurement.pue = 1.1 + Math.random() * 0.4;
      measurement.temperatureC = 22 + Math.random() * 10;
      measurement.carbonIntensityGco2Kwh = 300 + Math.random() * 300;
    } else if (asset.type === 'edge_node') {
      measurement.itLoadMw = (asset.capacityMw ?? 10) * (0.3 + Math.random() * 0.5);
      measurement.totalFacilityLoadMw = measurement.itLoadMw * 1.3;
      measurement.pue = 1.3 + Math.random() * 0.2;
    }

    measurement.loadMw = measurement.loadMw ?? measurement.totalFacilityLoadMw ?? measurement.itLoadMw ?? 0;
    m.set(asset.id, measurement);
  }
  return m;
}
