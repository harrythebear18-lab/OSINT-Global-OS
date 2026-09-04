/**
 * Hiker Profile Calibration Engine
 *
 * Turns a HikerProfile (claimed times, psychology, anchors) into a
 * CalibratedHikerModel that the route planner can actually use.
 *
 * The core problem: people lie, exaggerate, or simply misjudge their
 * own hiking stats. A hiker without GPS who says "10 hours" could have
 * actually hiked 6 hours (with long rest breaks) or 12 hours (pushed hard).
 *
 * We solve this two ways:
 *  1. Perception scaling: based on claimed accuracy, scale reported times
 *  2. Anchor calibration: if we have a known point with a known time
 *     (e.g., "phone found 4 hours from truck"), we can solve for the
 *     hiker's ACTUAL speed and use that to validate/scale their claims.
 *
 * The anchor calibration is the key insight. If the hiker said "10 hours
 * round trip" but the phone (found partway) timestamps at 4 hours from
 * the truck, and the terrain distance is 8km, then their actual speed is
 * 8km/4h = 2 km/h — much slower than their claimed pace implies. This
 * tells us they were either slower than they thought, took long breaks,
 * or were struggling. All of which affects where they could have reached.
 */

import type {
  HikerProfile,
  CalibratedHikerModel,
  PerceptionAccuracy,
  NavigationMethod,
  RiskTolerance,
  GoalOrientation,
  RoutePreference,
  LngLat,
  CalibrationAnchor,
} from '@shared/types'

/* ------------------------------------------------------------------ */
/* Perception scaling                                                  */
/* ------------------------------------------------------------------ */

/**
 * Scale factor for claimed hours → estimated actual hours.
 * 1.0 = claimed time is accurate
 * 0.7 = hiker exaggerates; actual time is 70% of claimed
 * 1.3 = hiker underestimates; actual time is 130% of claimed
 */
const PERCEPTION_SCALE: Record<PerceptionAccuracy, { scale: number; uncertainty: number }> = {
  precise: { scale: 1.0, uncertainty: 0.05 },
  approximate: { scale: 0.9, uncertainty: 0.2 },
  exaggerated: { scale: 0.6, uncertainty: 0.35 },
  unreliable: { scale: 0.75, uncertainty: 0.5 }, // wide band, centered
}

/* ------------------------------------------------------------------ */
/* Navigation method → disorientation risk                             */
/* ------------------------------------------------------------------ */

const NAV_DISORIENTATION_RISK: Record<NavigationMethod, number> = {
  gps: 0.02,
  'compass-map': 0.08,
  landmark: 0.25,
  none: 0.45,
}

/* ------------------------------------------------------------------ */
/* Risk tolerance → slope threshold adjustment                         */
/* ------------------------------------------------------------------ */

const RISK_SLOPE_ADJUST: Record<RiskTolerance, number> = {
  cautious: -5,    // avoids steep terrain, lower threshold
  moderate: 0,     // default
  aggressive: 8,   // will attempt steeper terrain
  reckless: 15,    // near-climbing, very high threshold
}

/* ------------------------------------------------------------------ */
/* Goal orientation → route preference                                 */
/* ------------------------------------------------------------------ */

const GOAL_TO_PREFERENCE: Record<GoalOrientation, RoutePreference> = {
  transit: 'least-effort',
  exploration: 'scenic-trail',
  summit: 'peak-ridge',
  search: 'peak-ridge',     // searching for something on high ground = ridge-following
  lost: 'valley-contour',   // disoriented people tend to descend and follow contours
}

/**
 * Search behavior modifier: when searching, the hiker may deviate from
 * the optimal path to check vantage points, caves, or mines.
 * This increases the effective trip distance beyond the straight-line route.
 */
const SEARCH_DETOUR_FACTOR = 1.4  // actual path ~40% longer than optimal
const EXPLORATION_DETOUR_FACTOR = 1.25
const LOST_WANDER_FACTOR = 1.6    // lost people wander, backtrack, zigzag

/* ------------------------------------------------------------------ */
/* Haversine distance                                                  */
/* ------------------------------------------------------------------ */

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

