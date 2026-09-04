import { Vessel } from './climateTypes';
import { fetchUrl } from './httpUtil';

const AXIOM_API = 'https://www.axiomoverwatch.io/api/v1/positions/latest';

export class VesselFetcher {
  static async fetchVessels(): Promise<Vessel[]> {
    const url = `${AXIOM_API}?west=-180&south=-90&east=180&north=90`;

    try {
      const raw = await fetchUrl(url, 30000);
      const data = JSON.parse(raw) as {
        type: string;
        features: Array<{
          type: string;
          geometry: { type: string; coordinates: [number, number] };
          properties: {
            imo: string;
            name: string;
            vessel_type: string;
            flag: string | null;
            speed: number | null;
            course: number | null;
            draft: number | null;
            destination: string | null;
            nav_status: string | null;
            timestamp: string;
          };
        }>;
      };

      const vessels: Vessel[] = [];
      for (const f of data.features) {
        const [lon, lat] = f.geometry.coordinates;
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;

        const speed = f.properties.speed ?? 0;
        const navStatus = (f.properties.nav_status ?? '').toLowerCase();

        // Skip stationary / in-port vessels to keep memory and rendering manageable
        // Moored, anchored, at anchor, not under command, aground = not moving
        const isStatic = speed < 0.1 || /moor|anchor|aground|not under command|constrained/.test(navStatus);
        if (isStatic) continue;

        vessels.push({
          imo: f.properties.imo,
          name: f.properties.name || 'Unknown',
          lat,
          lon,
          speed: f.properties.speed ?? undefined,
          course: f.properties.course ?? undefined,
          draft: f.properties.draft ?? undefined,
          vesselType: f.properties.vessel_type ?? undefined,
          flag: f.properties.flag ?? undefined,
          navStatus: f.properties.nav_status ?? undefined,
          destination: f.properties.destination ?? undefined,
          timestamp: new Date(f.properties.timestamp).getTime(),
        });
      }

      console.log(`Vessels fetched: ${vessels.length} (filtered from ${data.features.length}, stationary/in-port excluded) from Axiom Overwatch`);
      return vessels;
    } catch (e) {
      console.error(`Vessel fetch failed:`, e);
      return [];
    }
  }
}
