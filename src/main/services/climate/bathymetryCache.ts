import { fetchUrl } from './httpUtil';

const GRID_RESOLUTION = 2;
const GRID_LAT_SIZE = 180 / GRID_RESOLUTION;
const GRID_LON_SIZE = 360 / GRID_RESOLUTION;

let bathymetryGrid: Float32Array | null = null;
let fetchPromise: Promise<void> | null = null;

export async function ensureBathymetryGrid(): Promise<void> {
  if (bathymetryGrid || fetchPromise) {
    await fetchPromise;
    return;
  }

  fetchPromise = fetchGrid();
  await fetchPromise;
}

async function fetchGrid(): Promise<void> {
  try {
    const urls = [
      'https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.json?altitude%5B0:120:10799%5D%5B0:120:21599%5D',
      'https://upwell.pfeg.noaa.gov/erddap/griddap/etopo180.json?altitude%5B0:120:10799%5D%5B0:120:21599%5D',
    ];

    let raw: string | null = null;
    for (const url of urls) {
      try {
        console.log(`Fetching bathymetry grid...`);
        raw = await fetchUrl(url, 60000);
        if (raw) break;
      } catch (e) {
        console.error(`Bathymetry grid fetch failed (${url}):`, (e as Error).message);
      }
    }

    if (!raw) {
      console.error('All bathymetry grid URLs failed — depth checks will be skipped');
      return;
    }

    const data = JSON.parse(raw);

    const table = data.table;
    const latCol = table.columnNames.indexOf('latitude');
    const lonCol = table.columnNames.indexOf('longitude');
    const zCol = table.columnNames.indexOf('altitude');

    if (latCol < 0 || lonCol < 0 || zCol < 0) {
      console.error('Bathymetry grid: unexpected column names', table.columnNames);
      return;
    }

    const grid = new Float32Array(GRID_LAT_SIZE * GRID_LON_SIZE);
    grid.fill(NaN);

    for (const row of table.rows) {
      const lat = row[latCol];
      const lon = row[lonCol];
      const z = row[zCol];
      if (typeof lat !== 'number' || typeof lon !== 'number' || typeof z !== 'number') continue;

      const latIdx = Math.round((lat + 90) / GRID_RESOLUTION);
      const lonIdx = Math.round((lon + 180) / GRID_RESOLUTION);
      if (latIdx < 0 || latIdx >= GRID_LAT_SIZE || lonIdx < 0 || lonIdx >= GRID_LON_SIZE) continue;

      grid[latIdx * GRID_LON_SIZE + lonIdx] = z;
    }

    bathymetryGrid = grid;
    const validCount = grid.filter((v) => !isNaN(v)).length;
    console.log(`Bathymetry grid loaded: ${validCount} points (${GRID_LAT_SIZE}x${GRID_LON_SIZE})`);
  } catch (e) {
    console.error('Bathymetry grid fetch failed:', (e as Error).message);
  }
}

export function getOceanDepth(lat: number, lon: number): number | undefined {
  if (!bathymetryGrid) return undefined;

  let normLon = lon;
  while (normLon > 180) normLon -= 360;
  while (normLon < -180) normLon += 360;

  const latIdx = Math.round((lat + 90) / GRID_RESOLUTION);
  const lonIdx = Math.round((normLon + 180) / GRID_RESOLUTION);

  if (latIdx < 0 || latIdx >= GRID_LAT_SIZE || lonIdx < 0 || lonIdx >= GRID_LON_SIZE) return undefined;

  const depth = bathymetryGrid[latIdx * GRID_LON_SIZE + lonIdx];
  if (isNaN(depth)) return undefined;

  return depth < 0 ? -depth : 0;
}
