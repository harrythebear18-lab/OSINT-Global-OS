/**
 * Ollama Service — local LLM reasoning layer for OSINT-Global-OS.
 *
 * Connects to a local Ollama instance (default: http://localhost:11434).
 * Supports:
 *  - Chat completion (qwen2.5-coder:7b for reasoning/planning)
 *  - Vision analysis (qwen2.5vl:7b for satellite/map image interpretation)
 *  - Tool calling (function calling via Ollama's native tool support)
 *  - Model listing and health checks
 *  - Streaming responses via callback
 *
 * All requests are local — no data leaves the machine.
 */

import type { LngLat } from '@shared/types'

const OLLAMA_BASE = 'http://localhost:11434'

export interface OllamaModel {
  name: string
  size: number
  digest: string
  capabilities: string[]
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[] // base64-encoded images for vision models
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown> // JSON Schema
  }
}

export interface ChatOptions {
  model?: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  stream?: boolean
  temperature?: number
  context?: string // injected context (map state, analysis results, etc.)
  onToken?: (token: string) => void
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  model: string
  done: boolean
}

/** Default model assignments — can be overridden by user settings. */
export const DEFAULT_MODELS = {
  reasoning: 'qwen2.5-coder:7b',
  vision: 'qwen2.5vl:7b',
  fallback: 'llama3.1:8b',
} as const

/** Check if Ollama is running and list available models. */
export async function checkHealth(): Promise<{ running: boolean; models: OllamaModel[] }> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`)
    if (!res.ok) return { running: false, models: [] }
    const data = await res.json() as { models: any[] }
    const models: OllamaModel[] = (data.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      digest: m.digest,
      capabilities: m.details?.capabilities || [],
    }))
    return { running: true, models }
  } catch {
    return { running: false, models: [] }
  }
}

/** Send a chat completion request to Ollama. */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const model = opts.model || DEFAULT_MODELS.reasoning
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    stream: opts.stream ?? false,
    options: {
      temperature: opts.temperature ?? 0.7,
    },
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
  }

  // Non-streaming
  if (!opts.stream) {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama chat failed (${res.status}): ${text}`)
    }
    const data = await res.json()
    return {
      content: data.message?.content || '',
      toolCalls: data.message?.tool_calls || [],
      model: data.model || model,
      done: data.done ?? true,
    }
  }

  // Streaming
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  })
  if (!res.ok || !res.body) {
    throw new Error(`Ollama streaming failed (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let content = ''
  const toolCalls: ToolCall[] = []
  let done = false
  let buffer = ''

  while (true) {
    const { value, done: streamDone } = await reader.read()
    if (streamDone) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const chunk = JSON.parse(line)
        if (chunk.message?.content) {
          content += chunk.message.content
          opts.onToken?.(chunk.message.content)
        }
        if (chunk.message?.tool_calls) {
          toolCalls.push(...chunk.message.tool_calls)
        }
        if (chunk.done) done = true
      } catch {
        // partial JSON, skip
      }
    }
  }

  return { content, toolCalls, model, done }
}

/** Send a vision request (image + prompt) to Qwen-VL. */
export async function vision(
  imageBase64: string,
  prompt: string,
  model?: string,
): Promise<string> {
  const vModel = model || DEFAULT_MODELS.vision
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: vModel,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [imageBase64],
        },
      ],
      stream: false,
      options: { temperature: 0.3 },
    }),
  })
  if (!res.ok) {
    throw new Error(`Ollama vision failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json()
  return data.message?.content || ''
}

/** Generate embeddings via Ollama (for text similarity). */
export async function embed(text: string, model?: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'llama3.1:8b',
      prompt: text,
    }),
  })
  if (!res.ok) {
    throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json()
  return data.embedding || []
}

// --- SAR-specific tool definitions ---

