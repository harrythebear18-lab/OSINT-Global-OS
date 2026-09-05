/**
 * IPC channel constants — single source of truth.
 * Never hardcode channel strings elsewhere; import from here.
 */
export const IPC = {
  // ─── Terrain Scout (original) ───
  DEM_SAMPLE: 'dem:sample',
  DEM_PROFILE: 'dem:profile',
  SLOPE_TILE: 'slope:tile',
  ANOMALY_TILE: 'anomaly:tile',
  SLOPE_ANALYSIS: 'slope:analysis',
  ANOMALY_ANALYSIS: 'anomaly:analysis',
  SEARCH_ZONES: 'search:zones',
  REST_POINTS: 'rest:points',
  RUNOFF_ANALYSIS: 'runoff:analysis',
  ROUTE_PLAN: 'route:plan',
  FALL_RISK: 'incident:fall-risk',
  REMAINS_CORRIDOR: 'incident:corridor',
  EXPORT_GEOJSON: 'export:geojson',
  EXPORT_KML: 'export:kml',
  WATER_FETCH: 'water:fetch',
  SENTINEL_SEARCH: 'sentinel:search',
  CANOPY_ANALYSIS: 'canopy:analysis',
  IMPORT_KML: 'import:kml',
  CLEAR_CACHE: 'cache:clear',
  EXPORT_PNG: 'export:png',
  WEATHER_RADAR: 'weather:radar',
  WEATHER_FORECAST: 'weather:forecast',

  // ─── Climate / Ocean monitor (from weather-radar) ───
  CLIMATE_UPDATE: 'climate:update',         // main→renderer push
  CLIMATE_INTEGRITY: 'climate:integrity',   // main→renderer push
  CLIMATE_ALERT: 'climate:alert',           // main→renderer push
  CLIMATE_TRAFFIC: 'climate:traffic',       // main→renderer push
  CLIMATE_WHITELIST: 'climate:whitelist',
  CLIMATE_UNWHITELIST: 'climate:unwhitelist',
  CLIMATE_SNOOZE: 'climate:snooze',
  CLIMATE_GET_SNOOZE: 'climate:get-snooze',
  CLIMATE_SET_VIEWPORT: 'climate:set-viewport',

  // ─── Prediction engine ───
  PREDICTION_UPDATE: 'prediction:update',   // main→renderer push

  // ─── Aircraft (on-demand) ───
  AIRCRAFT_WEATHER_ALERTS: 'aircraft:weather-alerts',  // main→renderer push
  AIRCRAFT_METADATA: 'aircraft:metadata',
  AIRCRAFT_TRACK: 'aircraft:track',

  // ─── Windy webcam proxy ───
  WINDY_FETCH: 'windy:fetch',

  // ─── Grid monitor ───
  GRID_UPDATE: 'grid:update',               // main→renderer push
  GRID_INTEGRITY: 'grid:integrity',         // main→renderer push
  GRID_ALERT: 'grid:alert',                 // main→renderer push
  GRID_TRAFFIC: 'grid:traffic',             // main→renderer push
  GRID_SETTINGS: 'grid:settings',           // main→renderer push
  GRID_WHITELIST: 'grid:whitelist',
  GRID_UNWHITELIST: 'grid:unwhitelist',
  GRID_GET_WHITELIST: 'grid:get-whitelist',
  GRID_SNOOZE: 'grid:snooze',
  GRID_GET_SNOOZE: 'grid:get-snooze',
  GRID_GET_SETTINGS: 'grid:get-settings',
  GRID_UPDATE_SETTINGS: 'grid:update-settings',
  GRID_SET_CROSS_DOMAIN: 'grid:set-cross-domain',
  GRID_GET_CROSS_DOMAIN: 'grid:get-cross-domain',

  // ─── Network monitor ───
  NET_UPDATE: 'net:update',                 // main→renderer push
  NET_TRAFFIC: 'net:traffic',               // main→renderer push
  NET_ALERT: 'net:alert',                   // main→renderer push
  NET_HEALTH: 'net:health',                 // main→renderer push
  NET_OUTAGE: 'net:outage',                 // main→renderer push
  NET_VPN: 'net:vpn',                       // main→renderer push
  NET_USER_LOCATION: 'net:userLocation',    // main→renderer push
  NET_PRECISE_LOCATION: 'net:preciseLocation', // main→renderer push
  SPEEDTEST_PROGRESS: 'speedtest:progress', // main→renderer push
  NET_VPN_REFRESH: 'net:vpn:refresh',
  NET_GEOIP_LOOKUP: 'net:geoip:lookup',
  NET_GEOIP_CLEAR_CACHE: 'net:geoip:clearCache',
  NET_ALERTS_WHITELIST: 'net:alerts:whitelist',
  NET_ALERTS_UNWHITELIST: 'net:alerts:unwhitelist',
  NET_ALERTS_GET_WHITELIST: 'net:alerts:getWhitelist',
  NET_ALERTS_SNOOZE: 'net:alerts:snooze',
  NET_ALERTS_IS_SNOOZED: 'net:alerts:isSnoozed',
  NET_HEALTH_GET_CURRENT: 'net:health:getCurrent',
  NET_HEALTH_GET_OUTAGE_HISTORY: 'net:health:getOutageHistory',
  NET_HEALTH_GET_ACTIVE_OUTAGE: 'net:health:getActiveOutage',
  NET_CONFIG_SAVE: 'net:config:save',
  NET_CONFIG_LOAD: 'net:config:load',
  NET_SPEEDTEST_RUN: 'net:speedtest:run',
  NET_DNSTEST_RUN: 'net:dnstest:run',
  NET_DNSTEST_CUSTOM: 'net:dnstest:custom',
  NET_DNSTEST_DEFAULTS: 'net:dnstest:defaults',
  NET_EXPORT_OUTAGE_HISTORY: 'net:export:outageHistory',
  NET_EXPORT_CONNECTION_LOGS: 'net:export:connectionLogs',
  NET_REPORT_GENERATE: 'net:report:generateHealthReport',
  NET_NOTIFICATION_TEST_EMAIL: 'net:notification:testEmail',
  NET_NOTIFICATION_TEST_SMS: 'net:notification:testSMS',
  NET_BANDWIDTH_GET_SNAPSHOT: 'net:bandwidth:getSnapshot',
  NET_BANDWIDTH_GET_HISTORY: 'net:bandwidth:getHistory',
  NET_BANDWIDTH_GET_TOP_USERS: 'net:bandwidth:getTopUsers',
  NET_BANDWIDTH_GET_TOTAL: 'net:bandwidth:getTotal',
  NET_QUALITY_GET_SNAPSHOT: 'net:quality:getSnapshot',
  NET_QUALITY_GET_HISTORY: 'net:quality:getHistory',
  NET_QUALITY_GET_HEATMAP: 'net:quality:getHeatmap',
  NET_TRACEROUTE_RUN: 'net:traceroute:runDetailed',
  NET_TOPOLOGY_GET: 'net:topology:getMap',

  // ─── AI / Ollama / CLIP ───
  AI_HEALTH: 'ai:health',
  AI_CHAT: 'ai:chat',
  AI_CHAT_STREAM: 'ai:chat:stream',
  AI_VISION: 'ai:vision',
  AI_EMBED: 'ai:embed',
  AI_CLIP_HEALTH: 'ai:clip:health',
  AI_CLIP_EMBED_TEXT: 'ai:clip:embed:text',
  AI_CLIP_EMBED_IMAGE: 'ai:clip:embed:image',
  AI_CLIP_SIMILARITY: 'ai:clip:similarity',
  AI_CLIP_SEARCH: 'ai:clip:search',
  WEB_SEARCH: 'web:search',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
