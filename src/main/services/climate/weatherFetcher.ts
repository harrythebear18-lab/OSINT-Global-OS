import * as https from 'https';
import * as http from 'http';
import { WebSocket } from 'ws';
import { ClimateStation, ClimateMeasurement, Storm, StormTrackPoint, LightningStrike, DataSource, Aircraft, Earthquake, SpaceWeatherData, SolarFlare, GeomagneticStorm, Wildfire, AircraftMetadata, FlightTrackPoint } from './climateTypes';
import { fetchUrl } from './httpUtil';

function safeNum(val: any): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return isNaN(n) ? undefined : n;
}

export class WeatherFetcher {
  static async fetchNWS(): Promise<{
    stations: ClimateStation[];
    measurements: Map<string, ClimateMeasurement>;
  }> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    try {
      const bands = [
        { bbox: '-180,-90,-30,90' },
        { bbox: '-30,-90,60,90' },
        { bbox: '60,-90,180,90' },
      ];

      const seenIds = new Set<string>();

      for (const band of bands) {
        try {
          const raw = await fetchUrl(
            `https://aviationweather.gov/api/data/metar?format=json&taf=false&hours=1&bbox=${band.bbox}`,
            20000
          );
          const data = JSON.parse(raw);
          if (!Array.isArray(data)) continue;

          for (const obs of data) {
            const lat = safeNum(obs.lat);
            const lon = safeNum(obs.lon);
            if (lat === undefined || lon === undefined) continue;

            const icaoId = obs.icaoId;
            if (!icaoId || seenIds.has(icaoId)) continue;
            seenIds.add(icaoId);

            const id = `metar_${icaoId}`;
            const ts = typeof obs.obsTime === 'number'
              ? obs.obsTime * 1000
              : new Date(obs.reportTime || Date.now()).getTime();

            const station: ClimateStation = {
              id,
              name: obs.name || icaoId,
              type: 'weather_station',
              source: 'NWS_WEATHER' as DataSource,
              lat,
              lon,
              elevation: safeNum(obs.elev),
              lastUpdate: ts,
              active: true,
            };

            const windSpeedKt = safeNum(obs.wspd);
            const altim = safeNum(obs.altim);
            const airTemp = safeNum(obs.temp);
            const windDir = safeNum(obs.wdir);

            if (airTemp === undefined && windSpeedKt === undefined && windDir === undefined && altim === undefined) {
              continue;
            }

            const m: ClimateMeasurement = {
              stationId: id,
              timestamp: ts,
              airTemp,
              windSpeed: windSpeedKt !== undefined ? windSpeedKt * 0.514444 : undefined,
              windDir,
              pressure: altim !== undefined ? (altim > 100 ? altim : altim * 33.8639) : undefined,
            };

            stations.push(station);
            measurements.set(id, m);
          }
        } catch (e) {
          console.error(`METAR fetch error (bbox=${band.bbox}):`, (e as Error).message);
        }
      }

      console.log(`METAR weather data fetched: ${stations.length} global stations`);
    } catch (e) {
      console.error('METAR weather fetch failed:', e);
    }

    return { stations, measurements };
  }
}

const XWEATHER_CLIENT_ID = process.env.XWEATHER_CLIENT_ID || '';
const XWEATHER_CLIENT_SECRET = process.env.XWEATHER_CLIENT_SECRET || '';
const METEOMATICS_USERNAME = process.env.METEOMATICS_USERNAME || '';
const METEOMATICS_PASSWORD = process.env.METEOMATICS_PASSWORD || '';

export class StormFetcher {
  static async fetchActiveStorms(): Promise<Storm[]> {
    const sources: Promise<Storm[]>[] = [];

    if (XWEATHER_CLIENT_ID && XWEATHER_CLIENT_SECRET) {
      sources.push(this.fetchXWeatherStorms());
    }
    if (METEOMATICS_USERNAME && METEOMATICS_PASSWORD) {
      sources.push(this.fetchMeteomaticsStorms());
    }
    sources.push(this.fetchNHCStorms());
    sources.push(this.fetchNWSAlertStorms());

    const results = await Promise.allSettled(sources);
    let allStorms: Storm[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allStorms.push(...r.value);
    }

    allStorms = this.dedupStorms(allStorms);

    const srcNames: string[] = [];
    if (XWEATHER_CLIENT_ID) srcNames.push('XWeather');
    if (METEOMATICS_USERNAME) srcNames.push('Meteomatics');
    srcNames.push('NHC');
    srcNames.push('NWS-Alerts');
    console.log(`Storms fetched: ${allStorms.length} active (sources: ${srcNames.join(', ')})`);

    return allStorms;
  }

