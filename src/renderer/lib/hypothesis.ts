/**
 * Hypothesis types — structured reasoning cards that the LLM generates
 * and updates as new evidence comes in.
 */

export type HypothesisStatus = 'active' | 'superseded' | 'confirmed' | 'disproven'

export interface Hypothesis {
  id: string
  title: string
  statement: string
  confidence: number // 0-100
  status: HypothesisStatus
  evidence: HypothesisEvidence[]
  suggestedZones?: HypothesisZone[]
  createdAt: number
  updatedAt: number
  supersededBy?: string // id of hypothesis that replaced this one
}

export interface HypothesisEvidence {
  source: string // e.g. "slope analysis", "web search", "satellite imagery"
  finding: string
  weight: 'strong' | 'moderate' | 'weak' // how much this supports the hypothesis
}

export interface HypothesisZone {
  id: string
  coords: { lng: number; lat: number }[]
  label: string
  confidence: number // 0-100
  reasons: string[] // bullet-point explanations
  color?: string // override color (auto-derived from confidence if not set)
}

/**
 * Extract hypotheses from LLM response.
 * The LLM is prompted to output hypotheses in a structured JSON block:
 * ```hypothesis
 * { "hypotheses": [...] }
 * ```
 */
export function parseHypotheses(content: string): Hypothesis[] {
  const marker = '```hypothesis'
  const start = content.indexOf(marker)
  if (start === -1) return []

  const afterMarker = content.slice(start + marker.length)
  const end = afterMarker.indexOf('```')
  const jsonStr = end === -1 ? afterMarker : afterMarker.slice(0, end)

  try {
    const data = JSON.parse(jsonStr.trim())
    if (!data.hypotheses || !Array.isArray(data.hypotheses)) return []
    return data.hypotheses.map((h: any, i: number) => ({
      id: h.id || `hyp-${Date.now()}-${i}`,
      title: h.title || `Hypothesis ${i + 1}`,
      statement: h.statement || '',
      confidence: Math.max(0, Math.min(100, h.confidence || 50)),
      status: h.status || 'active',
      evidence: (h.evidence || []).map((e: any) => ({
        source: e.source || 'unknown',
        finding: e.finding || '',
        weight: e.weight || 'moderate',
      })),
      suggestedZones: (h.suggestedZones || []).map((z: any, j: number) => ({
        id: z.id || `zone-${Date.now()}-${j}`,
        coords: z.coords || [],
        label: z.label || 'Suggested zone',
        confidence: Math.max(0, Math.min(100, z.confidence || 50)),
        reasons: z.reasons || [],
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
  } catch {
    return []
  }
}

/** Merge new hypotheses with existing ones (update by id, mark superseded). */
export function mergeHypotheses(
  existing: Hypothesis[],
  incoming: Hypothesis[],
): Hypothesis[] {
  const result = [...existing]
  for (const inc of incoming) {
    const idx = result.findIndex((h) => h.id === inc.id)
    if (idx >= 0) {
      // Update existing
      result[idx] = { ...result[idx], ...inc, updatedAt: Date.now() }
    } else {
      // New hypothesis
      result.push(inc)
    }
    // If this hypothesis supersedes others, mark them
    if (inc.status === 'superseded' && inc.supersededBy) {
      const supIdx = result.findIndex((h) => h.id === inc.supersededBy)
      if (supIdx >= 0) {
        result[supIdx] = { ...result[supIdx], status: 'superseded', updatedAt: Date.now() }
      }
    }
  }
  return result
}

/** Get color for a confidence level (red → yellow → green). */
export function confidenceColor(confidence: number): string {
  if (confidence >= 75) return '#4ade80' // green
  if (confidence >= 50) return '#facc15' // yellow
  if (confidence >= 25) return '#fb923c' // orange
  return '#f87171' // red
}

/** Get color for a status. */
export function statusColor(status: HypothesisStatus): string {
  switch (status) {
    case 'active': return '#4ea1ff'
    case 'confirmed': return '#4ade80'
    case 'superseded': return '#7d8a9c'
    case 'disproven': return '#f87171'
  }
}
