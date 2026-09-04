import { ClimateStation, ClimateMeasurement, DataSource, StationType } from './climateTypes';
import { fetchUrl } from './httpUtil';

type FetchResult = { stations: ClimateStation[]; measurements: Map<string, ClimateMeasurement> };

function safeNum(val: number | string | null | undefined): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return isNaN(n) ? undefined : n;
}

interface ErddapJsonResponse {
  table: {
    columnNames: string[];
    columnTypes: string[];
    rows: any[][];
  };
}

async function fetchErddapJson(url: string, timeout = 30000): Promise<ErddapJsonResponse> {
  const raw = await fetchUrl(url, timeout);
  return JSON.parse(raw) as ErddapJsonResponse;
}

function parseErddapTime(val: any): number {
  if (typeof val === 'number') {
    if (val > 1e12) return val;
    if (val > 1e9) return val * 1000;
    return val * 1000;
  }
  return new Date(val).getTime();
}

function buildRowMapper(columnNames: string[]) {
  return (row: any[], field: string): any => {
    const idx = columnNames.indexOf(field);
    return idx >= 0 ? row[idx] : undefined;
  };
}

const ERDDAP_BASE = 'https://coastwatch.pfeg.noaa.gov/erddap/tabledap';

export class ErddapFetcher {
  static async fetchNDBC(): Promise<FetchResult> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    try {
      const vars = 'station,longitude,latitude,time,wd,wspd,gst,wvht,dpd,apd,bar,atmp,wtmp,dewp,vis,ptdy,tide,wspu,wspv';
      const url = `${ERDDAP_BASE}/cwwcNDBCMet.json?${vars}&time%3E=now-2hours&orderBy(%22station,time%22)`;
      console.log(`NDBC fetching: ${url}`);
      const data = await fetchErddapJson(url, 30000);
      const cols = data.table.columnNames;
      const get = buildRowMapper(cols);
      console.log(`NDBC columns:`, cols);

      const seenStations = new Set<string>();

      for (const row of data.table.rows) {
        const stationId = get(row, 'station') as string;
        if (!stationId) continue;

        const lat = safeNum(get(row, 'latitude'));
        const lon = safeNum(get(row, 'longitude'));
        if (lat === undefined || lon === undefined) continue;

        const id = `ndbc_${stationId}`;
        const ts = parseErddapTime(get(row, 'time'));

        if (!seenStations.has(id)) {
          seenStations.add(id);
          stations.push({
            id,
            name: stationId,
            type: 'buoy',
            source: 'NOAA_NDBC',
            lat,
            lon,
            lastUpdate: ts,
            active: true,
          });
        }

        const m: ClimateMeasurement = {
          stationId: id,
          timestamp: ts,
          waterTemp: safeNum(get(row, 'wtmp')),
          airTemp: safeNum(get(row, 'atmp')),
          windSpeed: safeNum(get(row, 'wspd')),
          windDir: safeNum(get(row, 'wd')),
          waveHeight: safeNum(get(row, 'wvht')),
          wavePeriod: safeNum(get(row, 'dpd')),
          pressure: safeNum(get(row, 'bar')),
        };
        measurements.set(id, m);
      }
      console.log(`NDBC: ${stations.length} stations, ${measurements.size} measurements`);
    } catch (e) {
      console.error('ERDDAP NDBC fetch error:', e);
    }

