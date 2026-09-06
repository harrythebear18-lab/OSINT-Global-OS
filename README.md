# OSINT Global OS

> A desktop geospatial intelligence console for search-and-rescue teams, field planners, climate analysts, and serious backcountry users.
>
> It turns raw elevation data, satellite imagery, live weather, ocean sensors, and aircraft tracking into actionable intelligence: where a missing person likely walked, where they might have fallen, where to search downhill, what the climate is doing, and what's moving in the sky.

## Status

**v1.2.0 — stable release.** Core SAR analysis pipeline, global OSINT overlays, climate integrity verification, 7-model prediction engine, road-aware routing, multi-box analysis, canopy intelligence layer, behavior engine, local AI analyst, privacy mode, and per-layer clear controls are live.

## What It Does

### SAR Pipeline (Fall -> Flow -> Find)

1. **Plan a route** — terrain-aware pathfinding between two points, following the terrain like a human would walk it (A* with Tobler's hiking function, Catmull-Rom spline smoothing, route preferences for least-effort / peak-ridge / valley-contour)
2. **Identify fall risk** — where along that route is someone likely to fall? (slope + curvature + cliff edges + visibility + ground conditions, convex hull zone shapes)
3. **Trace the remains corridor** — from a fall point, trace downhill-only where remains would end up (deposition zones, choke points, terminal fan)

### Hiker Profile Calibration Engine

Models individual hiker behavior — not just optimal routes, but how a *specific person* likely moved:

- **Perception accuracy** — does the hiker exaggerate trip times? (precise / approximate / exaggerated / unreliable)
- **Navigation method** — GPS vs compass vs dead reckoning (drives disorientation risk)
- **Risk tolerance** — conservative vs risk-taking (adjusts slope thresholds)
- **Goal orientation** — destination-focused vs explorer vs summit-seeker (changes route preference)
- **Anchor calibration** — if we have known waypoints with times (e.g., phone GPS log), we solve for the hiker's *actual* walking speed and compare to their claimed speed
- **Multi-day range** — if the hiker had camping gear and planned multiple days, the search radius expands dramatically (fatigue-adjusted waking hours per day)
- **Beyond-LKP search cone** — the last known point (e.g., where the phone was found) is NOT the endpoint. The model computes how far beyond the LKP they could have traveled, with a directional search cone (30° if they knew where they were going, 120° if disoriented, 360° if no bearing known)

### Terrain Analysis Layers

- **Elevation profiles** — SVG chart along any drawn line
- **Slope analysis** — Horn's method, impassable bands by activity profile (hiking/scrambling/SAR)
- **Terrain anomalies** — depressions and prominences (caves, sinkholes, ridges) via smoothed residual + std dev clustering
- **Search zones** — probability-weighted rings from Last Known Point, auto-sized from trip parameters
- **Rest points** — behavior model scoring slope/water/shelter/distance, adjusted for weather and physiology. Active SAR mode applies LKP walk-radius constraints even with a bbox; requires at least two strong scoring factors; max 40 points with non-maximum suppression
- **Rainfall runoff** — flow paths, pooling areas, watershed divides, flash flood risk from DEM + rainfall input
- **Canopy intelligence** — geolocation-aware forest analysis: reverse-geocodes the bbox center, infers biome and climate, looks up regional average tree height (built-in biome database + web search fallback), fetches MODIS NDVI from NASA GIBS, detects defoliation / dead-tree clusters / clearings / thinning, and corrects ground elevation by subtracting estimated canopy thickness from the DEM (pseudo-LiDAR)
- **Behavior engine** — portable UEBS2-style terrain behavior simulation (logic-first, not animation-first). Runs up to 5,000 agents through terrain physics with group movement (A* pathfinding), hazard avoidance (cliffs, steep slopes), fatigue + rest modeling, and corridor following. Outputs four layers: probability fields (where agents likely are), path predictions (likely group routes with confidence + travel time), decision points (splits, funnels, rest stops, obstacles), and density zones (bottlenecks, congregation, dispersal). Mode-aware: SAR mode supports a live operational tick (3-second refresh cycle); Legacy mode is single-shot
- **3D terrain** — toggle hillshade and 3D terrain rendering using Terrarium DEM tiles
- **Per-layer clear** — each analysis layer has its own ✕ clear button that removes only that layer's overlays without resetting the rest of the map

### Global OSINT Overlays

- **Aircraft tracking** — live ADS-B positions from OpenSky Network (729+ active aircraft)
- **Weather stations** — METAR data from 230+ global stations + NDBC ocean buoys
- **Seismic activity** — USGS earthquakes (M>=2.5) in the past 24 hours
- **Storm tracks** — NHC tropical systems + NWS alert storms
- **Space weather** — solar flares, geomagnetic storms, Kp index, solar wind speed
- **Wildfires** — NASA FIRMS active fire detections
- **Lightning** — Blitzortung real-time stroke data (WebSocket)
- **Ocean sensors** — Argo floats (4,000+ active), CO2 moorings, bathymetry grid
- **Ship traffic** — AIS vessel positions (AISHub)

### Climate Integrity & Prediction Engine

- **Climate integrity panel** — verifies data source consistency, flags anomalies, tracks sensor failures
- **7-model prediction engine:**
  1. Ocean-atmosphere coupling (ENSO-like pattern detection)
  2. Radar nowcast (short-term precipitation)
  3. Storm track prediction
  4. Climate anomaly detection
  5. Sensor failure prediction
  6. Severe weather prediction
  7. Precipitation forecast

### Satellite Imagery (NASA GIBS)

Stable XYZ tiles — no scene IDs, no 404s, no rate limits, no API key. 12 layers available via dropdown:

| Category | Layers |
|---|---|
| True Color | MODIS Terra (250m daily), VIIRS SNPP (300m daily), Landsat WELD (30m annual), Sentinel-2 Mosaic (20m) |
| False Color | MODIS 7-2-1 (vegetation/burn scars) |
| Vegetation | MODIS NDVI (16-day) |
| Thermal | Land Surface Temp Day, Land Surface Temp Night |
| Geostationary | GOES-East (15-min), Himawari-8 (10-min), Meteosat-11 (15-min) |
| Night | VIIRS Day/Night Band (nighttime lights) |

### Local AI Analyst (Ollama)

The console includes a built-in AI assistant powered by local Ollama models — no cloud, no API keys, full privacy.

- **Text reasoning** — Qwen Coder 7B (or any Ollama model) as the local reasoning module
- **Vision analysis** — Qwen-VL can analyze the current map view (structures, vegetation, water bodies, burn scars)
- **Tool calls** — the AI can call analysis tools directly: slope, search zones, rest points, route planning, fall risk, runoff, anomaly detection, canopy intelligence, satellite search, web search, and hypothesis generation
- **Web search** — DuckDuckGo + Wikipedia + NWS for real-time context (weather alerts, news, road closures, missing person reports)
- **Mode-aware** — Active SAR mode produces conservative, LKP-driven hypotheses; Legacy/Research mode produces broad, exploratory hypotheses
- **Chat + Hypotheses tabs** — collapsible bottom bar in the map area; chat for conversation, hypotheses for structured search priorities with confidence levels and suggested zones

### Privacy Mode

The network telemetry panel (Net, VPN, DNS, Traffic tabs) includes a built-in privacy toggle that masks sensitive data by default:

- **ON by default** — public IPs, hostnames, process names, DNS servers, and connection counts are masked
- **Type YES to reveal** — turning privacy off requires typing YES in a confirmation dialog, preventing accidental exposure
- **Persists across sessions** — the preference is saved to localStorage
- **Warning banner** — visible when privacy is active, reminding users that sensitive data is masked

This protects users who screen-record or share their session from accidentally doxing themselves.

### Platform-Aware Memory Tiers

The app automatically adjusts V8 heap limits and Ollama settings based on platform and available RAM:

| Platform | RAM | Heap Limit | Ollama Context |
|---|---|---|---|
| macOS (portable) | <=16 GB | 384 MB | 2048 tokens, 2m keep-alive |
| macOS (desktop) | >16 GB | 6144 MB | 4096 tokens, 5m keep-alive |
| Windows (low) | <=16 GB | 2048 MB | 4096 tokens, 5m keep-alive |
| Windows (high) | >16 GB | 4096 MB | 4096 tokens, 5m keep-alive |

## Physiological Risk Model

Trip parameters drive all analysis models with real human factors:

- **Timeframe** (1-72h since last seen) + **day number** (fatigue factor)
- **Pace** (slow/normal/fast), **pack weight** (light/medium/heavy)
- **Experience** (novice/experienced/expert) — affects slope tolerance
- **Weather** (clear/cloudy/rain/snow/extreme) — affects shelter scoring + survival window
- **Temperature** (-10 to 45C) — drives heatstroke + dehydration risk
- **Time of day** (morning/midday/afternoon/night) — sun exposure factor
- **Age group** (young/adult/elderly) — heatstroke vulnerability
- **Fitness** (unfit/average/fit) — speed + heat tolerance

Derived outputs: effective walk speed, max walk distance, impassable slope threshold, rest interval, shelter weight, survival window, heatstroke risk (0-1), environmental dehydration rate (L/hr), speed reduction from heat exhaustion, shade urgency, risk label (low/moderate/high/critical).

## Case Profiles

Preloaded scenarios for real-world testing:

- **M Cave (Kenny Veach)** — disappeared Nov 2014 near Sheep Mountain / Nellis Range boundary while searching for the "M Cave." Preloaded with approximate LKP, end point, and known POIs (trailhead, Sheep Mountain, Nellis boundary, reported search area). The hiker profile calibration engine is designed for exactly this kind of case — a hiker who claimed multi-day trips, had camping gear, and whose phone (LKP) was found far from where they were last seen.
- **Custom Area** — user-defined (draw your own bounding box)

## Unified Marker Layer

All markers — LKP, end point, fall point, weather pin, and custom/imported markers — render in a single unified layer on top of all analysis overlays. Click any marker for a popup with its label and coordinates. Custom markers can be placed by external components (case profiles, imported KML points) via a simple event bus.

## Data Import / Export

- **Export GeoJSON** — all analysis layers as a FeatureCollection (importable by QGIS, etc.)
- **Export KML** — styled placemarks for Google Earth
- **Export PNG** — map screenshot
- **Import KML/KMZ** — load existing Google Earth projects, search grids, waypoints

## Tech Stack

- **Shell:** Electron 32
- **Build:** electron-vite + Vite 5
- **UI:** React 18 + TypeScript
- **Map:** MapLibre GL JS (free, no API key required)
- **Geospatial analysis:** @turf/turf
- **DEM:** Terrarium tiles (AWS SRTM) for analysis + Esri terrain-rgb for 3D rendering (both free, no key)
- **Basemap:** Esri World Imagery (satellite, free, no key)
- **Satellite imagery:** NASA GIBS (12 layers, stable XYZ tiles, no key)
- **Geocoding:** Nominatim (OpenStreetMap, free, no key)
- **3D terrain:** MapLibre terrain rendering from Esri terrain-rgb (z15, ~1m resolution)
- **Hydrology:** OSM water bodies via Overpass API (free, no key)
- **Aircraft:** OpenSky Network (free, no key)
- **Weather:** METAR (aviationweather.gov), NDBC (NOAA), NWS alerts
- **Seismic:** USGS Earthquake API
- **Storms:** NHC + NWS
- **Space weather:** NOAA SWPC
- **Wildfire:** NASA FIRMS
- **Ocean:** Argo, NOAA CO2 moorings
- **Local AI:** Ollama (Qwen Coder 7B, Qwen-VL) — local reasoning + vision analysis, no cloud

## Data Sources

| Source | Use | Status | Key needed? |
|--------|-----|--------|-------------|
| Terrarium (AWS SRTM) | Elevation / DEM for all analysis | Live | No |
| Esri World Imagery | Satellite basemap | Live | No |
| Esri terrain-rgb | 3D terrain + hillshade | Live | No |
| NASA GIBS | Satellite imagery (12 layers) | Live | No |
| Nominatim (OSM) | Place name search | Live | No |
| OSM water bodies (Overpass) | Hydrology for rest point water proximity | Live | No |
| OpenSky Network | Live aircraft tracking | Live | No |
| METAR (aviationweather.gov) | Global weather stations | Live | No |
| NDBC (NOAA) | Ocean buoy weather | Live | No |
| USGS Earthquake API | Seismic activity | Live | No |
| NHC + NWS | Storm tracks | Live | No |
| NOAA SWPC | Space weather | Live | No |
| NASA FIRMS | Wildfire detection | Live | No |
| Blitzortung | Lightning detection | Live | No |
| Argo | Ocean profiling floats | Live | No |

All data sources are **free and keyless**. No API keys are required for any feature. The app runs fully out of the box.

## Getting Started

### From source

```bash
# clone the repo
git clone https://github.com/harrythebear18-lab/OSINT-Global-OS.git
cd OSINT-Global-OS

# install deps
npm install

# run in dev (launches Electron window with hot reload)
npm run dev

# typecheck
npm run typecheck

# production build (compiles to out/)
npm run build

# launch built app
npm run preview
```

Requires Node 18+ (developed on Node 24).

### Build a Windows installer

```bash
npm run dist
```

This runs `electron-vite build` + `electron-builder --win` and produces an NSIS installer in `release/`. Double-click the installer to install like any normal Windows app.

For a portable (no-install) build:
```bash
npm run dist:dir
```

### Build a macOS app

```bash
npm run dist:mac
```

Produces a `.dmg` in `release/`. macOS builds include memory optimizations for portable rigs (MacBook Air, etc.) — the app automatically detects available RAM and adjusts V8 heap limits and Ollama settings accordingly.

### Branch structure

- **`main`** — stable release branch, tagged with version numbers
- **`develop`** — ongoing development work

To contribute, branch off `develop`, make changes, and open a PR back to `develop`.

## How to Use

1. **Load a case profile** (sidebar top) or search for a location and draw a bounding box
2. **Set trip parameters** — timeframe, weather, temperature, pace, etc.
3. **Right-click** on the map to place the LKP (Last Known Point / start)
4. **Shift+click** to place the end point (destination)
5. **Run analysis layers:**
   - Slope analysis (with activity profile selector)
   - Terrain anomalies (find caves, depressions)
   - Search zones (auto-sized from trip params)
   - Rest points (behavior model)
   - Rainfall runoff (flow paths, flood risk)
   - Canopy intelligence (defoliation, dead trees, ground height correction)
   - Behavior engine (group movement simulation, probability fields, decision points)
   - Satellite imagery (NASA GIBS — 12 layers)
   - Each layer has a ✕ clear button to remove only that overlay
6. **Incident Analysis (Fall -> Flow -> Find):**
   - Plan route (terrain-aware A* pathfinding with hiker profile calibration + spline smoothing)
   - Click on the green route line to set a fall point
   - Run remains corridor (downhill-only search from fall point)
7. **AI Analyst** (bottom bar):
   - Chat tab — ask questions, the AI can call any analysis tool
   - Hypotheses tab — structured search priorities with confidence and zones
   - Vision analysis — AI can analyze the current map view (requires Qwen-VL)
   - Web search — AI can search for real-time context (weather, news, road closures)
8. **Global OSINT overlays** (right panel):
   - Toggle aircraft, weather, seismic, storms, space weather, wildfires, lightning, ocean sensors
   - Climate integrity verification
   - 7-model prediction engine
9. **Export** results to GeoJSON, KML, or PNG for field use

## Project Structure

```
osint-global-os/
├── src/
│   ├── main/                          # Electron main process — heavy analysis
│   │   ├── services/
│   │   │   ├── dem-service.ts              # DEM tile loading + sampling
│   │   │   ├── dem-tiles.ts                # Terrarium tile URL resolver + cache
│   │   │   ├── slope-service.ts            # Horn's method slope + area analysis
│   │   │   ├── anomaly-service.ts          # Terrain anomaly detection
│   │   │   ├── search-service.ts           # Probability-weighted search zones
│   │   │   ├── rest-service.ts             # Rest point behavior model
│   │   │   ├── runoff-service.ts           # Rainfall runoff hydrology
│   │   │   ├── route-service.ts            # A* terrain-aware route planning + spline smoothing
│   │   │   ├── fall-risk-service.ts        # Fall risk identification + convex hull zones
│   │   │   ├── remains-corridor-service.ts # Downhill remains search
│   │   │   ├── canopy-service.ts           # Canopy intelligence (NDVI + DEM correction)
│   │   │   ├── behavior-engine.ts          # UEBS2-style terrain behavior simulation
│   │   │   ├── hiker-profile.ts            # Hiker profile calibration engine
│   │   │   ├── trip-params.ts              # Physiological model derivation
│   │   │   ├── sentinel-service.ts         # NASA GIBS satellite imagery
│   │   │   ├── ollama-service.ts           # Local AI model + tool definitions
│   │   │   ├── web-search-service.ts       # DuckDuckGo + Wikipedia + NWS search
│   │   │   ├── water-service.ts            # OSM hydrology via Overpass
│   │   │   ├── weather-service.ts          # METAR + radar weather
│   │   │   ├── import-service.ts           # KML/KMZ import
│   │   │   ├── export-service.ts           # GeoJSON + KML + PNG export
│   │   │   ├── case-profiles.ts            # Preloaded case scenarios
│   │   │   ├── climate/                    # Climate integrity + data sources
│   │   │   ├── grid/                       # Grid sensor data (Argo, buoys)
│   │   │   ├── network/                    # Network data (aircraft, ships, lightning)
│   │   │   └── types.ts                    # Service interface contracts
│   │   └── ipc-handlers.ts                 # IPC channel registration
│   ├── preload/                       # Preload bridge — safe IPC API
│   ├── renderer/                      # React UI + MapLibre map
│   │   ├── components/
│   │   │   ├── MapCanvas.tsx               # Map + drawing + event dispatch
│   │   │   ├── MapOverlays.tsx             # All analysis layer rendering
│   │   │   ├── MarkerLayer.tsx             # Unified marker rendering (LKP, endpoints, custom)
│   │   │   ├── MapProvider.tsx             # Map context + state
│   │   │   ├── GlobalOverlays.tsx          # OSINT overlay rendering (aircraft, weather, etc.)
│   │   │   ├── GlobalLayerPanel.tsx        # OSINT layer toggle controls
│   │   │   ├── LayerSwitcher.tsx           # Base map + overlay layer switcher
│   │   │   ├── SearchBox.tsx               # Nominatim place search
│   │   │   ├── DrawTools.tsx               # Drawing + 3D toggle toolbar
│   │   │   ├── ElevationProfile.tsx        # SVG elevation chart
│   │   │   ├── TripParamsPanel.tsx         # Trip parameter controls
│   │   │   ├── AnalysisPanel.tsx           # Analysis run controls + export
│   │   │   ├── IncidentPanel.tsx           # Fall -> Flow -> Find pipeline
│   │   │   ├── AIChatPanel.tsx             # Local AI analyst chat + tool dispatch
│   │   │   ├── CaseProfilePanel.tsx        # Case profile loader
│   │   │   ├── ClimateIntegrityPanel.tsx   # Climate data verification UI
│   │   │   ├── PredictionPanel.tsx         # 7-model prediction display
│   │   │   ├── WeatherPanel.tsx            # Weather station display
│   │   │   ├── RightPanel.tsx              # Right panel shell with tabs
│   │   │   ├── Sidebar.tsx                 # Left sidebar (collapsible)
│   │   │   └── SettingsPanel.tsx           # App settings
│   │   ├── hooks/                    # React hooks wrapping IPC calls
│   │   └── styles/                   # CSS
│   └── shared/                       # Types + IPC contracts (main & renderer)
│       ├── types.ts                  # All payload types + bounds helpers
│       └── ipc.ts                    # IPC channel constants
├── scripts/
│   └── dev.cjs                       # Dev launcher (unsets ELECTRON_RUN_AS_NODE)
├── electron.vite.config.ts
├── tsconfig.json
└── package.json
```

## Architecture

- All heavy analysis (DEM fetch, slope calc, route finding, runoff, fall risk, climate models) runs in the **Electron main process** to keep the map smooth
- IPC channels are namespaced in `src/shared/ipc.ts`
- DEM tile cache lives at `~/.terrain-scout/cache/` so elevation data persists between sessions
- All analysis is **constrained to the drawn bounding area** — points placed outside are clamped or flagged with warnings
- Collapsible left and right sidebars for screen real estate management
- Unified marker layer renders all markers (LKP, endpoints, fall points, weather pins, custom/imported) in one place, always on top of analysis overlays
- CRS: Web Mercator (EPSG:3857) in the UI; WGS84 (EPSG:4326) at DEM sampling boundaries

## License

MIT
