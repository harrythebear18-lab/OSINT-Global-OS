/**
 * Shared type contracts between main process and renderer.
 * These travel over IPC — keep them serializable (no class instances, no Maps).
 */

/* ------------------------------------------------------------------ */
/* Basic geometry                                                       */
/* ------------------------------------------------------------------ */

export interface LngLat {
  lng: number;
  lat: number;
}

export interface LineCoord extends LngLat {
  /** Meters from start of the polyline. */
  distance: number;
}

/* ------------------------------------------------------------------ */
/* Water features (OSM Overpass)                                       */
/* ------------------------------------------------------------------ */

export interface WaterFeature {
  id: string
  type: 'stream' | 'river' | 'lake' | 'pond' | 'spring' | 'wetland' | 'reservoir'
  coords: LngLat[]
  name?: string
}

export interface WaterRequest {
  bounds: [LngLat, LngLat]
}

export interface WaterResponse {
  features: WaterFeature[]
  bounds: [LngLat, LngLat]
}

/* ------------------------------------------------------------------ */
/* Satellite imagery (NASA GIBS)                                       */
/* ------------------------------------------------------------------ */

export interface GIBSLayer {
  id: string
  name: string
  gibsLayer: string
  format: 'jpeg' | 'png'
  tileMatrixSet: string
  maxZoom: number
  temporalResolution: string
  description: string
  category: 'true-color' | 'false-color' | 'thermal' | 'vegetation' | 'geostationary'
}

export interface SentinelScene {
  id: string
  tileUrl: string
  date: string
  cloudCover: number
  bounds: [LngLat, LngLat]
  thumbnail?: string
  isImageOverlay?: boolean
  /** Max zoom level the tile server supports. */
  maxZoom?: number
}

export interface SentinelRequest {
  bounds: [LngLat, LngLat]
  maxCloudCover?: number
  limit?: number
  /** Specific GIBS layer ID to use. */
  layerId?: string
  /** Specific date (YYYY-MM-DD). Defaults to yesterday. */
  date?: string
}

export interface SentinelResponse {
  layers: GIBSLayer[]
  scenes: SentinelScene[]
  best?: SentinelScene
}

/* ------------------------------------------------------------------ */
/* Import (KML / KMZ)                                                  */
/* ------------------------------------------------------------------ */

export interface ImportedFeature {
  id: string
  name: string
  type: 'point' | 'line' | 'polygon'
  coords: LngLat[]
  description?: string
  styleColor?: string
  folder?: string
}

export interface ImportResult {
  features: ImportedFeature[]
  bounds: [LngLat, LngLat]
  fileName: string
  featureCount: number
}

/* ------------------------------------------------------------------ */
/* Weather (RainViewer + Open-Meteo)                                  */
/* ------------------------------------------------------------------ */

export interface RadarFrame {
  time: number
  path: string
}

export interface RadarData {
  host: string
  radarPast: RadarFrame[]
  radarNowcast: RadarFrame[]
  satellite: RadarFrame[]
  generated: number
}

export interface CurrentWeather {
  temperature: number
  apparentTemp: number
  humidity: number
  windSpeed: number
  windDir: number
  precipitation: number
  pressure: number
  weatherCode: number
  isDay: boolean
}

export interface HourlyForecast {
  time: string
  temp: number
  precipProb: number
  precip: number
  windSpeed: number
  weatherCode: number
}

export interface WeatherResponse {
  current: CurrentWeather
  hourly: HourlyForecast[]
  location: LngLat
}

/* ------------------------------------------------------------------ */
/* Bounding box helpers                                                */
/* ------------------------------------------------------------------ */

/** Check if a point is within a [SW, NE] bounding box. */
export function isWithinBounds(point: LngLat, bounds: [LngLat, LngLat]): boolean {
  const [sw, ne] = bounds
  return (
    point.lng >= sw.lng &&
    point.lng <= ne.lng &&
    point.lat >= sw.lat &&
    point.lat <= ne.lat
  )
}

