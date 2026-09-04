# Build Plan — Terrain Scout

Living document. Check off phases as they land.

## Phase 0 — Scaffold ✅

- [x] Decide stack: Electron + Vite + React + TS + MapLibre + Turf + geotiff
- [x] Create folder structure
- [x] `package.json`, `tsconfig.json`, `electron.vite.config.ts`
- [x] `README.md` ✅
- [x] `src/shared/ipc.ts` — IPC channel constants
- [x] Write `src/main/index.ts` (Electron main: window + IPC registration + crash logging)
- [x] Write `src/preload/index.ts` (safe IPC bridge)
- [x] Write `src/shared/types.ts` (IPC payload contracts)
- [x] Write `src/renderer/index.html` + `main.tsx` + `App.tsx`
- [x] `npm install` and verify `npm run dev` opens a window

## Phase 1 — Base Map + Area Selection ✅

- [x] `MapCanvas` component — mounts MapLibre, Esri World Imagery satellite basemap
- [x] Map controls: zoom, compass, scale, fullscreen
- [x] Place name search box — Nominatim geocoding
- [x] Area selection tools: bounding box (click-drag), polygon (click vertices)
- [x] Click-to-get-coordinates
- [x] Draw a line on the map (for elevation profiles)
- [x] CRS: Web Mercator (EPSG:3857) for MapLibre + tiles
- [x] Debug overlay / dev HUD showing center lng/lat, zoom

## Phase 2 — Elevation Data Pipeline ✅

- [x] Terrarium tile URL resolver (AWS Open Data)
- [x] Main-process fetcher with on-disk cache (`~/.terrain-scout/cache/dem/`)
- [x] GeoTIFF reader (geotiff lib) → elevation grid in memory
- [x] IPC: `dem:sample(lng, lat)` → elevation in meters
- [x] IPC: `dem:profile(lineCoords)` → array of `{lng, lat, elev, distance}`
- [x] Tile resolution: sample at DEM native, resample for overlay rendering
- [x] Error handling: null elevation + "no data" indicator outside coverage

## Phase 3 — Elevation Profile UI ✅

- [x] `ElevationProfile` component — SVG line chart of elevation vs distance
- [x] Hover on chart → marker on map at that point
- [x] Stats: total ascent, descent, max slope segment
- [x] Unit toggle: meters vs feet

## Phase 4 — Slope Analysis + "Impossible Routes" ✅

- [x] Compute slope (degrees) from DEM grid using Horn's method
- [x] Slope raster → MapLibre hillshade + color raster source
- [x] Threshold: slope > X° = "impassable" (configurable)
- [x] Route feasibility: terrain-aware A* pathfinding with Tobler's hiking function
- [x] Slope bands overlay — impassable zones rendered on map
- [x] Configurable profile per activity: Hiking (35°), Scrambling (45°), SAR (50°)
- [x] Slope legend in the UI: color ramp + threshold ticks

## Phase 5 — Terrain Anomalies ✅

- [x] Compute anomaly = local deviation from smoothed elevation trend
- [x] Highlight pixels where |residual| > N std devs (2.5σ default)
- [x] Cluster anomalies into polygons
- [x] Anomaly overlay — outlined polygons, depression (purple) vs prominence (yellow)
- [x] Per-viewport / area-based computation, not global

## Phase 6 — Search Zones ✅

- [x] Last Known Point (LKP) input (right-click to place)
- [x] Ring zones at configurable radii (auto-sized from trip params)
- [x] Probability-weighted sectors based on terrain passability
- [x] `SearchZones` overlay — translucent polygons
- [x] Export: GeoJSON + KML

## Phase 7 — Likely Rest Points (behavior model) ✅

- [x] Model inputs: slope, near water (OSM Overpass), sheltered (low anomaly), within walk distance
- [x] Score grid cells → rank candidate rest points
- [x] Cluster + simplify to point markers
- [x] `RestPoints` overlay — icons sized by score
- [x] Transparency: slopeScore / waterScore / shelterScore / distanceScore per point