/** Tool definitions that the LLM can call to interact with the map/analysis. */
export const SAR_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'run_slope_analysis',
      description: 'Run slope analysis on the current search area. Returns slope bands and impassable terrain.',
      parameters: {
        type: 'object',
        properties: {
          activity_profile: {
            type: 'string',
            enum: ['hiking', 'scrambling', 'sar'],
            description: 'The activity profile to use for slope thresholds.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_search_zones',
      description: 'Compute probability-weighted search zones from the Last Known Point.',
      parameters: {
        type: 'object',
        properties: {
          radii: {
            type: 'array',
            items: { type: 'number' },
            description: 'Search radii in meters (e.g. [500, 1000, 3000, 5000]).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_rest_points',
      description: 'Find likely rest points based on terrain scoring (slope, water, shelter, distance).',
      parameters: {
        type: 'object',
        properties: {
          max_hours: {
            type: 'number',
            description: 'Maximum hours since last seen.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_route',
      description: 'Plan a terrain-aware route between two points using A* with Tobler\'s hiking function.',
      parameters: {
        type: 'object',
        properties: {
          preference: {
            type: 'string',
            enum: ['least-effort', 'peak-ridge', 'valley-contour'],
            description: 'Route preference.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_fall_risk',
      description: 'Identify fall risk zones along the current route or within the search area.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_runoff',
      description: 'Trace rainfall runoff: flow paths, pooling areas, flood risk zones.',
      parameters: {
        type: 'object',
        properties: {
          rainfall_mm: {
            type: 'number',
            description: 'Rainfall in millimeters.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_anomaly',
      description: 'Detect terrain anomalies: depressions (caves, sinkholes) and prominences (ridges, peaks).',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_map_context',
      description: 'Get the current map state: center, zoom, selection bounds, LKP, active layers, and analysis results.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_satellite_image',
      description: 'Send the current map view (or a specific satellite tile) to Qwen-VL for visual analysis. Useful for identifying structures, vegetation, water bodies, burn scars, etc.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to look for in the image (e.g. "identify any structures or buildings", "assess vegetation density").',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for real-time information: weather alerts, news, place names, road closures, terrain context, historical events, etc. Uses DuckDuckGo, Wikipedia, and NWS APIs. Always use this when you need current/external information that is not in the local analysis results.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g. "weather alerts near Yosemite", "recent missing person reports California", "road closures Highway 140").',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_hypotheses',
      description: 'Generate structured SAR hypotheses with confidence levels, supporting evidence, and suggested search zones. ALWAYS use this when asked to assess the situation, prioritize search areas, or reason about where the missing person might be. Output as a ```hypothesis JSON block.',
      parameters: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            description: 'Number of hypotheses to generate (default: 3, max: 5).',
          },
        },
      },
    },
  },
]

// --- Context builder ---

export interface MapContext {
  center: LngLat
  zoom: number
  selection: { type: string; coords: LngLat[] } | null
  lkp: LngLat | null
  endPoint: LngLat | null
  activeLayers: string[]
  analysisResults: Record<string, unknown>
  tripParams: Record<string, unknown>
}

/** Build a system prompt with current map/analysis context. */
export function buildSystemPrompt(ctx: MapContext): string {
  const parts: string[] = [
    'You are the AI analyst embedded in OSINT-Global-OS, a geospatial intelligence console for search-and-rescue (SAR) operations.',
    'You have access to terrain analysis, satellite imagery, weather data, aircraft/ship tracking, and climate sensors.',
    'Your role is to help SAR teams, field planners, and analysts reason about the situation on the ground.',
    '',
    '## Current Map State',
    `- Center: ${ctx.center.lng.toFixed(4)}, ${ctx.center.lat.toFixed(4)} (zoom ${ctx.zoom})`,
  ]

  if (ctx.lkp) {
    parts.push(`- Last Known Point (LKP): ${ctx.lkp.lng.toFixed(4)}, ${ctx.lkp.lat.toFixed(4)}`)
  }
  if (ctx.endPoint) {
    parts.push(`- End Point / Destination: ${ctx.endPoint.lng.toFixed(4)}, ${ctx.endPoint.lat.toFixed(4)}`)
  }
  if (ctx.selection) {
    const boundsStr = ctx.selection.coords.length >= 2
      ? `${ctx.selection.coords[0].lng.toFixed(3)},${ctx.selection.coords[0].lat.toFixed(3)} to ${ctx.selection.coords[1].lng.toFixed(3)},${ctx.selection.coords[1].lat.toFixed(3)}`
      : 'unknown'
    parts.push(`- Search area: ${ctx.selection.type} (${boundsStr})`)
  }
  if (ctx.activeLayers.length > 0) {
    parts.push(`- Active layers: ${ctx.activeLayers.join(', ')}`)
  }

  if (Object.keys(ctx.analysisResults).length > 0) {
    parts.push('', '## Current Analysis Results')
    for (const [key, value] of Object.entries(ctx.analysisResults)) {
      const summary = summarizeResult(key, value)
      if (summary) parts.push(`### ${key}`, summary)
    }
  }

  if (Object.keys(ctx.tripParams).length > 0) {
    parts.push('', '## Trip Parameters')
    for (const [key, value] of Object.entries(ctx.tripParams)) {
      parts.push(`- ${key}: ${value}`)
    }
  }

  parts.push(
    '',
    '## Guidelines',
    '- Be concise and direct. SAR operations need fast, actionable answers.',
    '- When you need more data, call a tool rather than guessing.',
    '- If you are uncertain, say so explicitly. Do not fabricate data.',
    '- Prioritize safety-critical information (fall risk, flood risk, impassable terrain).',
    '- When suggesting search areas, consider terrain, weather, and the hiker profile.',
    '- You can analyze satellite images visually — call analyze_satellite_image when visual assessment would help.',
    '- When asked to assess the situation or suggest where to search, generate structured hypotheses.',
    '',
    '## Hypothesis Format',
    'When generating hypotheses, output a ```hypothesis JSON block at the end of your response:',
    '```hypothesis',
    '{',
    '  "hypotheses": [',
    '    {',
    '      "id": "hyp-1",',
    '      "title": "Short title",',
    '      "statement": "The missing person likely followed the trail east toward the river crossing.",',
    '      "confidence": 65,',
    '      "status": "active",',
    '      "evidence": [',
    '        { "source": "route analysis", "finding": "A* path follows trail east", "weight": "strong" },',
    '        { "source": "slope analysis", "finding": "Gentle slopes (<15°) to the east", "weight": "moderate" }',
    '      ],',
    '      "suggestedZones": [',
    '        {',
    '          "id": "zone-1",',
    '          "coords": [{ "lng": -119.5, "lat": 37.8 }, { "lng": -119.4, "lat": 37.8 }, { "lng": -119.4, "lat": 37.7 }, { "lng": -119.5, "lat": 37.7 }],',
    '          "label": "River crossing area",',
    '          "confidence": 70,',
    '          "reasons": ["Gentle terrain", "Water source within 500m", "Trail leads here", "Matches hiker profile"]',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
    'Use real coordinates from the current map context. Generate 2-4 hypotheses with different scenarios.',
    'Mark old hypotheses as "superseded" when new evidence changes the assessment.',
  )

  return parts.join('\n')
}

function summarizeResult(key: string, value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const v = value as Record<string, unknown>
  switch (key) {
    case 'zones':
      if (Array.isArray(v.zones)) {
        return `${v.zones.length} search zones computed with radii: ${(v.zones as any[]).map((z) => `${z.radius}m`).join(', ')}`
      }
      return ''
    case 'restPoints':
      if (Array.isArray(v.points)) {
        return `${v.points.length} rest points identified. Top score: ${(v.points as any[])[0]?.score?.toFixed(2) || 'N/A'}`
      }
      return ''
    case 'slope':
      if (Array.isArray(v.bands)) {
        return `${v.bands.length} slope bands classified.`
      }
      return ''
    case 'runoff':
      return `${Array.isArray(v.flowPaths) ? v.flowPaths.length : 0} flow paths, ${Array.isArray(v.poolingAreas) ? v.poolingAreas.length : 0} pooling areas, ${Array.isArray(v.floodRiskZones) ? v.floodRiskZones.length : 0} flood risk zones.`
    case 'route':
      if (v.primary) {
        return `Route: ${(v.primary as any).totalDistanceM?.toFixed(0)}m, est. ${(v.primary as any).estimatedHours?.toFixed(1)}h, max fall risk: ${(v.primary as any).maxFallRisk?.toFixed(2)}`
      }
      return ''
    case 'fallRisk':
      if (Array.isArray(v.zones)) {
        return `${v.zones.length} fall risk zones identified.`
      }
      return ''
    case 'anomaly':
      if (Array.isArray(v.zones)) {
        return `${v.zones.length} terrain anomalies detected.`
      }
      return ''
    default:
      return JSON.stringify(value).slice(0, 200)
  }
}