/** Compute the bounding box of a set of coordinates. */
export function computeBounds(coords: LngLat[]): [LngLat, LngLat] | null {
  if (coords.length < 2) return null
  const lngs = coords.map((c) => c.lng)
  const lats = coords.map((c) => c.lat)
  return [
    { lng: Math.min(...lngs), lat: Math.min(...lats) },
    { lng: Math.max(...lngs), lat: Math.max(...lats) },
  ]
}

/* ------------------------------------------------------------------ */
/* DEM Sampling                                                         */
/* ------------------------------------------------------------------ */

export interface DemSampleRequest {
  lng: number;
  lat: number;
}

export interface DemSampleResponse {
  /** Elevation in meters. null = no data (outside coverage / fetch failed). */
  elevation: number | null;
}

/* ------------------------------------------------------------------ */
/* Elevation Profile                                                    */
/* ------------------------------------------------------------------ */

export interface DemProfileRequest {
  /** Polyline to sample along. */
  coords: LngLat[];
}

export interface DemProfilePoint {
  lng: number;
  lat: number;
  /** Meters, null = no data. */
  elevation: number | null;
  /** Meters from start. */
  distance: number;
}

export interface DemProfileResponse {
  points: DemProfilePoint[];
  totalAscent: number;
  totalDescent: number;
  maxSlopeDeg: number;
}

/* ------------------------------------------------------------------ */
/* Slope Tiles                                                          */
/* ------------------------------------------------------------------ */

export interface SlopeTileRequest {
  /** Tile index. */
  x: number;
  y: number;
  z: number;
}

export interface SlopeTileResponse {
  /** Raw slope values in degrees, same resolution as DEM tile. */
  grid: number[][];
  /** Bounding box for debugging / overlay alignment. */
  bounds: [LngLat, LngLat];
}

/* ------------------------------------------------------------------ */
/* Slope Analysis (area-based, for map overlay)                        */
/* ------------------------------------------------------------------ */

export interface SlopeAnalysisRequest {
  bounds: [LngLat, LngLat];
  /** Activity profile for passability threshold. */
  profile?: 'hiking' | 'scrambling' | 'sar';
  demZoom?: number;
}

export interface SlopeBand {
  id: string;
  coords: LngLat[];
  /** Slope in degrees. */
  slopeDeg: number
  /** Classification. */
  class: 'passable' | 'steep' | 'impassable'
}

export interface SlopeAnalysisResponse {
  /** Slope grid in degrees. */
  grid: number[][];
  bounds: [LngLat, LngLat];
  /** Clustered slope bands (impassable zones). */
  bands: SlopeBand[];
  /** Legend breakpoints in degrees. */
  legend: { deg: number; label: string; color: string }[]
}

/* ------------------------------------------------------------------ */
/* Terrain Anomalies                                                    */
/* ------------------------------------------------------------------ */

export interface AnomalyTileRequest {
  x: number;
  y: number;
  z: number;
}

export interface AnomalyPolygon {
  id: string;
  coords: LngLat[];
  /** Residual magnitude. */
  strength: number;
}

export interface AnomalyTileResponse {
  polygons: AnomalyPolygon[];
}

/* ------------------------------------------------------------------ */
/* Anomaly Analysis (area-based, for map overlay)                      */
/* ------------------------------------------------------------------ */

export interface AnomalyAnalysisRequest {
  bounds: [LngLat, LngLat];
  /** Standard deviations above which a cell is an anomaly. */
  threshold?: number;
  demZoom?: number;
  /** Analysis mode. Legacy: lower threshold (more anomalies). Active SAR: higher threshold (only significant). */
  mode?: AnalysisMode;
}

export interface AnomalyZone {
  id: string;
  coords: LngLat[];
  /** Residual magnitude (std devs). */
  strength: number;
  /** Type: depression (low) or prominence (high). */
  type: 'depression' | 'prominence';
  /** Estimated size in meters. */
  sizeM: number;
}