  private static async fetchXWeatherStorms(): Promise<Storm[]> {
    const storms: Storm[] = [];
    try {
      const raw = await fetchUrl(
        `https://data.api.xweather.com/tropicalcyclones/search?filter=profile.isActive:1&client_id=${XWEATHER_CLIENT_ID}&client_secret=${XWEATHER_CLIENT_SECRET}&limit=50`,
        20000
      );
      const data = JSON.parse(raw);
      const items = data.response || [];
      for (const item of items) {
        const profile = item.profile || {};
        const track = item.track || [];
        const current = track[track.length - 1] || {};
        const lat = safeNum(current.lat) ?? safeNum(profile.position?.lat);
        const lon = safeNum(current.lon) ?? safeNum(profile.position?.lon);
        if (lat === undefined || lon === undefined) continue;

        const ts = profile.lifespan?.endTimestamp ?? Date.now();
        const stormTrack: StormTrackPoint[] = track.map((t: any) => ({
          lat: safeNum(t.lat), lon: safeNum(t.lon),
          timestamp: safeNum(t.timestamp) ?? ts,
          windSpeedKt: safeNum(t.windSpeedKTS),
          pressureMB: safeNum(t.pressureMB),
          forecastHour: safeNum(t.forecastHour),
        }));
        const forecastTrack: StormTrackPoint[] = (item.forecast || []).map((t: any) => ({
          lat: safeNum(t.lat), lon: safeNum(t.lon),
          timestamp: safeNum(t.timestamp) ?? ts,
          windSpeedKt: safeNum(t.windSpeedKTS),
          pressureMB: safeNum(t.pressureMB),
          forecastHour: safeNum(t.forecastHour),
        }));

        storms.push({
          id: `xw_${item.id || profile.name}`,
          name: profile.name || 'Unknown',
          basin: profile.basinCurrent || profile.basinOrigin || '',
          type: 'tropical_cyclone',
          classification: profile.maxStormType || '',
          intensity: profile.maxStormCat || '',
          lat, lon,
          windSpeedKt: profile.windSpeed?.maxKTS,
          pressureMB: profile.pressure?.minMB,
          lastUpdate: ts,
          track: stormTrack,
          forecastTrack,
        });
      }
      console.log(`XWeather storms: ${storms.length}`);
    } catch (e) {
      console.error('XWeather storm fetch failed:', (e as Error).message);
    }
    return storms;
  }

  private static async fetchMeteomaticsStorms(): Promise<Storm[]> {
    const storms: Storm[] = [];
    try {
      const nowISO = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const url = `https://${METEOMATICS_USERNAME}:${METEOMATICS_PASSWORD}@api.meteomatics.com/get_thunderstorm_tracks?datetime=${nowISO}&bbox=-180,-90,180,90`;
      const raw = await fetchUrl(url, 20000);
      const data = JSON.parse(raw);
      const features = data.features || [];

      const stormMap = new Map<number, any[]>();
      for (const f of features) {
        const id = f.properties?.id ?? 0;
        if (!stormMap.has(id)) stormMap.set(id, []);
        stormMap.get(id)!.push(f);
      }

      for (const [id, feats] of stormMap) {
        const current = feats.find((f: any) => f.properties?.type === 'current') || feats[0];
        const coords = current?.geometry?.coordinates;
        if (!coords) continue;

        let lat: number | undefined, lon: number | undefined;
        if (typeof coords[0] === 'number') {
          lon = coords[0]; lat = coords[1];
        } else if (Array.isArray(coords[0])) {
          const ring = coords[0];
          lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
          lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        }
        if (lat === undefined || lon === undefined) continue;

        const severity = current?.properties?.severity || 'low';
        const tsStr = current?.properties?.timestamp;
        const ts = tsStr ? new Date(tsStr).getTime() : Date.now();

        storms.push({
          id: `meteo_tstorm_${id}`,
          name: `Thunderstorm ${id}`,
          basin: '',
          type: 'thunderstorm',
          classification: severity,
          intensity: severity,
          lat, lon,
          lastUpdate: ts,
          track: [{ lat, lon, timestamp: ts }],
          forecastTrack: [],
        });
      }
      console.log(`Meteomatics storms: ${storms.length}`);
    } catch (e) {
      console.error('Meteomatics storm fetch failed:', (e as Error).message);
    }
    return storms;
  }

  private static async fetchNHCStorms(): Promise<Storm[]> {
    const storms: Storm[] = [];
    const NHC_URLS = [
      'https://www.nhc.noaa.gov/CurrentStorms.json',
      'https://nhc.noaa.gov/CurrentStorms.json',
    ];

    let raw: string | null = null;
    for (const url of NHC_URLS) {
      try {
        raw = await fetchUrl(url, 15000);
        if (raw) break;
      } catch (e) {
        console.error(`NHC fetch failed (${url}):`, (e as Error).message);
      }
    }
    if (!raw) return storms;

    try {
      const data = JSON.parse(raw);
      const activeStorms = data.activeStorms || data.ActiveStorms || [];
      for (const s of activeStorms) {
        const lat = safeNum(s.latitudeNumeric) ?? safeNum(s.latitude_numeric) ?? safeNum(s.lat);
        const lon = safeNum(s.longitudeNumeric) ?? safeNum(s.longitude_numeric) ?? safeNum(s.lon);
        if (lat === undefined || lon === undefined) continue;

        const ts = s.lastUpdate ? new Date(s.lastUpdate).getTime() : Date.now();
        const intensityNum = safeNum(s.intensity);
        const pressureNum = safeNum(s.pressure);
        storms.push({
          id: `nhc_${s.id}`,
          name: s.name || 'Unknown',
          basin: s.binNumber?.startsWith('EP') ? 'East Pacific' : s.binNumber?.startsWith('AT') ? 'Atlantic' : '',
          type: 'tropical_cyclone',
          classification: s.classification || '',
          intensity: intensityNum !== undefined ? `${intensityNum} kt` : '',
          lat, lon,
          windSpeedKt: intensityNum,
          pressureMB: pressureNum,
          movementDir: safeNum(s.movementDir) !== undefined ? String(s.movementDir) : undefined,
          movementSpeedKt: safeNum(s.movementSpeed),
          lastUpdate: ts,
          track: [{ lat, lon, timestamp: ts, windSpeedKt: intensityNum, pressureMB: pressureNum }],
          forecastTrack: [],
        });
      }
      console.log(`NHC storms: ${storms.length}`);
    } catch (e) {
      console.error('NHC storm parse error:', (e as Error).message);
    }
    return storms;
  }