/**
 * Calibrate a hiker profile against known anchors.
 *
 * If we have anchors with known times and distances, we can solve for
 * the hiker's actual walking speed. This is then compared to their
 * claimed speed to determine the perception scale.
 *
 * CRITICAL: The last known anchor (e.g., phone location) is NOT
 * necessarily the hiker's endpoint. A hiker who does multi-day trips
 * could have traveled well beyond the last anchor. We model this by:
 *  1. Using the anchor to calibrate speed (ground truth)
 *  2. Extrapolating beyond the anchor using the calibrated speed
 *     and the remaining time until they were due back / reported missing
 *  3. Expanding the search cone beyond the LKP
 */
export function calibrateHiker(
  profile: HikerProfile,
  derivedWalkSpeedMps: number,
  derivedSlopeThreshold: number,
): CalibratedHikerModel {
  const {
    perceptionAccuracy, navigationMethod, riskTolerance, goalOrientation,
    claimedTripHours, calibrationAnchors, claimedMultiDay, plannedDays, hasCampingGear,
  } = profile

  const perception = PERCEPTION_SCALE[perceptionAccuracy]
  const disorientationRisk = NAV_DISORIENTATION_RISK[navigationMethod]
  const slopeAdjust = RISK_SLOPE_ADJUST[riskTolerance]
  const routePreference = GOAL_TO_PREFERENCE[goalOrientation]

  let actualWalkSpeedMps = derivedWalkSpeedMps
  let perceptionScale = perception.scale
  let uncertaintyHours = perception.uncertainty
  let estimatedActualHours = claimedTripHours * perceptionScale

  // ── Determine if this is actually a multi-day trip ──
  // Even if they didn't plan multi-day, if they had gear and enough time,
  // they could have extended. If they claimed multi-day AND have gear,
  // treat as multi-day.
  const isMultiDay = claimedMultiDay && hasCampingGear && plannedDays > 1

  // Effective waking hours per day. Fatigue reduces this on multi-day trips.
  // Day 1: 16 hours active. Day 2: 14 (fatigue). Day 3+: 12.
  let effectiveHoursPerDay = 16
  if (isMultiDay) {
    effectiveHoursPerDay = plannedDays >= 3 ? 12 : plannedDays === 2 ? 14 : 16
  }

  // ── Anchor calibration: solve for actual speed ──
  // If we have at least 2 anchors (start + one known point), we can
  // compute the actual distance and compare to the known time.
  //
  // KEY: We use ALL anchors for speed calibration, but we identify the
  // LAST non-endpoint anchor as the "last known waypoint" (LKP).
  // The hiker may have gone well beyond this point.
  if (calibrationAnchors.length >= 2) {
    const [start, ...rest] = calibrationAnchors
    const speeds: number[] = []
    const detourFactor = getDetourFactor(goalOrientation)

    for (const anchor of rest) {
      if (anchor.hoursFromStart <= 0) continue
      // Straight-line distance × detour factor = estimated actual path distance
      const straightDist = haversineMeters(start.point.lng, start.point.lat, anchor.point.lng, anchor.point.lat)
      const estimatedPathDist = straightDist * detourFactor
      // Actual speed = distance / time
      const anchorSpeed = estimatedPathDist / (anchor.hoursFromStart * 3600)
      if (anchorSpeed > 0 && anchorSpeed < 3) { // sanity check: 0-3 m/s
        speeds.push(anchorSpeed)
      }
    }

    if (speeds.length > 0) {
      // Median speed from anchors
      speeds.sort((a, b) => a - b)
      const medianSpeed = speeds[Math.floor(speeds.length / 2)]
      actualWalkSpeedMps = medianSpeed

      // Compare to derived speed to get actual perception scale
      if (derivedWalkSpeedMps > 0) {
        perceptionScale = medianSpeed / derivedWalkSpeedMps
        // If anchor speed is much lower than derived, hiker was slower
        // than their fitness/pace suggests — they were struggling,
        // taking breaks, or the terrain was harder than expected.
        // This narrows the uncertainty band because we have ground truth.
        uncertaintyHours = Math.min(uncertaintyHours, 0.15)
      }

      // Re-estimate actual trip hours from calibrated speed
      if (claimedTripHours > 0) {
        estimatedActualHours = claimedTripHours * perceptionScale
      }
    }
  }

  // ── Adjust for goal-oriented detour behavior ──
  const detourFactor = getDetourFactor(goalOrientation)
  if (detourFactor > 1) {
    actualWalkSpeedMps = actualWalkSpeedMps / detourFactor
  }

  // ── Disorientation penalty ──
  if (disorientationRisk > 0.2) {
    const disorientationPenalty = 1 + (disorientationRisk - 0.2) * 0.5
    actualWalkSpeedMps = actualWalkSpeedMps / disorientationPenalty
    uncertaintyHours += disorientationRisk * 0.3
  }

  // ── Effective slope threshold ──
  const effectiveSlopeThreshold = Math.max(15, Math.min(60, derivedSlopeThreshold + slopeAdjust))

  // ── Total trip hours across all days ──
  let totalTripHours: number
  if (isMultiDay) {
    // Multi-day: sum waking hours across all planned days
    let total = 0
    for (let day = 1; day <= plannedDays; day++) {
      const dayHours = day >= 3 ? 12 : day === 2 ? 14 : 16
      total += dayHours
    }
    totalTripHours = total
  } else {
    // Day trip: use estimated actual hours, but cap at 16 (max waking hours)
    totalTripHours = Math.min(estimatedActualHours, 16)
  }

  // ── Last Known Waypoint (LKP) and beyond-LKP expansion ──
  // Find the last anchor that is NOT marked as an endpoint.
  // This is where the hiker was last confirmed to be — but they
  // could have traveled much further.
  let lastKnownWaypoint: CalibratedHikerModel['lastKnownWaypoint']

  const nonEndpointAnchors = calibrationAnchors.filter((a) => !a.isEndpoint)
  if (nonEndpointAnchors.length > 0) {
    // Sort by time — the latest non-endpoint anchor is the LKP
    const sortedAnchors = [...nonEndpointAnchors].sort((a, b) => b.hoursFromStart - a.hoursFromStart)
    const lkp = sortedAnchors[0]
    const startAnchor = calibrationAnchors[0]

    // Time remaining after LKP = total trip time - time to LKP
    const timeAfterLkp = Math.max(0, totalTripHours - lkp.hoursFromStart)

    // How far beyond the LKP could they have gone?
    // Use calibrated speed × remaining time × detour factor
    const maxBeyondLkpM = actualWalkSpeedMps * timeAfterLkp * 3600

    // Probable bearing: direction from start to LKP (they likely continued
    // roughly the same direction). -1 if we can't determine it.
    let probableBearing = -1
    if (startAnchor && lkp.point !== startAnchor.point) {
      probableBearing = bearingDegrees(startAnchor.point, lkp.point)
    }

    lastKnownWaypoint = {
      point: lkp.point,
      hoursFromStart: lkp.hoursFromStart,
      maxBeyondLkpM,
      probableBearing,
    }
  }

  return {
    actualWalkSpeedMps,
    estimatedActualHours,
    uncertaintyHours,
    routePreference,
    effectiveSlopeThreshold,
    disorientationRisk,
    perceptionScale,
    isMultiDay,
    effectiveHoursPerDay,
    totalTripHours,
    lastKnownWaypoint,
  }
}