export interface AnomalyAnalysisResponse {
  zones: AnomalyZone[];
  bounds: [LngLat, LngLat];
}

/* ------------------------------------------------------------------ */
/* Canopy Intelligence Layer                                          */
/* ------------------------------------------------------------------ */

export interface CanopyAnalysisRequest {
  /** Bounding box of the analysis area [SW, NE]. */
  bounds: [LngLat, LngLat];
  /** DEM zoom level (default 12). */
  demZoom?: number;
  /** Analysis mode. */
  mode?: AnalysisMode;
  /** Optional: override regional canopy height (meters). If not provided,
   *  the service will reverse-geocode the bbox center and web-search for
   *  average tree height in that region/biome. */
  regionalCanopyHeightM?: number;
  /** Optional: date for NDVI tiles (YYYY-MM-DD). Defaults to yesterday. */
  date?: string;
}

/** A single cell in the canopy analysis grid. */
export interface CanopyCell {
  /** Center longitude. */
  lng: number;
  /** Center latitude. */
  lat: number;
  /** Raw DEM elevation (canopy + ground) in meters. */
  rawElevation: number;
  /** NDVI value 0-1 (vegetation density). */
  ndvi: number;
  /** Estimated canopy height in meters (0 for non-forest). */
  canopyHeightM: number;
  /** Corrected ground elevation (rawElevation - canopyHeightM). */
  groundElevation: number;
  /** Classification: what's at this cell. */
  class: 'forest' | 'thinning' | 'bare' | 'water' | 'unknown';
  /** Defoliation score 0-1 (0 = healthy, 1 = complete defoliation). */
  defoliation: number;
  /** Dead tree likelihood 0-1. */
  deadTreeLikelihood: number;
}

/** A clustered canopy anomaly zone. */
export interface CanopyZone {
  id: string;
  coords: LngLat[];
  /** Zone type. */
  type: 'defoliation' | 'dead-trees' | 'clearing' | 'thinning' | 'healthy-forest';
  /** Average NDVI in the zone. */
  avgNdvi: number;
  /** Average canopy height in the zone. */
  avgCanopyHeightM: number;
  /** Area in square meters. */
  areaM2: number;
  /** Severity 0-1 (0 = mild, 1 = severe). */
  severity: number;
  /** Human-readable description. */
  description: string;
}

export interface CanopyAnalysisResponse {
  /** Grid of canopy cells. */
  cells: CanopyCell[];
  /** Clustered anomaly zones. */
  zones: CanopyZone[];
  /** Regional canopy height used (meters). */
  regionalCanopyHeightM: number;
  /** Region name from reverse geocoding. */
  regionName: string;
  /** Biome/ecosystem description from web search. */
  biomeDescription: string;
  /** Source of the canopy height estimate. */
  canopyHeightSource: string;
  /** Bounds of the analysis. */
  bounds: [LngLat, LngLat];
  /** Grid dimensions. */
  gridWidth: number;
  gridHeight: number;
}

/* ------------------------------------------------------------------ */
/* Trip Parameters (drives all analysis models)                        */
/* ------------------------------------------------------------------ */

export type Pace = 'slow' | 'normal' | 'fast'
export type PackWeight = 'light' | 'medium' | 'heavy'
export type ExperienceLevel = 'novice' | 'experienced' | 'expert'
export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'extreme'
export type TimeOfDay = 'morning' | 'midday' | 'afternoon' | 'night'
export type AgeGroup = 'young' | 'adult' | 'elderly'
export type FitnessLevel = 'unfit' | 'average' | 'fit'