  private static dedupStorms(storms: Storm[]): Storm[] {
    const result: Storm[] = [];
    for (const s of storms) {
      const isDup = result.some((r) => {
        if (r.name === s.name && r.basin === s.basin && r.basin) return true;
        const dist = Math.sqrt((r.lat - s.lat) ** 2 + (r.lon - s.lon) ** 2) * 111;
        return dist < 50;
      });
      if (!isDup) result.push(s);
    }
    return result;
  }

  private static async fetchNWSAlertStorms(): Promise<Storm[]> {
    const storms: Storm[] = [];
    try {
      const raw = await fetchUrl(
        'https://api.weather.gov/alerts/active?event=Hurricane%20Warning,Hurricane%20Watch,Tropical%20Storm%20Warning,Tropical%20Storm%20Watch,Severe%20Thunderstorm%20Warning,Tornado%20Warning,Tornado%20Watch',
        20000
      );
      const data = JSON.parse(raw);
      const features = data.features || [];

      for (const f of features) {
        const props = f.properties || {};
        const geom = f.geometry;
        if (!geom || !geom.coordinates) continue;

        let lat: number | undefined, lon: number | undefined;
        const coords = geom.coordinates;
        if (geom.type === 'Polygon' && Array.isArray(coords[0])) {
          const ring = coords[0];
          lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
          lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        } else if (geom.type === 'Point' && typeof coords[0] === 'number') {
          lon = coords[0]; lat = coords[1];
        }
        if (lat === undefined || lon === undefined) continue;

        const event = props.event || 'Severe Weather';
        const severity = props.severity || 'Minor';
        const ts = props.sent ? new Date(props.sent).getTime() : Date.now();

        storms.push({
          id: `nws_${props.id || Math.random().toString(36).slice(2)}`,
          name: event,
          basin: '',
          type: event.includes('Tornado') ? 'tornado' : event.includes('Tropical') || event.includes('Hurricane') ? 'tropical_cyclone' : 'thunderstorm',
          classification: severity,
          intensity: severity,
          lat, lon,
          lastUpdate: ts,
          track: [{ lat, lon, timestamp: ts }],
          forecastTrack: [],
        });
      }
      console.log(`NWS alert storms: ${storms.length}`);
    } catch (e) {
      console.error('NWS alert storm fetch failed:', (e as Error).message);
    }
    return storms;
  }
}

function lzwDecode(b: Buffer): string {
  const bytes = b.toString('binary');
  let c = bytes[0];
  let f = c;
  const g: string[] = [c];
  const e: Record<number, string> = {};
  let h = 256;
  let o = h;
  for (let i = 1; i < bytes.length; i++) {
    const a = bytes.charCodeAt(i);
    let val: string;
    if (a < 256) { val = bytes[a] ?? f + c; } else { val = e[a] ?? f + c; }
    g.push(val);
    c = val[0];
    e[o] = f + c;
    o++;
    f = val;
  }
  return g.join('');
}

export class LightningFetcher {
  private static blitzStrikes: LightningStrike[] = [];
  private static ws: WebSocket | null = null;
  private static connected = false;
  private static reconnectTimer: NodeJS.Timeout | null = null;
  private static reconnectDelay = 5000;
  private static errorLogged = false;

  static async fetchRecent(): Promise<LightningStrike[]> {
    const sources: Promise<LightningStrike[]>[] = [];

    if (XWEATHER_CLIENT_ID && XWEATHER_CLIENT_SECRET) {
      sources.push(this.fetchXWeatherLightning());
    }
    if (METEOMATICS_USERNAME && METEOMATICS_PASSWORD) {
      sources.push(this.fetchMeteomaticsLightning());
    }
    if (!this.connected) this.connectBlitzortung();
    sources.push(this.getBlitzortungStrikes());
    sources.push(this.fetchBlitzortungRest());

    const results = await Promise.allSettled(sources);
    let allStrikes: LightningStrike[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allStrikes.push(...r.value);
    }

    allStrikes = this.dedupStrikes(allStrikes);

    const now = Date.now();
    allStrikes = allStrikes.filter((s) => s.timestamp >= now - 30 * 60 * 1000);
    if (allStrikes.length > 5000) allStrikes = allStrikes.slice(-5000);

    if (allStrikes.length > 0) console.log(`Lightning fetched: ${allStrikes.length} strikes`);

    return allStrikes;
  }