/**
 * Compute bearing (compass degrees) from point A to point B.
 */
function bearingDegrees(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat))
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
            Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/**
 * Get the detour factor for a goal orientation.
 * This represents how much longer the actual path is vs. the optimal route.
 */
function getDetourFactor(goal: GoalOrientation): number {
  switch (goal) {
    case 'transit': return 1.0
    case 'exploration': return EXPLORATION_DETOUR_FACTOR
    case 'summit': return 1.2  // peak-bagging adds some distance but not huge
    case 'search': return SEARCH_DETOUR_FACTOR
    case 'lost': return LOST_WANDER_FACTOR
    default: return 1.0
  }
}

/**
 * Compute the maximum radius the hiker could have reached from their
 * start point, given the calibrated model.
 *
 * This is the "search radius" — the area that should be searched.
 * We return three values:
 *  - contracted: best case (fast hiker, direct route, good conditions)
 *  - nominal: most likely
 *  - expanded: worst case (slow, wandering, multi-day extension)
 *
 * For multi-day trips, the radius expands dramatically because the
 * hiker had many more waking hours to cover ground.
 */
export function maxReachRadius(
  model: CalibratedHikerModel,
  hoursAvailable: number,
): { nominalM: number; expandedM: number; contractedM: number } {
  // For multi-day, use total trip hours instead of single-day hours
  const effectiveHours = model.isMultiDay ? model.totalTripHours : hoursAvailable

  const maxDist = model.actualWalkSpeedMps * effectiveHours * 3600
  const uncertaintyDist = model.actualWalkSpeedMps * model.uncertaintyHours * 3600

  // For multi-day, add extra uncertainty (fatigue, weather changes, etc.)
  const multiDayExtra = model.isMultiDay ? model.actualWalkSpeedMps * 4 * 3600 : 0 // ±4 hours extra

  return {
    nominalM: maxDist,
    expandedM: maxDist + uncertaintyDist + multiDayExtra,
    contractedM: Math.max(0, maxDist - uncertaintyDist - multiDayExtra),
  }
}