export interface TripParams {
  /** Hours since last seen (0–72). Drives search zone expansion. */
  hoursSinceLastSeen: number
  /** Day number (1-based) for multi-day analysis. */
  day: number
  /** Walking pace — affects walk radius and rest point distance. */
  pace: Pace
  /** Pack weight — heavier = slower, more rest stops. */
  packWeight: PackWeight
  /** Experience — affects risk tolerance on steep terrain. */
  experience: ExperienceLevel
  /** Weather — affects shelter scoring and survival window. */
  weather: WeatherCondition
  /** Ambient temperature in °C. Drives heatstroke + dehydration risk. */
  temperatureC: number
  /** Time of day — midday sun = peak heatstroke risk. */
  timeOfDay: TimeOfDay
  /** Age group — elderly = higher heatstroke risk. */
  ageGroup: AgeGroup
  /** Fitness level — unfit = faster exhaustion, shorter range. */
  fitness: FitnessLevel
}

/** Derived constants from TripParams. */
export interface TripDerived {
  /** Effective walk speed in meters/second. */
  walkSpeedMps: number
  /** Max walk distance in meters for the given hours. */
  maxWalkDistanceM: number
  /** Slope threshold (degrees) above which terrain is impassable. */
  impassableSlopeDeg: number
  /** Rest interval in minutes (heavier pack = more frequent rests). */
  restIntervalMin: number
  /** Shelter weight multiplier (bad weather = shelter matters more). */
  shelterWeight: number
  /** Survival window in hours (weather + physiology dependent). */
  survivalWindowHr: number
  /** Heatstroke risk 0–1 (temperature + time of day + exertion + age). */
  heatstrokeRisk: number
  /** Environmental dehydration rate in liters/hour (how fast conditions dehydrate anyone). */
  dehydrationRateLPerHr: number
  /** Speed reduction factor from heat exhaustion (0.5–1.0). */
  physioSpeedFactor: number
  /** Shade urgency weight 0–1 (high heat = shade is top priority for rest). */
  shadeUrgency: number
  /** Hours until severe dehydration at current environmental rate. */
  hoursToSevereDehydration: number
  /** Physiological risk summary label. */
  riskLabel: 'low' | 'moderate' | 'high' | 'critical'
}

/* ------------------------------------------------------------------ */
/* Search Zones                                                         */
/* ------------------------------------------------------------------ */

export interface SearchZonesRequest {
  /** Last Known Point. */
  lkp: LngLat;
  /** Ring radii in meters. */
  radii: number[];
  /** Trip parameters — drive zone expansion + probability. */
  tripParams?: TripParams;
  /** Bounding box [SW, NE]. In legacy mode, used for bbox-spread probability. */
  bounds?: [LngLat, LngLat];
  /** Analysis mode. Default: 'active-sar'. */
  mode?: AnalysisMode;
}

export interface SearchZone {
  radius: number;
  polygon: LngLat[];
  /** 0–1, probability weighting from terrain passability. */
  probability: number;
}

export interface SearchZonesResponse {
  zones: SearchZone[];
}

/* ------------------------------------------------------------------ */
/* Route Planning (terrain-aware pathfinding)                          */
/* ------------------------------------------------------------------ */

export interface RoutePlanRequest {
  /** Start point (e.g. trailhead, LKP). */
  start: LngLat
  /** End point (e.g. destination, last known direction). */
  end: LngLat
  /** Bounding box constraining the search area [SW, NE]. */
  bounds: [LngLat, LngLat]
  /** Trip params — affect slope tolerance, speed, route preference. */
  tripParams?: TripParams
  /** DEM zoom level (default 12). */
  demZoom?: number
  /** If true, also generate probable alternative routes. */
  includeAlternatives?: boolean
  /** Route style — changes how the cost function weights uphill/ridge/valley. */
  routePreference?: RoutePreference
  /** Full hiker profile — when provided, overrides tripParams + routePreference
   *  with calibrated values derived from psychology + known anchors. */
  hikerProfile?: HikerProfile
  /** Analysis mode. Active SAR: single corridor. Legacy: trail network analysis. */
  mode?: AnalysisMode
}

