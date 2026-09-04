import { useState, useMemo, useRef, useEffect } from 'react'
import type { DemProfileResponse } from '@shared/types'

interface ElevationProfileProps {
  profile: DemProfileResponse | null
  loading: boolean
  units: 'meters' | 'feet'
  onClose: () => void
}

/**
 * Elevation profile chart — SVG line chart of elevation vs distance.
 * Hover on chart shows a marker (callback to map integration later).
 * Shows total ascent, descent, and max slope.
 */
export function ElevationProfile({ profile, loading, units, onClose }: ElevationProfileProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Dispatch map marker event on hover
  useEffect(() => {
    if (hoverIdx != null && profile && profile.points[hoverIdx]) {
      const p = profile.points[hoverIdx]
      window.dispatchEvent(new CustomEvent('terrain:profile-hover', { detail: { lng: p.lng, lat: p.lat } }))
    } else {
      window.dispatchEvent(new CustomEvent('terrain:profile-hover', { detail: null }))
    }
  }, [hoverIdx, profile])

  const mToFt = (m: number) => m * 3.28084
  const fmtElev = (m: number | null) => (m == null ? '—' : units === 'feet' ? `${mToFt(m).toFixed(0)} ft` : `${m.toFixed(0)} m`)
  const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`)

  const chartData = useMemo(() => {
    if (!profile || profile.points.length === 0) return null

    const points = profile.points.filter((p) => p.elevation != null)
    if (points.length === 0) return null

    const elevs = points.map((p) => p.elevation as number)
    const maxElev = Math.max(...elevs)
    const minElev = Math.min(...elevs)
    const maxDist = points[points.length - 1].distance

    const W = 600
    const H = 160
    const padL = 50
    const padR = 10
    const padT = 10
    const padB = 24
    const chartW = W - padL - padR
    const chartH = H - padT - padB

    const elevRange = maxElev - minElev || 1
    const safeMaxDist = maxDist || 1 // avoid divide-by-zero for single-point/zero-distance profiles
    const yPad = elevRange * 0.1
    const yMin = minElev - yPad
    const yMax = maxElev + yPad
    const yRange = yMax - yMin

    const pathData = points
      .map((p, i) => {
        const x = padL + (p.distance / safeMaxDist) * chartW
        const y = padT + (1 - (p.elevation! - yMin) / yRange) * chartH
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

    const areaData = `${pathData} L${padL + chartW},${padT + chartH} L${padL},${padT + chartH} Z`

    // Y-axis labels (3 ticks)
    const yTicks = [yMin, yMin + yRange / 2, yMax].map((v) => ({
      value: v,
      y: padT + (1 - (v - yMin) / yRange) * chartH,
    }))

    // X-axis labels (4 ticks)
    const xTicks = [0, safeMaxDist * 0.33, safeMaxDist * 0.66, safeMaxDist].map((v) => ({
      value: v,
      x: padL + (v / safeMaxDist) * chartW,
    }))

    return { pathData, areaData, yTicks, xTicks, points, maxDist: safeMaxDist, yMin, yRange, padL, padT, chartW, chartH, W, H }
  }, [profile])

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * chartData.W
    const ratio = (x - chartData.padL) / chartData.chartW
    const idx = Math.round(ratio * (chartData.points.length - 1))
    setHoverIdx(Math.min(Math.max(idx, 0), chartData.points.length - 1))
  }

  if (loading) {
    return (
      <div className="elevation-panel">
        <div className="elevation-header">
          <span>Elevation Profile</span>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="elevation-loading">Sampling terrain...</div>
      </div>
    )
  }

  if (!profile || !chartData) {
    return null
  }

  const hoverPoint = hoverIdx != null ? chartData.points[hoverIdx] : null

  return (
    <div className="elevation-panel">
      <div className="elevation-header">
        <span>Elevation Profile</span>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="elevation-stats">
        <div className="stat">
          <span className="stat-label">Ascent</span>
          <span className="stat-value">{fmtElev(profile.totalAscent)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Descent</span>
          <span className="stat-value">{fmtElev(profile.totalDescent)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Max Slope</span>
          <span className="stat-value">{profile.maxSlopeDeg.toFixed(1)}°</span>
        </div>
        <div className="stat">
          <span className="stat-label">Distance</span>
          <span className="stat-value">{fmtDist(chartData.maxDist)}</span>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${chartData.W} ${chartData.H}`}
        className="elevation-chart"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Area fill */}
        <path d={chartData.areaData} fill="rgba(78, 161, 255, 0.15)" />

        {/* Profile line */}
        <path d={chartData.pathData} fill="none" stroke="#4ea1ff" strokeWidth="1.5" />

        {/* Y-axis ticks */}
        {chartData.yTicks.map((t, i) => (
          <g key={i}>
            <line x1={chartData.padL} y1={t.y} x2={chartData.W - 10} y2={t.y} stroke="#243044" strokeWidth="0.5" />
            <text x={chartData.padL - 4} y={t.y + 3} textAnchor="end" fontSize="9" fill="#7d8a9c">
              {fmtElev(t.value)}
            </text>
          </g>
        ))}

        {/* X-axis ticks */}
        {chartData.xTicks.map((t, i) => (
          <text key={i} x={t.x} y={chartData.H - 6} textAnchor="middle" fontSize="9" fill="#7d8a9c">
            {fmtDist(t.value)}
          </text>
        ))}

        {/* Hover marker */}
        {hoverPoint && (
          <g>
            <line
              x1={chartData.padL + (hoverPoint.distance / chartData.maxDist) * chartData.chartW}
              y1={chartData.padT}
              x2={chartData.padL + (hoverPoint.distance / chartData.maxDist) * chartData.chartW}
              y2={chartData.padT + chartData.chartH}
              stroke="#ff8c42"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
            <circle
              cx={chartData.padL + (hoverPoint.distance / chartData.maxDist) * chartData.chartW}
              cy={chartData.padT + (1 - (hoverPoint.elevation! - chartData.yMin) / chartData.yRange) * chartData.chartH}
              r="3"
              fill="#ff8c42"
            />
          </g>
        )}
      </svg>

      {hoverPoint && (
        <div className="elevation-hover">
          {fmtDist(hoverPoint.distance)} — {fmtElev(hoverPoint.elevation)}
        </div>
      )}
    </div>
  )
}
