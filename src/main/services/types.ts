/**
 * Main-process service interfaces.
 *
 * These are INTERNAL to the main process — the renderer never sees them.
 * They define the contracts the DEM / slope / anomaly / search / rest-point
 * services must implement. IPC handlers in `src/main/ipc-handlers.ts` wrap
 * these services and serialize results into the shared payload types.
 *
 * Import the shared payload types from `@shared/types` for anything that
 * crosses the IPC boundary.
 */

import type {
  LngLat,
  DemProfileResponse,
  SlopeTileResponse,
  AnomalyTileResponse,
  SearchZonesRequest,
  SearchZonesResponse,
  RestPointsRequest,
  RestPointsResponse,
} from '@shared/types';

/* ------------------------------------------------------------------ */
/* DEM tile (in-memory representation)                                  */
/* ------------------------------------------------------------------ */

export interface DemTile {
  /** Elevation in meters. null = no data (outside coverage). */
  grid: (number | null)[][];
  width: number;
  height: number;
  /** [SW corner, NE corner]. */
  bounds: [LngLat, LngLat];
}

/* ------------------------------------------------------------------ */
/* DEM Service                                                          */
/* ------------------------------------------------------------------ */

export interface DemService {
  loadTile(x: number, y: number, z: number): Promise<DemTile>;
  /** Sample elevation at a single point. null if no data. */
  sample(lng: number, lat: number): Promise<number | null>;
  /** Sample elevation along a polyline. */
  profile(coords: LngLat[]): Promise<DemProfileResponse>;
}

/* ------------------------------------------------------------------ */
/* Slope Service                                                        */
/* ------------------------------------------------------------------ */

export type ActivityProfile = 'hiking' | 'scrambling' | 'sar';
export type SlopeClass = 'passable' | 'impassable';

export interface SlopeService {
  computeFromDem(tile: DemTile): SlopeTileResponse;
  classifySlope(deg: number, profile: ActivityProfile): SlopeClass;
}

/* ------------------------------------------------------------------ */
/* Anomaly Service                                                      */
/* ------------------------------------------------------------------ */

export interface AnomalyService {
  /** Per-viewport anomaly computation — never global. */
  compute(tile: DemTile): AnomalyTileResponse;
}

/* ------------------------------------------------------------------ */
/* Search Zone Service                                                  */
/* ------------------------------------------------------------------ */

export interface SearchService {
  generateZones(req: SearchZonesRequest): Promise<SearchZonesResponse>;
}

/* ------------------------------------------------------------------ */
/* Rest Point Service                                                   */
/* ------------------------------------------------------------------ */

export interface RestPointService {
  find(req: RestPointsRequest): Promise<RestPointsResponse>;
}