/**
 * Route preference — changes the cost model on the fly.
 *
 * - 'least-effort': Tobler's hiking function as-is. Minimizes energy.
 *   Goes uphill when it's the shorter path, but prefers gentler grades.
 * - 'shortest': Nearly ignores slope. Picks the most direct path that
 *   isn't impassable. Good for "they would have gone straight there".
 * - 'peak-ridge': Rewards elevation gain and ridge-following. For peak-
 *   bagging / summit routes. Uphill is cheaper, ridges are preferred.
 * - 'valley-contour': Penalizes elevation changes. Follows contours and
 *   valleys. For lost-person wandering or stream-following routes.
 * - 'scenic-trail': Balanced, slightly prefers ridges and avoids steep
 *   both up and down. Mimics maintained trail routing.
 */
export type RoutePreference = 'least-effort' | 'shortest' | 'peak-ridge' | 'valley-contour' | 'scenic-trail'

/* ------------------------------------------------------------------ */
/* Hiker Profile (psychological + perceptual model)                    */
/* ------------------------------------------------------------------ */

/**
 * How reliable are the hiker's self-reported distances/times?
 * This scales claimed hours to estimated actual hours.
 */
export type PerceptionAccuracy =
  | 'precise'      // GPS-tracked, verified — take at face value
  | 'approximate'  // Experienced hiker, no GPS — ±20% error
  | 'exaggerated'  // Tends to embellish — scale down 30-50%
  | 'unreliable'   // No way to verify — wide uncertainty band

/**
 * What navigation aids did the hiker have?
 * Affects disorientation probability and route directness.
 */
export type NavigationMethod = 'gps' | 'compass-map' | 'landmark' | 'none'

/**
 * How risk-tolerant is the hiker on steep/exposed terrain?
 * Affects which slopes they'll attempt vs. detour around.
 */
export type RiskTolerance = 'cautious' | 'moderate' | 'aggressive' | 'reckless'

/**
 * What is the hiker's primary goal? This changes route shape:
 *  - transit:       A to B efficiently (standard route planning)
 *  - exploration:   Wanders, follows interesting features, loops
 *  - summit:        Seeks high points, ridge-following, uphill reward
 *  - search:        Looking for something specific — may revisit areas,
 *                   follow ridges for vantage, check caves/mines
 *  - lost:          Disoriented — tends to follow path of least resistance
 *                   downhill, follows animal trails, seeks water
 */
export type GoalOrientation = 'transit' | 'exploration' | 'summit' | 'search' | 'lost'

/**
 * A known data point that can calibrate the model.
 * E.g., "phone found at mine shaft, 4 hours from truck"
 * lets us solve for actual walking speed.
 *
 * IMPORTANT: An anchor is NOT necessarily the hiker's endpoint.
 * A phone found at 4 hours might just be where the battery died
 * or where it was dropped. The hiker could have continued much
 * further. Use `isEndpoint` to distinguish.
 */
export interface CalibrationAnchor {
  /** Label for this anchor (e.g., "Truck", "Phone at mine shaft"). */
  label: string
  /** Location of the anchor point. */
  point: LngLat
  /** Known time from start to this point, in hours. */
  hoursFromStart: number
  /** How confident is this time? */
  confidence: 'exact' | 'estimated' | 'approximate'
  /** Is this the hiker's final known destination, or just a waypoint?
   *  A phone found on the ground is a WAYPOINT — they kept going.
   *  A vehicle at a trailhead is a WAYPOINT (start point).
   *  Only mark as endpoint if we know they stopped here. */
  isEndpoint: boolean
}

/**
 * Hiker profile — captures psychology, perception, and goals.
 * Extends the physical TripParams with behavioral modeling.
 */