    return { stations, measurements };
  }

  static async fetchGTSPP(): Promise<FetchResult> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    try {
      const vars = 'trajectory,longitude,latitude,time,depth,temperature,salinity';
      const url = `${ERDDAP_BASE}/erdGtsppBest.json?${vars}&time%3Emax(time)-7days&depth%3C=20&orderBy(%22trajectory,time%22)`;
      const data = await fetchErddapJson(url, 30000);
      const cols = data.table.columnNames;
      const get = buildRowMapper(cols);

      const seenTraj = new Set<string>();

      for (const row of data.table.rows) {
        const traj = get(row, 'trajectory') as string;
        if (!traj) continue;

        const lat = safeNum(get(row, 'latitude'));
        const lon = safeNum(get(row, 'longitude'));
        if (lat === undefined || lon === undefined) continue;

        const id = `gtspp_${traj}`;
        const ts = parseErddapTime(get(row, 'time'));

        if (!seenTraj.has(id)) {
          seenTraj.add(id);
          const isArgo = traj.startsWith('PF') || traj.includes('argo');
          stations.push({
            id,
            name: traj,
            type: isArgo ? 'argo_float' : 'buoy',
            source: 'GTSPP',
            lat,
            lon,
            depth: safeNum(get(row, 'depth')),
            lastUpdate: ts,
            active: true,
          });
        }

        const m: ClimateMeasurement = {
          stationId: id,
          timestamp: ts,
          waterTemp: safeNum(get(row, 'temperature')),
          salinity: safeNum(get(row, 'salinity')),
          depth: safeNum(get(row, 'depth')),
        };
        measurements.set(id, m);
      }
    } catch (e) {
      console.error('ERDDAP GTSPP fetch error:', e);
    }

    return { stations, measurements };
  }

  static async fetchTAO(): Promise<FetchResult> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    try {
      const vars = 'station,longitude,latitude,time,depth,T_20';
      const url = `${ERDDAP_BASE}/pmelTaoDyT.json?${vars}&time%3Emax(time)-7days&orderBy(%22station,time%22)`;
      const data = await fetchErddapJson(url, 30000);
      const cols = data.table.columnNames;
      const get = buildRowMapper(cols);

      const seenStations = new Set<string>();

      for (const row of data.table.rows) {
        const stationId = get(row, 'station') as string;
        if (!stationId) continue;

        const lat = safeNum(get(row, 'latitude'));
        const lon = safeNum(get(row, 'longitude'));
        if (lat === undefined || lon === undefined) continue;

        const id = `tao_${stationId}`;
        const ts = parseErddapTime(get(row, 'time'));

        if (!seenStations.has(id)) {
          seenStations.add(id);
          stations.push({
            id,
            name: stationId,
            type: 'buoy',
            source: 'TAO_PIRATA',
            lat,
            lon,
            depth: safeNum(get(row, 'depth')),
            lastUpdate: ts,
            active: true,
          });
        }

        const m: ClimateMeasurement = {
          stationId: id,
          timestamp: ts,
          waterTemp: safeNum(get(row, 'T_20')),
          depth: safeNum(get(row, 'depth')),
        };
        measurements.set(id, m);
      }
    } catch (e) {
      console.error('ERDDAP TAO fetch error:', e);
    }

    return { stations, measurements };
  }

  static async fetchTAOCurrents(): Promise<FetchResult> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    try {
      const vars = 'station,longitude,latitude,time,depth,CS_300,CD_310';
      const url = `${ERDDAP_BASE}/pmelTaoDyCur.json?${vars}&time%3Emax(time)-7days&orderBy(%22station,time%22)`;
      const data = await fetchErddapJson(url, 30000);
      const cols = data.table.columnNames;
      const get = buildRowMapper(cols);

      const seenStations = new Set<string>();

      for (const row of data.table.rows) {
        const stationId = get(row, 'station') as string;
        if (!stationId) continue;

        const lat = safeNum(get(row, 'latitude'));
        const lon = safeNum(get(row, 'longitude'));
        if (lat === undefined || lon === undefined) continue;

        const id = `tao_cur_${stationId}`;
        const ts = parseErddapTime(get(row, 'time'));

        if (!seenStations.has(id)) {
          seenStations.add(id);
          stations.push({
            id,
            name: `${stationId} (currents)`,
            type: 'buoy',
            source: 'TAO_PIRATA',
            lat,
            lon,
            depth: safeNum(get(row, 'depth')),
            lastUpdate: ts,
            active: true,
          });
        }

        const m: ClimateMeasurement = {
          stationId: id,
          timestamp: ts,
          currentSpeed: safeNum(get(row, 'CS_300')),
          currentDir: safeNum(get(row, 'CD_310')),
          depth: safeNum(get(row, 'depth')),
        };
        measurements.set(id, m);
      }
    } catch (e) {
      console.error('ERDDAP TAO currents fetch error:', e);
    }

    return { stations, measurements };
  }

  static async fetchTAOSalinity(): Promise<FetchResult> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    try {
      const vars = 'station,longitude,latitude,time,depth,S_41';
      const url = `${ERDDAP_BASE}/pmelTaoDySss.json?${vars}&time%3Emax(time)-7days&orderBy(%22station,time%22)`;
      const data = await fetchErddapJson(url, 30000);
      const cols = data.table.columnNames;
      const get = buildRowMapper(cols);

      const seenStations = new Set<string>();

      for (const row of data.table.rows) {
        const stationId = get(row, 'station') as string;
        if (!stationId) continue;

        const lat = safeNum(get(row, 'latitude'));
        const lon = safeNum(get(row, 'longitude'));
        if (lat === undefined || lon === undefined) continue;

        const id = `tao_sss_${stationId}`;
        const ts = parseErddapTime(get(row, 'time'));

        if (!seenStations.has(id)) {
          seenStations.add(id);
          stations.push({
            id,
            name: `${stationId} (salinity)`,
            type: 'buoy',
            source: 'TAO_PIRATA',
            lat,
            lon,
            depth: safeNum(get(row, 'depth')),
            lastUpdate: ts,
            active: true,
          });
        }

        const m: ClimateMeasurement = {
          stationId: id,
          timestamp: ts,
          salinity: safeNum(get(row, 'S_41')),
          depth: safeNum(get(row, 'depth')),
        };
        measurements.set(id, m);
      }
    } catch (e) {
      console.error('ERDDAP TAO salinity fetch error:', e);
    }

    return { stations, measurements };
  }

  static async fetchArgo(): Promise<FetchResult> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    const ARGO_SERVERS = [
      { base: 'https://erddap.aoml.noaa.gov/hdb/erddap/tabledap', datasets: [
        'argo_float_pacific_2025_present',
        'argo_float_atlantic_2025_present',
        'argo_float_indian_2025_present',
      ], vars: 'PLATFORM_NUMBER,latitude,longitude,time,PRES,TEMP,PSAL', platformField: 'PLATFORM_NUMBER', presField: 'PRES', tempField: 'TEMP', psalField: 'PSAL', doxyField: '', nitrateField: '', phField: '', chlaField: '' },
      { base: 'https://erddap.ifremer.fr/erddap/tabledap', datasets: [
        'ArgoFloats',
      ], vars: 'platform_number,latitude,longitude,time,pres,temp,psal', platformField: 'platform_number', presField: 'pres', tempField: 'temp', psalField: 'psal', doxyField: '', nitrateField: '', phField: '', chlaField: '' },
    ];

    let fetched = false;
    const seenFloats = new Set<string>();
    const datasetCounts = new Map<string, number>();

    for (const server of ARGO_SERVERS) {
      const isBgcServer = (server as any).doxyField && (server as any).doxyField.length > 0;
      if (isBgcServer) continue;
      if (fetched) break;

      for (const dataset of server.datasets) {
        try {
          const url = `${server.base}/${dataset}.json?${server.vars}&time%3Emax(time)-30days&${server.presField}%3C=20&orderBy(%22${server.platformField},time%22)`;
          const data = await fetchErddapJson(url, 45000);
          const cols = data.table.columnNames;
          const get = buildRowMapper(cols);

          const beforeCount = seenFloats.size;
          let rowCount = 0;

          for (const row of data.table.rows) {
            rowCount++;
            const floatId = get(row, server.platformField) as string;
            if (!floatId) continue;

            const lat = safeNum(get(row, 'latitude'));
            const lon = safeNum(get(row, 'longitude'));
            if (lat === undefined || lon === undefined) continue;

            const id = `argo_${floatId}`;
            const ts = parseErddapTime(get(row, 'time'));

            if (!seenFloats.has(id)) {
              seenFloats.add(id);
              stations.push({
                id,
                name: `Argo ${floatId}`,
                type: 'argo_float',
                source: 'ARGO',
                lat,
                lon,
                depth: safeNum(get(row, server.presField)),
                lastUpdate: ts,
                active: true,
              });
            }

            measurements.set(id, {
              stationId: id,
              timestamp: ts,
              waterTemp: safeNum(get(row, server.tempField)),
              salinity: safeNum(get(row, server.psalField)),
              depth: safeNum(get(row, server.presField)),
            });
          }

          fetched = true;
          const newCount = seenFloats.size - beforeCount;
          datasetCounts.set(dataset, newCount);
          console.log(`Argo ${dataset}: +${newCount} new (deduped total: ${stations.length})`);
        } catch (e) {
          console.error(`Argo fetch attempt failed (${server.base}/${dataset}):`, e);
        }
      }
    }

    for (const server of ARGO_SERVERS) {
      const isBgcServer = (server as any).doxyField && (server as any).doxyField.length > 0;
      if (!isBgcServer) continue;

      for (const dataset of server.datasets) {
        try {
          const bgcFields = [(server as any).doxyField, (server as any).nitrateField, (server as any).phField, (server as any).chlaField].filter((f: string) => f);
          const allVars = `${server.vars},${bgcFields.join(',')}`;
          const url = `${server.base}/${dataset}.json?${allVars}&time%3Emax(time)-90days&${server.presField}%3C=20&orderBy(%22${server.platformField},time%22)`;
          const data = await fetchErddapJson(url, 60000);
          const cols = data.table.columnNames;
          const get = buildRowMapper(cols);

          for (const row of data.table.rows) {
            const floatId = get(row, server.platformField) as string;
            if (!floatId) continue;

            const lat = safeNum(get(row, 'latitude'));
            const lon = safeNum(get(row, 'longitude'));
            if (lat === undefined || lon === undefined) continue;

            const id = `argo_${floatId}`;
            const ts = parseErddapTime(get(row, 'time'));

            if (!seenFloats.has(id)) {
              seenFloats.add(id);
              stations.push({
                id,
                name: `Argo ${floatId}`,
                type: 'bgc_argo_float',
                source: 'BGC_ARGO',
                lat,
                lon,
                depth: safeNum(get(row, server.presField)),
                lastUpdate: ts,
                active: true,
              });
            } else {
              const existing = stations.find((s) => s.id === id);
              if (existing && existing.type === 'argo_float') {
                const hasBgc = bgcFields.some((f: string) => get(row, f) !== undefined && get(row, f) !== null);
                if (hasBgc) {
                  existing.type = 'bgc_argo_float';
                  existing.source = 'BGC_ARGO';
                }
              }
            }

            const existing = measurements.get(id);
            measurements.set(id, {
              stationId: id,
              timestamp: ts,
              waterTemp: safeNum(get(row, server.tempField)) ?? existing?.waterTemp,
              salinity: safeNum(get(row, server.psalField)) ?? existing?.salinity,
              depth: safeNum(get(row, server.presField)) ?? existing?.depth,
              oxygen: safeNum(get(row, (server as any).doxyField)) ?? existing?.oxygen,
              nitrate: safeNum(get(row, (server as any).nitrateField)) ?? existing?.nitrate,
              ph: safeNum(get(row, (server as any).phField)) ?? existing?.ph,
              chl: safeNum(get(row, (server as any).chlaField)) ?? existing?.chl,
            });
          }

          console.log(`Argo BGC ${dataset}: ${seenFloats.size} unique floats total (BGC enriched)`);
        } catch (e) {
          console.error(`Argo BGC fetch failed (${server.base}/${dataset}):`, e);
        }
      }
    }

    if (!fetched) {
      console.error('All Argo ERDDAP servers failed');
    }

    return { stations, measurements };
  }

  static async fetchCO2(): Promise<FetchResult> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    try {
      const CO2_BASE = 'https://data.pmel.noaa.gov/pmel/erddap/tabledap';
      const vars = 'station_id,longitude,latitude,time,SST,SSS,pCO2_sw,pCO2_air,xCO2_air,pH_sw';
      const url = `${CO2_BASE}/all_pmel_co2_moorings.json?${vars}&time%3Emax(time)-730days&orderBy(%22station_id,time%22)`;
      const data = await fetchErddapJson(url, 30000);
      const cols = data.table.columnNames;
      const get = buildRowMapper(cols);

      const latestPerStation = new Map<string, { row: any[]; ts: number }>();

      for (const row of data.table.rows) {
        const stationId = get(row, 'station_id') as string;
        if (!stationId) continue;
        const id = `co2_${stationId}`;
        const ts = parseErddapTime(get(row, 'time'));
        const existing = latestPerStation.get(id);
        if (!existing || ts > existing.ts) {
          latestPerStation.set(id, { row, ts });
        }
      }

      for (const [id, { row, ts }] of latestPerStation) {
        const stationId = get(row, 'station_id') as string;
        const lat = safeNum(get(row, 'latitude'));
        const lon = safeNum(get(row, 'longitude'));
        if (lat === undefined || lon === undefined) continue;

        stations.push({
          id,
          name: stationId,
          type: 'carbon_station',
          source: 'PMEL_CO2',
          lat,
          lon,
          lastUpdate: ts,
          active: ts > Date.now() - 365 * 24 * 60 * 60 * 1000,
        });

        const m: ClimateMeasurement = {
          stationId: id,
          timestamp: ts,
          waterTemp: safeNum(get(row, 'SST')),
          salinity: safeNum(get(row, 'SSS')),
          co2: safeNum(get(row, 'xCO2_air')),
        };
        measurements.set(id, m);
      }
    } catch (e) {
      console.error('ERDDAP CO2 mooring fetch error:', e);
    }

    console.log(`CO2 moorings: ${stations.length} stations (${stations.filter(s => s.active).length} active)`);
    return { stations, measurements };
  }
}