## Phase 8 — Imagery Overlays ✅

All sources are free and keyless — no stubs remaining.

- [x] Sentinel-2 via Element84 STAC (free, no key) — live
- [x] Esri terrain-rgb for 3D terrain (free, no key) — live
- [x] OSM water bodies via Overpass (free, no key) — live
- [x] Esri World Imagery satellite basemap (free, no key) — live
- [x] Layer switcher panel with opacity sliders
- [ ] Google basemap tiles (optional — needs key, not required)

## Phase 9 — Polish ✅

- [x] Collapsible sidebar panels per feature
- [x] Export: GeoJSON + KML + PNG snapshot
- [x] Settings: slope thresholds, rest-point weights, cache location, units
- [x] App icon + window title
- [x] Packaging (electron-builder) for Windows installer — `npm run dist`
- [x] Crash logging: log file in `~/.terrain-scout/logs/`

## Phase X — Case Profiles ✅

- [x] "M Cave" profile: preloaded area, LKP, end point, known markers
- [x] Generic "Custom Area" profile: user-defined bounding box

## Phase W — Weather (conjoin with weather-radar) ✅

Brought weather-radar project data layers into Terrain Scout:

- [x] RainViewer animated radar tiles (precipitation overlay)
- [x] RainViewer satellite IR tiles
- [x] Open-Meteo current weather + 24h forecast at LKP
- [x] Weather panel with radar timeline + forecast display

## Phase I — Import/Export ✅

- [x] Export GeoJSON (all analysis layers)
- [x] Export KML (styled for Google Earth)
- [x] Export PNG (map snapshot)
- [x] Import KML/KMZ (Google Earth projects, waypoints, tracks, polygons)

## Phase F — Fall → Flow → Find Pipeline ✅

- [x] Route Planning: terrain-aware A* pathfinding (Tobler's hiking function)
- [x] Fall Risk Map: slope + curvature + cliff edges + visibility + ground conditions
- [x] Remains Corridor: downhill-only flow from fall point (deposition zones, choke points)
- [x] Click-on-route to set fall point
- [x] All analysis constrained to drawn bounding area

## Phase T — Terrain & Physiology ✅

- [x] 3D terrain rendering (Esri terrain-rgb, pitch 60°, exaggeration 1.5x)
- [x] Hillshade toggle (2D terrain shading)
- [x] Trip parameters: timeframe, pace, pack, experience, weather, temperature, time of day, age, fitness
- [x] Physiological model: heatstroke risk, dehydration rate, speed degradation, survival window
- [x] Rainfall runoff: flow paths, pooling, watersheds, flash flood risk

## Open Decisions

- **Conjoin with weather-radar** — ✅ Resolved: brought RainViewer + Open-Meteo into Terrain Scout as weather panel
- **Behavior model weights** — ✅ Resolved: configurable via Settings panel (slope/water/shelter/distance)
- **Sentinel access** — ✅ Resolved: Element84 STAC (AWS Open Data, free, no key)
- **Hydrology data** — ✅ Resolved: OSM water bodies via Overpass (free, no key)
- **Packaging target** — ✅ Resolved: Windows x64 via electron-builder NSIS installer
- **Activity profiles** — ✅ Resolved: hiking/scrambling/SAR selectors in UI + settings

## Notes

- All heavy analysis runs in the Electron **main process** to keep the map smooth.
- IPC channels are namespaced and centralized in `src/shared/ipc.ts`.
- Cache lives at `~/.terrain-scout/cache/` so DEM tiles persist between sessions.
- Logs live at `~/.terrain-scout/logs/`.
- CRS: Web Mercator (EPSG:3857) everywhere in the UI; WGS84 (EPSG:4326) only at DEM sampling boundaries.
- All data sources are free and keyless — no API keys required for any feature.
- **Workflow:** search/zoom to area → select area (bbox or polygon) → run analysis layers on selection. Analysis never runs globally.
- **Build:** `npm run dist` produces a Windows NSIS installer in `release/`.