export interface HikerProfile {
  /** Physical trip parameters (pace, fitness, weather, etc). */
  tripParams: TripParams
  /** How reliable are their claimed distances/times? */
  perceptionAccuracy: PerceptionAccuracy
  /** What navigation aids did they have? */
  navigationMethod: NavigationMethod
  /** Risk tolerance on steep/exposed terrain. */
  riskTolerance: RiskTolerance
  /** What were they trying to do? */
  goalOrientation: GoalOrientation
  /** Hours they claimed the trip would take (one-way). 0 = unknown. */
  claimedTripHours: number
  /** Known data points to calibrate actual speed. */
  calibrationAnchors: CalibrationAnchor[]
  /** Did the hiker claim to do multi-day trips with overnight camping?
   *  If true, their effective range is much larger than a day hike.
   *  A 2-day trip at 2 km/h × 16 waking hours = 64km one-way. */
  claimedMultiDay: boolean
  /** How many days did they say they'd be gone? (0 = unknown/day trip) */
  plannedDays: number
  /** Did they have camping gear (tent, sleeping bag)? Affects whether
   *  they could sustain multi-day movement or would need shelter. */
  hasCampingGear: boolean
}

/**
 * Result of calibrating a hiker profile against known anchors.
 * This is what the route planner actually uses.
 */
export interface CalibratedHikerModel {
  /** Estimated actual walking speed in m/s (calibrated, not claimed). */
  actualWalkSpeedMps: number
  /** Estimated actual one-way trip duration in hours. */
  estimatedActualHours: number
  /** Uncertainty band: actual hours are likely within ±this. */
  uncertaintyHours: number
  /** Effective route preference derived from goal + risk. */
  routePreference: RoutePreference
  /** Effective impassable slope threshold (degrees), adjusted for risk. */
  effectiveSlopeThreshold: number
  /** Disorientation probability (0-1), from navigation method + terrain. */
  disorientationRisk: number
  /** How much the hiker's claimed time was scaled (1.0 = accurate). */
  perceptionScale: number
  /** Is this a multi-day trip? Affects search radius dramatically. */
  isMultiDay: boolean
  /** Effective waking hours per day (reduced by fatigue on multi-day). */
  effectiveHoursPerDay: number
  /** Total estimated trip duration across all days, in hours. */
  totalTripHours: number
  /** The last known waypoint (NOT necessarily the endpoint).
   *  The hiker may have traveled well beyond this point. */
  lastKnownWaypoint?: {
    point: LngLat
    hoursFromStart: number
    /** How far beyond the LKP could they have gone? */
    maxBeyondLkpM: number
    /** Probable direction of travel beyond LKP (bearing in degrees, -1 = unknown). */
    probableBearing: number
  }
}

export interface RouteSegment {
  coords: LngLat[]
  /** Energy cost for this segment. */
  cost: number
  /** Slope in degrees for this segment. */
  slopeDeg: number
  /** Whether this segment is on a ridge, valley, or slope. */
  terrain: 'ridge' | 'valley' | 'slope' | 'flat'
  /** Fall risk along this segment (0–1). */
  fallRisk: number
}

export interface PlannedRoute {
  id: string
  /** Primary (least-cost) or alternative. */
  type: 'primary' | 'alternative'
  coords: LngLat[]
  segments: RouteSegment[]
  /** Total distance in meters. */
  totalDistanceM: number
  /** Total energy cost. */
  totalCost: number
  /** Estimated walking time in hours. */
  estimatedHours: number
  /** Max fall risk along the route (0–1). */
  maxFallRisk: number
  /** Whether the route passes through high fall-risk zones. */
  hasDangerSections: boolean
  /** Elevation profile (simplified — sampled points). */
  elevations: { lng: number; lat: number; elevation: number | null; distance: number }[]
}

export interface RoutePlanResponse {
  primary: PlannedRoute
  alternatives: PlannedRoute[]
  /** Fall risk zones along/near the route. */
  fallRiskZones: FallRiskZone[]
  /** Bounds used. */
  bounds: [LngLat, LngLat]
  /** Calibration results — only present when a hiker profile was provided.
   *  Shows how the hiker's claimed stats were adjusted to match reality. */
  calibration?: CalibratedHikerModel
  /** Credibility assessment of the hiker's claimed trip time. */
  credibility?: {
    credible: boolean
    reason: string
    impliedSpeedMps: number
    expectedSpeedMps: number
  }
  /** Maximum reachable radius from start point (search area guidance). */
  reachRadius?: {
    nominalM: number
    expandedM: number
    contractedM: number
  }
}