  private static async fetchXWeatherLightning(): Promise<LightningStrike[]> {
    const strikes: LightningStrike[] = [];
    try {
      const raw = await fetchUrl(
        `https://data.api.xweather.com/lightning/summary?client_id=${XWEATHER_CLIENT_ID}&client_secret=${XWEATHER_CLIENT_SECRET}&limit=1000`,
        20000
      );
      const data = JSON.parse(raw);
      const items = data.response || [];
      for (const item of items) {
        const ob = item.ob || {};
        const loc = item.loc || {};
        const lat = safeNum(loc.lat);
        const lon = safeNum(loc.lon);
        if (lat === undefined || lon === undefined) continue;

        const ts = safeNum(ob.timestamp) ?? Date.now();
        const pulse = ob.pulse || {};
        strikes.push({
          id: `xw_ltg_${ts}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
          lat, lon,
          timestamp: ts,
          amplitude: safeNum(pulse.peakAmp) ?? safeNum(ob.peakAmp),
          polarity: (pulse.polarity || ob.polarity) > 0 ? 'positive' : 'negative',
        });
      }
    } catch (e) {
      console.error('XWeather lightning fetch failed:', (e as Error).message);
    }
    return strikes;
  }

  private static async fetchMeteomaticsLightning(): Promise<LightningStrike[]> {
    const strikes: LightningStrike[] = [];
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 5 * 60 * 1000);
      const startISO = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const endISO = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const url = `https://${METEOMATICS_USERNAME}:${METEOMATICS_PASSWORD}@api.meteomatics.com/get_lightning_list?time_range=${startISO}--${endISO}&bounding_box=-180,-90,180,90&format=json`;
      const raw = await fetchUrl(url, 20000);
      const data = JSON.parse(raw);
      const list = data.lightning_list || data.list || data || [];
      if (Array.isArray(list)) {
        for (const item of list) {
          const lat = safeNum(item.lat);
          const lon = safeNum(item.lon);
          if (lat === undefined || lon === undefined) continue;
          const ts = item.timestamp ? new Date(item.timestamp).getTime() : Date.now();
          strikes.push({
            id: `meteo_ltg_${ts}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
            lat, lon,
            timestamp: ts,
            amplitude: safeNum(item.intensity) ?? safeNum(item.peakCurrent),
            polarity: safeNum(item.type) === 1 ? 'positive' : 'negative',
          });
        }
      }
    } catch (e) {
      console.error('Meteomatics lightning fetch failed:', (e as Error).message);
    }
    return strikes;
  }

  private static async getBlitzortungStrikes(): Promise<LightningStrike[]> {
    const now = Date.now();
    this.blitzStrikes = this.blitzStrikes.filter((s) => s.timestamp >= now - 30 * 60 * 1000);
    if (this.blitzStrikes.length > 5000) this.blitzStrikes = this.blitzStrikes.slice(-5000);
    return this.blitzStrikes;
  }

  private static connectBlitzortung() {
    if (this.connected && this.ws) return;
    const servers = [
      'wss://ws1.blitzortung.org:3000/',
      'wss://ws2.blitzortung.org:3000/',
      'wss://ws3.blitzortung.org:3000/',
      'wss://ws4.blitzortung.org:3000/',
      'wss://ws5.blitzortung.org:3000/',
      'wss://ws6.blitzortung.org:3000/',
      'wss://ws7.blitzortung.org:3000/',
      'wss://ws8.blitzortung.org:3000/',
    ];
    const url = servers[Math.floor(Math.random() * servers.length)];
    try {
      this.ws = new WebSocket(url, { rejectUnauthorized: false });
      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectDelay = 5000;
        this.errorLogged = false;
        this.ws?.send(JSON.stringify({ a: 111 }));
        console.log(`Blitzortung WebSocket connected to ${url}`);
      });
      this.ws.on('message', (data: Buffer) => {
        try {
          let jsonStr: string;
          if (data.length > 0 && data[0] !== 0x7b && data[0] !== 0x5b) {
            jsonStr = lzwDecode(data);
          } else {
            jsonStr = data.toString('utf8');
          }
          const strike = JSON.parse(jsonStr);
          const lat = safeNum(strike.lat);
          const lon = safeNum(strike.lon);
          if (lat === undefined || lon === undefined) return;
          const ts = typeof strike.time === 'number' ? Math.floor(strike.time / 1e6) : Date.now();
          this.blitzStrikes.push({
            id: `blitz_ltg_${ts}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
            lat, lon, timestamp: ts,
            polarity: strike.pol > 0 ? 'positive' : 'negative',
          });
        } catch { /* ignore */ }
      });
      this.ws.on('close', () => {
        this.connected = false;
        this.ws = null;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connectBlitzortung(), this.reconnectDelay);
      });
      this.ws.on('error', (err: Error) => {
        if (!this.errorLogged) {
          console.error('Blitzortung WebSocket error:', err.message);
          this.errorLogged = true;
        }
        this.connected = false;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
      });
    } catch (e) {
      console.error('Blitzortung WebSocket connect failed:', e);
    }
  }

  private static async fetchBlitzortungRest(): Promise<LightningStrike[]> {
    const strikes: LightningStrike[] = [];
    try {
      const now = Date.now();
      const raw = await fetchUrl('https://data.blitzortung.org/Data/Protected/last_strikes.php?number=500', 15000);
      const lines = raw.trim().split('\n');
      for (const line of lines) {
        try {
          const s = JSON.parse(line);
          const lat = safeNum(s.lat);
          const lon = safeNum(s.lon);
          if (lat === undefined || lon === undefined) continue;
          const ts = typeof s.time === 'number' ? Math.floor(s.time / 1e6) : now;
          strikes.push({
            id: `blitz_rest_${ts}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
            lat, lon, timestamp: ts,
            polarity: s.pol > 0 ? 'positive' : 'negative',
          });
        } catch { /* skip */ }
      }
    } catch {
      // This endpoint may require auth — silently skip
    }
    return strikes;
  }

  private static dedupStrikes(strikes: LightningStrike[]): LightningStrike[] {
    const result: LightningStrike[] = [];
    for (const s of strikes) {
      const isDup = result.some((r) => {
        if (Math.abs(r.timestamp - s.timestamp) > 2000) return false;
        const dist = Math.sqrt((r.lat - s.lat) ** 2 + (r.lon - s.lon) ** 2) * 111;
        return dist < 0.5;
      });
      if (!isDup) result.push(s);
    }
    return result;
  }
}

// ─── ADS-B Aircraft Fetcher (OpenSky Network) ───
// Fetches real-time aircraft state vectors from the OpenSky Network REST API.
// API docs: https://openskynetwork.github.io/opensky-api/rest.html
// Rate limits: 400 credits/day for anonymous, 4000 for registered users.
// Each /states/all call costs 1 credit. We poll every 20s.

export class AircraftFetcher {
  private static lastFetch = 0;
  private static readonly MIN_INTERVAL_MS = 15000; // Respect rate limits
  private static fetchBounds: { lamin: number; lomin: number; lamax: number; lomax: number } | null = null;

  // Metadata cache: ICAO24 → metadata (cached permanently per session)
  private static metadataCache = new Map<string, AircraftMetadata>();

  /** Fetch aircraft metadata (manufacturer, model, registration, operator) by ICAO24. Cached. */
  static async fetchMetadata(icao24: string): Promise<AircraftMetadata | null> {
    const key = icao24.toLowerCase();
    if (this.metadataCache.has(key)) return this.metadataCache.get(key)!;

    try {
      const raw = await fetchUrl(
        `https://opensky-network.org/api/metadata/aircraft/icao/${key}`,
        10000
      );
      const data = JSON.parse(raw);
      const meta: AircraftMetadata = {
        icao24: key,
        registration: data.registration ?? '',
        manufacturerName: data.manufacturerName ?? '',
        model: data.model ?? '',
        typecode: data.typecode ?? '',
        icaoAircraftClass: data.icaoAircraftClass ?? '',
        operator: data.operator ?? '',
        operatorCallsign: data.operatorCallsign ?? '',
        owner: data.owner ?? '',
        categoryDescription: data.categoryDescription ?? '',
      };
      this.metadataCache.set(key, meta);
      return meta;
    } catch {
      // Metadata not available for this aircraft — cache null to avoid retries
      this.metadataCache.set(key, { icao24: key, registration: '', manufacturerName: '', model: '', typecode: '', icaoAircraftClass: '', operator: '', operatorCallsign: '', owner: '', categoryDescription: '' });
      return null;
    }
  }

  /** Fetch flight track (trajectory waypoints) for a specific aircraft. */
  static async fetchTrack(icao24: string): Promise<FlightTrackPoint[]> {
    try {
      const key = icao24.toLowerCase();
      // time=0 means get the live track if there is any flight ongoing
      const raw = await fetchUrl(
        `https://opensky-network.org/api/tracks?icao24=${key}&time=0`,
        10000
      );
      const data = JSON.parse(raw);
      if (!data.path || !Array.isArray(data.path)) return [];

      const points: FlightTrackPoint[] = [];
      for (const wp of data.path as any[]) {
        // Each waypoint: [time, latitude, longitude, baro_altitude, true_track, on_ground]
        points.push({
          time: wp[0] ?? 0,
          lat: wp[1],
          lon: wp[2],
          altitudeM: wp[3],
          heading: wp[4],
          onGround: wp[5] === true,
        });
      }
      return points;
    } catch {
      return [];
    }
  }

  /** Set bounding box for next fetch (from renderer viewport). null = global. */
  static setBounds(bounds: { n: number; s: number; e: number; w: number } | null) {
    if (!bounds) {
      this.fetchBounds = null;
      return;
    }
    // Only use bounding box if viewport is less than ~half the globe
    const latSpan = bounds.n - bounds.s;
    const lonSpan = bounds.e - bounds.w;
    if (latSpan > 90 || lonSpan > 180) {
      this.fetchBounds = null;
      return;
    }
    this.fetchBounds = {
      lamin: Math.max(-90, bounds.s - 5),
      lomin: Math.max(-180, bounds.w - 5),
      lamax: Math.min(90, bounds.n + 5),
      lomax: Math.min(180, bounds.e + 5),
    };
  }

  static async fetchAircraft(): Promise<Aircraft[]> {
    const now = Date.now();
    if (now - this.lastFetch < this.MIN_INTERVAL_MS) {
      return [];
    }
    this.lastFetch = now;

    try {
      // Build URL — use bounding box if available to reduce payload
      let url = 'https://opensky-network.org/api/states/all';
      if (this.fetchBounds) {
        const b = this.fetchBounds;
        url += `?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`;
      }
      const raw = await fetchUrl(url, 20000);

      const data = JSON.parse(raw);
      if (!data.states || !Array.isArray(data.states)) {
        console.log('Aircraft: no states in response');
        return [];
      }

      const aircraft: Aircraft[] = [];
      const nowMs = Date.now();

      for (const s of data.states as any[]) {
        // OpenSky state vector format (array):
        // [0] icao24, [1] callsign, [2] origin_country, [3] time_position,
        // [4] last_contact, [5] longitude, [6] latitude, [7] baro_altitude,
        // [8] on_ground, [9] velocity, [10] true_track, [11] vertical_rate,
        // [12] sensors, [13] geo_altitude, [14] squawk, [15] spi, [16] position_source

        const icao24 = s[0] as string;
        const callsign = (s[1] as string)?.trim() || icao24.toUpperCase();
        const originCountry = s[2] as string;
        const lastContact = s[4] as number;
        const lon = safeNum(s[5]);
        const lat = safeNum(s[6]);
        const baroAltitude = safeNum(s[7]); // meters
        const onGround = s[8] === true;
        const velocity = safeNum(s[9]); // m/s
        const heading = safeNum(s[10]); // true track degrees
        const verticalRate = safeNum(s[11]); // m/s
        const geoAltitude = safeNum(s[13]); // meters

        if (lat === undefined || lon === undefined) continue;

        const altitudeM = baroAltitude ?? geoAltitude;
        const altitudeFt = altitudeM !== undefined ? altitudeM * 3.28084 : undefined;

        aircraft.push({
          icao24,
          callsign,
          lat,
          lon,
          altitudeM,
          altitudeFt,
          velocityMs: velocity,
          heading,
          verticalRate,
          onGround,
          originCountry,
          lastContact: lastContact ? lastContact * 1000 : nowMs,
          firstSeen: nowMs,
        });
      }

      console.log(`Aircraft fetched: ${aircraft.length} active from OpenSky Network`);
      return aircraft;
    } catch (err) {
      console.error('Aircraft fetch error:', (err as Error).message);
      return [];
    }
  }
}

// ─── Seismic Fetcher (USGS Earthquake API) ───
// https://earthquake.usgs.gov/earthquakes/feed/v1.0/
// Free, no auth. Returns GeoJSON of recent earthquakes.

export class SeismicFetcher {
  static async fetchRecent(): Promise<Earthquake[]> {
    try {
      // All earthquakes in the past day with magnitude >= 2.5
      const raw = await fetchUrl(
        'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
        20000
      );
      const data = JSON.parse(raw);
      if (!data.features || !Array.isArray(data.features)) {
        console.log('Seismic: no features in response');
        return [];
      }

      const quakes: Earthquake[] = [];
      for (const f of data.features as any[]) {
        if (!f.properties || !f.geometry) continue;
        const coords = f.geometry.coordinates as number[];
        if (!coords || coords.length < 2) continue;

        quakes.push({
          id: f.id as string,
          mag: f.properties.mag ?? 0,
          place: f.properties.place ?? 'Unknown',
          lat: coords[1],
          lon: coords[0],
          depth: coords[2] ?? 0,
          time: f.properties.time ?? Date.now(),
          url: f.properties.url ?? '',
          tsunami: f.properties.tsunami === 1,
          sig: f.properties.sig ?? 0,
          mmi: safeNum(f.properties.mmi),
          alertLevel: f.properties.alert as 'green' | 'yellow' | 'orange' | 'red' | undefined,
        });
      }

      // Sort by magnitude descending
      quakes.sort((a, b) => b.mag - a.mag);
      console.log(`Seismic: ${quakes.length} earthquakes (M≥2.5) in past 24h`);
      return quakes;
    } catch (err) {
      console.error('Seismic fetch error:', (err as Error).message);
      return [];
    }
  }
}

// ─── Space Weather Fetcher (NOAA SWPC) ───
// https://services.swpc.noaa.gov/
// Free, no auth. JSON endpoints for solar flares, geomagnetic storms, solar wind.

export class SpaceWeatherFetcher {
  static async fetch(): Promise<SpaceWeatherData> {
    const [flares, storms, solarWind] = await Promise.allSettled([
      this.fetchSolarFlares(),
      this.fetchGeomagneticStorms(),
      this.fetchSolarWind(),
    ]);

    const solarFlares = flares.status === 'fulfilled' ? flares.value : [];
    const geomagneticStorms = storms.status === 'fulfilled' ? storms.value : [];
    const sw = solarWind.status === 'fulfilled' ? solarWind.value : null;

    const result: SpaceWeatherData = {
      solarFlares,
      geomagneticStorms,
      kpIndex: sw?.kpIndex,
      auroraViewline: sw?.auroraViewline,
      solarWindSpeed: sw?.speed,
      solarWindDensity: sw?.density,
      timestamp: Date.now(),
    };

    console.log(`Space weather: ${solarFlares.length} flares, ${geomagneticStorms.length} geo storms, Kp=${result.kpIndex ?? 'n/a'}, SW speed=${result.solarWindSpeed ?? 'n/a'} km/s`);
    return result;
  }

  private static async fetchSolarFlares(): Promise<SolarFlare[]> {
    const flares: SolarFlare[] = [];

    // Method 1: Parse the SWPC alerts feed for X-ray event summaries (XM5S, XM5A, etc.)
    // These contain actual flare classifications like "M6.9", "X1.2"
    try {
      const raw = await fetchUrl(
        'https://services.swpc.noaa.gov/products/alerts.json',
        15000
      );
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const entry of data as any[]) {
          const msg: string = entry.message || '';
          const product_id: string = entry.product_id || '';

          // Look for X-ray flare summaries/alerts (SUMXM5, ALTXMF, etc.)
          if (!product_id.startsWith('XM') && !product_id.startsWith('XF')) continue;

          // Extract "Xray Class: M6.9" or "Xray Class: X1.2" from message
          const classMatch = msg.match(/Xray Class:\s*([A-MX])(\d+\.?\d*)/i);
          if (!classMatch) continue;
          const cls = classMatch[1].toUpperCase();
          if (cls !== 'M' && cls !== 'X') continue;
          const intensity = parseFloat(classMatch[2]) || 0;

          // Extract peak time from "Maximum Time: 2026 Aug 25 1002 UTC"
          const timeMatch = msg.match(/Maximum Time:\s*(\d{4})\s+(\w{3})\s+(\d{1,2})\s+(\d{4})\s+UTC/i);
          let peakTime = Date.now();
          if (timeMatch) {
            const dateStr = `${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]}T${timeMatch[4].slice(0,2)}:${timeMatch[4].slice(2)}:00Z`;
            const parsed = Date.parse(dateStr);
            if (!isNaN(parsed)) peakTime = parsed;
          }

          flares.push({
            id: `flare_alert_${peakTime}_${cls}${intensity}`,
            classType: cls,
            peakTime,
            intensity,
          });
        }
      }
    } catch { /* alerts feed optional */ }

    // Method 2: Also scan the real-time X-ray flux for current M/X class flares
    // The xrays endpoint has no "class" field — we classify from flux values
    // X-class: flux >= 1e-4 W/m², M-class: flux >= 1e-5, C-class: >= 1e-6
    try {
      const raw = await fetchUrl(
        'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json',
        15000
      );
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        // Filter to the 0.1-0.8nm channel (long channel, used for classification)
        const longChannel = (data as any[]).filter(e => e.energy === '0.1-0.8nm');

        // Find peaks: entries where flux crosses M or X threshold
        let inFlare = false;
        let peakFlux = 0;
        let peakTime = 0;

        for (const entry of longChannel) {
          const flux = entry.observed_flux ?? entry.flux ?? 0;
          const time = entry.time_tag ? new Date(entry.time_tag).getTime() : Date.now();

          if (flux >= 1e-5) {
            // M-class or above
            if (!inFlare) {
              inFlare = true;
              peakFlux = flux;
              peakTime = time;
            } else if (flux > peakFlux) {
              peakFlux = flux;
              peakTime = time;
            }
          } else if (inFlare) {
            // Flare ended — record it
            const cls = peakFlux >= 1e-4 ? 'X' : 'M';
            const intensity = cls === 'X' ? peakFlux / 1e-4 : peakFlux / 1e-5;
            flares.push({
              id: `flare_xray_${peakTime}_${cls}${intensity.toFixed(1)}`,
              classType: cls,
              peakTime,
              intensity,
            });
            inFlare = false;
            peakFlux = 0;
          }
        }
        // If still in a flare at end of data
        if (inFlare && peakFlux >= 1e-5) {
          const cls = peakFlux >= 1e-4 ? 'X' : 'M';
          const intensity = cls === 'X' ? peakFlux / 1e-4 : peakFlux / 1e-5;
          flares.push({
            id: `flare_xray_${peakTime}_${cls}${intensity.toFixed(1)}`,
            classType: cls,
            peakTime,
            intensity,
          });
        }
      }
    } catch { /* xrays endpoint optional */ }

    // Deduplicate by class+intensity (rounded) + time (5-min bucket)
    const seen = new Set<string>();
    const deduped = flares.filter(f => {
      const key = `${f.classType}${f.intensity.toFixed(0)}_${Math.floor(f.peakTime / 300000)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => b.peakTime - a.peakTime);
    return deduped.slice(0, 50);
  }

  private static async fetchGeomagneticStorms(): Promise<GeomagneticStorm[]> {
    try {
      // Parse the SWPC alerts feed for geomagnetic K-index warnings/alerts
      // Product IDs: K05W (Kp=5 warning), K04A (Kp=4 alert), A30F (G2 watch), etc.
      const raw = await fetchUrl(
        'https://services.swpc.noaa.gov/products/alerts.json',
        15000
      );
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];

      const storms: GeomagneticStorm[] = [];
      for (const entry of data as any[]) {
        const product_id: string = entry.product_id || '';
        const msg: string = entry.message || '';

        // Look for geomagnetic K-index warnings (K05W, K06W, K07W, etc.) and watches (A30F, A40F)
        const isKWarning = /^K0[5-9]W$/.test(product_id);
        const isWatch = /^A[2-9]0F$/.test(product_id);
        const isKAlert = /^K0[5-9]A$/.test(product_id);

        if (!isKWarning && !isWatch && !isKAlert) continue;

        // Extract K-index from "Geomagnetic K-index of N"
        const kMatch = msg.match(/K-index of (\d)/i);
        const kpIndex = kMatch ? parseInt(kMatch[1]) : 5;

        // Extract G-scale from "Noaa Scale: G1 - Minor" or "Geomagnetic Storm Category G2"
        const gMatch = msg.match(/G(\d)/i);
        const gScale = gMatch ? parseInt(gMatch[1]) : (kpIndex >= 9 ? 5 : kpIndex >= 8 ? 4 : kpIndex >= 7 ? 3 : kpIndex >= 6 ? 2 : 1);
        const scale = `G${gScale}`;

        // Extract issue time
        const timeMatch = msg.match(/Issue Time:\s*(\d{4})\s+(\w{3})\s+(\d{1,2})\s+(\d{4})\s+UTC/i);
        let startTime = Date.now();
        if (timeMatch) {
          const dateStr = `${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]}T${timeMatch[4].slice(0,2)}:${timeMatch[4].slice(2)}:00Z`;
          const parsed = Date.parse(dateStr);
          if (!isNaN(parsed)) startTime = parsed;
        }

        // Extract a short description
        const descMatch = msg.match(/WARNING:\s*(.+?)(?:\n|$)/) || msg.match(/WATCH:\s*(.+?)(?:\n|$)/) || msg.match(/ALERT:\s*(.+?)(?:\n|$)/);
        const description = descMatch ? descMatch[1].trim().slice(0, 200) : `${scale} geomagnetic storm`;

        storms.push({
          id: `geo_${startTime}_${kpIndex}_${gScale}`,
          startTime,
          kpIndex,
          scale,
          description,
        });
      }

      storms.sort((a, b) => b.startTime - a.startTime);
      return storms.slice(0, 20);
    } catch {
      return [];
    }
  }

  private static async fetchSolarWind(): Promise<{ kpIndex?: number; auroraViewline?: number; speed?: number; density?: number } | null> {
    let kpIndex: number | undefined;
    let speed: number | undefined;
    let density: number | undefined;

    // Get current Kp from planetary K-index (returns array of objects with Kp field)
    try {
      const kpRaw = await fetchUrl(
        'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
        15000
      );
      const kpData = JSON.parse(kpRaw);
      if (Array.isArray(kpData) && kpData.length >= 1) {
        const lastKp = kpData[kpData.length - 1] as any;
        // Format: { time_tag, Kp, a_running, station_count }
        kpIndex = safeNum(lastKp?.Kp) ?? safeNum(lastKp?.kp);
      }
    } catch { /* Kp endpoint optional */ }

    // Get solar wind plasma data from the new geospace propagated solar wind endpoint
    // Format: [[time_tag, speed, density, temperature, bx, by, bz, bt, vx, vy, vz, propagated_time_tag], ...]
    try {
      const swRaw = await fetchUrl(
        'https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind-1-hour.json',
        15000
      );
      const swData = JSON.parse(swRaw);
      if (Array.isArray(swData) && swData.length >= 2) {
        const lastEntry = swData[swData.length - 1] as any[];
        // [time_tag, speed, density, temperature, ...]
        speed = safeNum(lastEntry?.[1]);
        density = safeNum(lastEntry?.[2]);
      }
    } catch { /* solar wind endpoint optional */ }

    if (kpIndex === undefined && speed === undefined && density === undefined) return null;

    return {
      kpIndex,
      speed,
      density,
    };
  }
}

// ─── Wildfire Fetcher (NASA FIRMS) ───
// NASA FIRMS provides fire detection data via their API.
// We use the open WFS/WMS feed or the REST API with a map key.
// For no-auth access, we can use the FIRMS open data feed.

export class WildfireFetcher {
  private static lastFetch = 0;
  private static readonly MIN_INTERVAL_MS = 60000; // 1 minute minimum between fetches

  static async fetchRecent(): Promise<Wildfire[]> {
    const now = Date.now();
    if (now - this.lastFetch < this.MIN_INTERVAL_MS) {
      return [];
    }
    this.lastFetch = now;

    try {
      // NASA FIRMS API — requires a free MAP_KEY (register at firms.modaps.eosdis.nasa.gov/api/map_key)
      // The MAP_KEY can be set via the FIRMS_MAP_KEY environment variable
      // Falls back to DEMO_KEY which may be rate-limited or rejected
      const mapKey = process.env.FIRMS_MAP_KEY || 'DEMO_KEY';

      // FIRMS API format: /api/area/csv/{MAP_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}
      // Valid sources: VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT, MODIS_NRT
      // Use "world" for global coverage
      const sources = ['VIIRS_SNPP_NRT', 'MODIS_NRT'];

      const fires: Wildfire[] = [];
      for (const source of sources) {
        try {
          const raw = await fetchUrl(
            `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${source}/world/1`,
            30000
          );
          // Error responses start with < (HTML) or { (JSON error)
          if (raw.startsWith('<') || raw.startsWith('{')) continue;

          const lines = raw.trim().split('\n');
          if (lines.length < 2) continue;

          const headers = lines[0].split(',').map(h => h.trim());
          this.parseFireCsv(lines, headers, fires);
        } catch { /* skip source on error */ }
      }

      // Filter to high-confidence detections and sort by brightness
      const significant = fires
        .filter(f => f.confidence === 'high' || f.confidence === 'nominal')
        .sort((a, b) => b.brightness - a.brightness)
        .slice(0, 5000); // Cap at 5000 most intense

      console.log(`Wildfire: ${significant.length} active fire detections (from ${fires.length} total)`);
      return significant;
    } catch (err) {
      console.error('Wildfire fetch error:', (err as Error).message);
      return [];
    }
  }

  private static parseFireCsv(lines: string[], headers: string[], fires: Wildfire[]): void {
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const brightIdx = headers.indexOf('bright_ti4');
    const scanIdx = headers.indexOf('scan');
    const trackIdx = headers.indexOf('track');
    const acqDateIdx = headers.indexOf('acq_date');
    const acqTimeIdx = headers.indexOf('acq_time');
    const confIdx = headers.indexOf('confidence');
    const frpIdx = headers.indexOf('frp');
    const satIdx = headers.indexOf('satellite');
    const dnIdx = headers.indexOf('daynight');

    if (latIdx < 0 || lonIdx < 0) return;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const lat = safeNum(cols[latIdx]);
      const lon = safeNum(cols[lonIdx]);
      if (lat === undefined || lon === undefined) continue;

      const acqDateStr = acqDateIdx >= 0 ? cols[acqDateIdx] : '';
      const acqTimeStr = acqTimeIdx >= 0 ? cols[acqTimeIdx] : '';
      let acqTime = Date.now();
      if (acqDateStr) {
        try {
          const timeStr = acqTimeStr ? acqTimeStr.replace(/(\d{2})(\d{2})/, '$1:$2') : '00:00';
          acqTime = new Date(`${acqDateStr}T${timeStr}:00Z`).getTime();
        } catch { /* use default */ }
      }

      fires.push({
        id: `fire_${i}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
        lat,
        lon,
        brightness: safeNum(cols[brightIdx]) ?? 0,
        scan: safeNum(cols[scanIdx]) ?? 0,
        track: safeNum(cols[trackIdx]) ?? 0,
        acqDate: acqTime,
        confidence: confIdx >= 0 ? cols[confIdx] : 'nominal',
        frp: safeNum(cols[frpIdx]) ?? 0,
        satellite: satIdx >= 0 ? cols[satIdx] : 'VIIRS',
        daynight: dnIdx >= 0 ? (cols[dnIdx] as 'D' | 'N') : 'D',
      });
    }
  }
}