/**
 * Compute the search area BEYOND the last known waypoint.
 *
 * This is the critical function for cases like Kenny Veach:
 * - We know where the phone was found (LKP)
 * - We know how long they had been hiking when the phone was there
 * - We DON'T know how much further they went after that
 *
 * Returns a search cone: a bearing, angular spread, and min/max radius
 * defining the area beyond the LKP that should be searched.
 */
export function beyondLkpSearchCone(
  model: CalibratedHikerModel,
): {
  center: LngLat
  bearing: number
  angularSpreadDeg: number
  minRadiusM: number
  maxRadiusM: number
} | null {
  if (!model.lastKnownWaypoint) return null

  const lkp = model.lastKnownWaypoint

  // Angular spread: wider if disorientation risk is high, narrower if
  // they had a clear goal (summit/search target with known bearing)
  let angularSpread = 60 // default: 60° cone
  if (model.disorientationRisk > 0.3) {
    angularSpread = 120 // lost and confused — wide search cone
  } else if (model.disorientationRisk < 0.1) {
    angularSpread = 30 // knew where they were going — narrow cone
  }

  // If we don't know the bearing (no prior direction), search 360°
  const bearing = lkp.probableBearing < 0 ? 0 : lkp.probableBearing
  if (lkp.probableBearing < 0) {
    angularSpread = 360
  }

  // Min radius: they at least reached the LKP. Search starts there.
  // Max radius: LKP + how far they could have gone beyond it.
  const minRadiusM = 0 // start searching right at the LKP
  const maxRadiusM = lkp.maxBeyondLkpM

  return {
    center: lkp.point,
    bearing,
    angularSpreadDeg: angularSpread,
    minRadiusM,
    maxRadiusM,
  }
}

/**
 * Assess whether the hiker's claimed trip is consistent with the
 * calibrated model. Returns a credibility assessment.
 */
export function assessClaimCredibility(
  profile: HikerProfile,
  model: CalibratedHikerModel,
  straightLineDistanceM: number,
): {
  credible: boolean
  reason: string
  impliedSpeedMps: number
  expectedSpeedMps: number
} {
  if (profile.claimedTripHours <= 0) {
    return {
      credible: true,
      reason: 'No claimed time to assess',
      impliedSpeedMps: 0,
      expectedSpeedMps: model.actualWalkSpeedMps,
    }
  }

  const detourFactor = getDetourFactor(profile.goalOrientation)
  const impliedPathDist = straightLineDistanceM * detourFactor
  const impliedSpeed = impliedPathDist / (profile.claimedTripHours * 3600)
  const expectedSpeed = model.actualWalkSpeedMps

  // Credible if implied speed is within 50% of expected
  const ratio = impliedSpeed / expectedSpeed
  if (ratio > 2.0) {
    return {
      credible: false,
      reason: `Claimed time implies ${impliedSpeed.toFixed(2)} m/s — over 2x their calibrated speed. Likely exaggerated or the distance is wrong.`,
      impliedSpeedMps: impliedSpeed,
      expectedSpeedMps: expectedSpeed,
    }
  } else if (ratio > 1.5) {
    return {
      credible: false,
      reason: `Claimed time implies ${impliedSpeed.toFixed(2)} m/s — 50% faster than their calibrated speed. Probably exaggerated.`,
      impliedSpeedMps: impliedSpeed,
      expectedSpeedMps: expectedSpeed,
    }
  } else if (ratio < 0.3) {
    return {
      credible: false,
      reason: `Claimed time implies only ${impliedSpeed.toFixed(2)} m/s — 70% slower than expected. They may have been struggling, injured, or the trip was much shorter than claimed.`,
      impliedSpeedMps: impliedSpeed,
      expectedSpeedMps: expectedSpeed,
    }
  }

  return {
    credible: true,
    reason: `Claimed time implies ${impliedSpeed.toFixed(2)} m/s, consistent with their calibrated speed of ${expectedSpeed.toFixed(2)} m/s.`,
    impliedSpeedMps: impliedSpeed,
    expectedSpeedMps: expectedSpeed,
  }
}