export interface FallRiskRequest {
  /** Bounding box of the analysis area [SW, NE]. */
  bounds: [LngLat, LngLat]
  /** Trip params for visibility/exposure + ground conditions. */
  tripParams?: TripParams
  /** DEM zoom level (default 12). */
  demZoom?: number
  /** Analysis mode. In legacy mode, scans full bbox. In active SAR, focuses on corridor. */
  mode?: AnalysisMode
  /** Optional corridor route to constrain active-SAR fall risk to. */
  routeCoords?: LngLat[]
}

export type FallRiskLevel = 'low' | 'medium' | 'high' | 'extreme'

export interface FallRiskZone {
  id: string
  coords: LngLat[]
  /** Risk score 0–1. */
  risk: number
  level: FallRiskLevel
  /** Dominant reason for the risk rating. */
  reason: string
  /** Component scores. */
  slopeScore: number
  curvatureScore: number
  edgeScore: number
  visibilityScore: number
}

export interface FallRiskResponse {
  zones: FallRiskZone[]
  /** Grid of risk scores (0–1), same dimensions as DEM tile. */
  grid: number[][]
  bounds: [LngLat, LngLat]
}

/* ------------------------------------------------------------------ */
/* Downhill Search Corridor (remains search)                           */
/* ------------------------------------------------------------------ */

export interface RemainsCorridorRequest {
  /** Fall point — where the person likely fell. */
  fallPoint: LngLat
  /** Bounding box constraining the search area [SW, NE]. */
  bounds: [LngLat, LngLat]
  /** Rainfall in mm (0 = gravity-only dry fall). */
  rainfallMm?: number
  /** DEM zoom level (default 12). */
  demZoom?: number
}

export interface DepositionZone {
  id: string
  coords: LngLat[]
  /** Priority 0–1 (higher = more likely deposition). */
  priority: number
  /** Type of deposition feature. */
  type: 'shelf' | 'basin' | 'snag' | 'fan' | 'confluence'
  /** Reason this is a deposition zone. */
  reason: string
}

export interface CorridorPath {
  id: string
  coords: LngLat[]
  /** Primary (main gully) or secondary (branch). */
  primary: boolean
  /** Flow accumulation at terminal point. */
  accumulation: number
}

export interface ChokePoint {
  id: string
  coord: LngLat
  /** Why this is a choke point. */
  reason: string
}

export interface RemainsCorridorResponse {
  /** Downhill flow paths from the fall point. */
  paths: CorridorPath[]
  /** Deposition zones where remains are likely to come to rest. */
  depositionZones: DepositionZone[]
  /** Choke points — narrow constrictions where debris gets caught. */
  chokePoints: ChokePoint[]
  /** Terminal zone — the fan/outlet where the corridor ends. */
  terminalZone: {
    coords: LngLat[]
    areaKm2: number
  } | null
  /** Rainfall used (0 = dry gravity-only). */
  rainfallMm: number
}

export interface RunoffRequest {
  /** Bounding box of the analysis area [SW, NE]. */
  bounds: [LngLat, LngLat]
  /** Rainfall amount in mm. */
  rainfallMm: number
  /** DEM zoom level to use (default 12). */
  demZoom?: number
  /** Analysis mode. Active SAR: flood search area now. Legacy: historical channeling. */
  mode?: AnalysisMode
}

/** A detected water flow path (stream/channel). */
export interface FlowPath {
  id: string
  coords: LngLat[]
  /** Flow accumulation at the end point (upstream contributing cells). */
  accumulation: number
  /** Estimated discharge in L/s for the given rainfall. */
  dischargeLps: number
}

/** A pooling/ponding area where water collects. */
export interface PoolingArea {
  id: string
  coords: LngLat[]
  /** Estimated volume in liters. */
  volumeL: number
  /** Depth in meters. */
  depthM: number
}

/** A watershed divide segment. */
export interface WatershedDivide {
  id: string
  coords: LngLat[]
  /** Watershed label (e.g. "Watershed A"). */
  label: string
  /** Area in km². */
  areaKm2: number
}

/** A flash flood risk zone. */
export interface FloodRiskZone {
  id: string
  coords: LngLat[]
  /** Risk level 0–1. */
  risk: number
  /** Reason for risk (steep channel, narrow constriction, etc). */
  reason: string
}

export interface RunoffResponse {
  flowPaths: FlowPath[]
  poolingAreas: PoolingArea[]
  watershedDivides: WatershedDivide[]
  floodRiskZones: FloodRiskZone[]
  /** Total rainfall in mm used for the analysis. */
  rainfallMm: number
}

/**
 * Global analysis mode — changes reasoning style across the entire app.
 *
 * 'active-sar': Real, time-critical rescue. LKP is real and recent.
 *   - LKP-centric, tight corridors, trip params matter, weather is critical.
 *   - Conservative, evidence-driven, high-confidence, no speculation.
 *
 * 'legacy-research': Historical, cold-case, exploratory terrain study.
 *   - LKP is an estimate. Bbox is the primary frame. Terrain-focused.
 *   - Speculation allowed. Wide-area search. Multi-source OSINT.
 *   - Anomaly detection, pattern analysis, historical context emphasized.
 */
export type AnalysisMode = 'active-sar' | 'legacy-research'

export interface RestPointsRequest {
  lkp: LngLat;
  /** Walk-time limit in hours. */
  maxHours: number;
  /** Trip parameters — drive scoring weights + walk radius. */
  tripParams?: TripParams;
  /** Bounding box to constrain the search [SW, NE]. If provided, candidates
   *  are clipped to this area instead of a circular radius around LKP. */
  bounds?: [LngLat, LngLat];
  /** Analysis mode — changes scoring behavior. Default: 'active-sar'. */
  mode?: AnalysisMode;
}

export interface RestPoint {
  id: string;
  lng: number;
  lat: number;
  /** Combined score. */
  score: number;
  slopeScore: number;
  waterScore: number;
  shelterScore: number;
  distanceScore: number;
}

export interface RestPointsResponse {
  points: RestPoint[];
}

/* ------------------------------------------------------------------ */
/* Behavior Engine                                                     */
/* ------------------------------------------------------------------ */

export interface BehaviorEngineRequest {
  bounds: [LngLat, LngLat];
  sourcePoints?: LngLat[];
  destination?: LngLat;
  agentCount?: number;
  timesteps?: number;
  tripParams?: TripParams;
  mode?: string;
  useHazards?: boolean;
}

export interface BehaviorPath {
  id: string;
  coords: LngLat[];
  confidence: number;
  estimatedHours: number;
  agentCount: number;
  type: 'primary' | 'alternate';
}

export interface BehaviorDecisionPoint {
  id: string;
  lng: number;
  lat: number;
  type: 'funnel' | 'rest' | 'obstacle' | 'split' | 'destination';
  significance: number;
  reason: string;
  agentCount: number;
}

export interface BehaviorDensityZone {
  id: string;
  coords: LngLat[];
  density: number;
  estimatedCount: number;
  type: 'congregation' | 'bottleneck' | 'dispersal';
}

export interface BehaviorProbabilityCell {
  lng: number;
  lat: number;
  probability: number;
}

export interface BehaviorEngineResponse {
  paths: BehaviorPath[];
  decisionPoints: BehaviorDecisionPoint[];
  densityZones: BehaviorDensityZone[];
  probabilityField: BehaviorProbabilityCell[];
  bounds: [LngLat, LngLat];
  agentCount: number;
  timestepsCount: number;
}
