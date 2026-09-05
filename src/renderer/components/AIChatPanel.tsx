import { useState, useRef, useEffect, useCallback } from 'react'
import { useMap } from '../hooks/useMap'
import type { LngLat, TripParams, AnalysisMode } from '@shared/types'

interface AIChatPanelProps {
  tripParams: TripParams
  /** Current analysis results for context injection */
  analysisResults: Record<string, unknown>
  activeLayers: string[]
  /** Analysis mode — changes AI reasoning style + tool behavior */
  mode: AnalysisMode
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: { name: string; args: Record<string, unknown> }[]
  pending?: boolean
}

interface OllamaModel {
  name: string
  capabilities: string[]
}

// Known tool names that the LLM can call
const KNOWN_TOOLS = [
  'web_search', 'analyze_satellite_image', 'generate_hypotheses',
  'run_slope_analysis', 'run_search_zones', 'run_rest_points',
  'run_route', 'run_fall_risk', 'run_runoff', 'run_anomaly',
  'run_canopy_analysis', 'sentinel_search',
  'get_map_context',
]

/**
 * Parse tool calls embedded as JSON text in the LLM response.
 * Ollama often streams tool calls as: {"name": "web_search", "arguments": {...}}
 * or wrapped in ```json blocks.
 */
function parseToolCallsFromText(content: string): { name: string; args: any }[] {
  const calls: { name: string; args: any }[] = []

  // Pattern 1: ```json\n{"name": "...", "arguments": {...}}\n```
  const jsonBlockRe = /```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/g
  let match: RegExpExecArray | null
  while ((match = jsonBlockRe.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed.name && typeof parsed.name === 'string' && KNOWN_TOOLS.includes(parsed.name)) {
        calls.push({ name: parsed.name, args: parsed.arguments || parsed.args || parsed.parameters || {} })
      }
    } catch { /* not valid JSON, skip */ }
  }

  // Pattern 2: bare {"name": "...", "arguments": {...}} in text
  const bareJsonRe = /\{"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\}/g
  while ((match = bareJsonRe.exec(content)) !== null) {
    const toolName = match[1]
    if (KNOWN_TOOLS.includes(toolName)) {
      try {
        const args = JSON.parse(match[2])
        // Avoid duplicates already found via json block
        if (!calls.some((c) => c.name === toolName && JSON.stringify(c.args) === JSON.stringify(args))) {
          calls.push({ name: toolName, args })
        }
      } catch { /* skip */ }
    }
  }

  // Pattern 3: Ollama native format: {"name": "...", "arguments": {...}} without code block
  // (already covered by pattern 2, but also check for function wrapper)
  const funcRe = /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/g
  while ((match = funcRe.exec(content)) !== null) {
    const toolName = match[1]
    if (KNOWN_TOOLS.includes(toolName)) {
      try {
        const args = JSON.parse(match[2])
        if (!calls.some((c) => c.name === toolName && JSON.stringify(c.args) === JSON.stringify(args))) {
          calls.push({ name: toolName, args })
        }
      } catch { /* skip */ }
    }
  }

  return calls
}

/**
 * AI Chat Panel — embedded LLM analyst.
 *
 * Connects to local Ollama (qwen2.5-coder for reasoning, qwen2.5vl for vision).
 * Injects current map state + analysis results as context.
 * Supports tool calling (LLM can request analysis modules to run).
 * Streaming responses for low-latency UX.
 */
export function AIChatPanel({ tripParams, analysisResults, activeLayers, mode }: AIChatPanelProps) {
  const { map, selection, lkp, endPoint } = useMap()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [clipStatus, setClipStatus] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [models, setModels] = useState<OllamaModel[]>([])
  const [selectedModel, setSelectedModel] = useState('qwen2.5-coder:7b')
  const [pendingToolCalls, setPendingToolCalls] = useState<{ name: string; args: Record<string, unknown> }[] | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cleanupTokenRef = useRef<(() => void) | null>(null)

  // Check Ollama + CLIP health on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await window.ai.health()
        if (res?.running) {
          setOllamaStatus('online')
          setModels(res.models || [])
        } else {
          setOllamaStatus('offline')
        }
      } catch {
        setOllamaStatus('offline')
      }
      try {
        const clip = await window.ai.clipHealth()
        setClipStatus(clip?.running ? 'online' : 'offline')
      } catch {
        setClipStatus('offline')
      }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Cleanup token listener on unmount
  useEffect(() => {
    return () => {
      cleanupTokenRef.current?.()
    }
  }, [])

  const buildContext = useCallback(() => {
    const center = map?.getCenter()
    const zoom = map?.getZoom() ?? 0
    return {
      center: center ? { lng: center.lng, lat: center.lat } : { lng: 0, lat: 0 },
      zoom,
      selection: selection ? { type: selection.type, coords: selection.coords } : null,
      lkp,
      endPoint,
      activeLayers,
      analysisResults,
      tripParams: tripParams as unknown as Record<string, unknown>,
      mode,
    }
  }, [map, selection, lkp, endPoint, activeLayers, analysisResults, tripParams, mode])

  const send = async () => {
    if (!input.trim() || streaming || ollamaStatus !== 'online') return
    const userMsg: ChatMessage = { role: 'user', content: input.trim() }
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', pending: true }
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)

    // Set up streaming token listener
    cleanupTokenRef.current?.()
    cleanupTokenRef.current = window.ai.onChatToken(({ token }) => {
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: last.content + token, pending: false }
        }
        return updated
      })
    })

    try {
      const chatMessages = [
        ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: userMsg.content },
      ]

      const result = await window.ai.chatStream({
        messages: chatMessages,
        model: selectedModel,
        context: buildContext(),
      })

      // Update final message with complete content + tool calls
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: result.content || last.content,
            pending: false,
            toolCalls: result.toolCalls?.map((tc: any) => ({
              name: tc.function?.name || 'unknown',
              args: tc.function?.arguments || {},
            })),
          }
        }
        return updated
      })

      // Dispatch response event for hypothesis parsing
      if (result.content) {
        window.dispatchEvent(new CustomEvent('ai:response', { detail: { content: result.content } }))
      }

      // Collect tool calls from both structured field AND text content
      const detectedToolCalls: { name: string; args: any }[] = []

      // 1. Structured tool calls from Ollama
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          detectedToolCalls.push({
            name: tc.function?.name || 'unknown',
            args: tc.function?.arguments || {},
          })
        }
      }

      // 2. Tool calls embedded as JSON text in the content
      //    Ollama often streams tool calls as: {"name": "web_search", "arguments": {...}}
      if (result.content) {
        const textToolCalls = parseToolCallsFromText(result.content)
        detectedToolCalls.push(...textToolCalls)
      }

      // Surface all detected tool calls for user approval
      if (detectedToolCalls.length > 0) {
        setPendingToolCalls(detectedToolCalls)
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            pending: false,
          }
        }
        return updated
      })
    } finally {
      setStreaming(false)
      cleanupTokenRef.current?.()
      cleanupTokenRef.current = null
    }
  }

  const clearChat = () => {
    setMessages([])
    setPendingToolCalls(null)
  }

  const approveToolCall = async (idx: number) => {
    if (!pendingToolCalls) return
    const tc = pendingToolCalls[idx]
    setPendingToolCalls(pendingToolCalls.filter((_, i) => i !== idx))

    // Handle web_search directly — fetch results and feed back to LLM
    if (tc.name === 'web_search') {
      const query = (tc.args as any).query || ''
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `[Searching web: "${query}"...]`,
      }])

      try {
        const center = map?.getCenter()
        const location = center ? { lng: center.lng, lat: center.lat } : undefined
        const result = await window.ai.webSearch({ query, location, mode })

        if (result?.context) {
          // Feed results back to LLM as a follow-up
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: `**Web search results for "${query}":**\n\n${result.context}`,
          }])

          // Ask LLM to synthesize the results
          const followUp = await window.ai.chatStream({
            messages: [
              ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
              { role: 'user' as const, content: `I searched the web for "${query}". Here are the results:\n\n${result.context}\n\nBased on these results and the current map context, what are the key findings relevant to the SAR situation?` },
            ],
            model: selectedModel,
            context: buildContext(),
          })

          if (followUp.content) {
            setMessages((prev) => [...prev, {
              role: 'assistant',
              content: followUp.content,
            }])
          }
        } else {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: `[No web results found for "${query}"]`,
          }])
        }
      } catch (err) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `[Web search failed: ${err instanceof Error ? err.message : String(err)}]`,
        }])
      }
      return
    }

    // Handle analyze_satellite_image — capture map screenshot and send to Qwen-VL
    if (tc.name === 'analyze_satellite_image') {
      // Mode-aware default prompt
      const defaultPrompt = mode === 'active-sar'
        ? 'Analyze this satellite image for hazards, structures, shelters, and any safety-relevant features.'
        : 'Analyze this satellite image for terrain anomalies, patterns, vegetation changes, and any features relevant to a historical investigation.'
      const query = (tc.args as any).query || defaultPrompt
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `[Capturing map view for visual analysis...]`,
      }])

      try {
        const canvas = map?.getCanvas()
        if (!canvas) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: '[Vision analysis failed: map canvas not available]',
          }])
          return
        }

        const dataUrl = canvas.toDataURL('image/png')
        const base64 = dataUrl.split(',')[1]
        const result = await window.ai.vision({ imageBase64: base64, prompt: query })

        if (result?.content) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: `**Satellite image analysis:**\n\n${result.content}`,
          }])
          // Feed vision result back to LLM for interpretation
          const followUp = await window.ai.chatStream({
            messages: [
              ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
              { role: 'user' as const, content: `I analyzed the current satellite view. Vision model output:\n\n${result.content}\n\nBased on this visual analysis and the map context, what are the key findings?` },
            ],
            model: selectedModel,
            context: buildContext(),
          })
          if (followUp.content) {
            setMessages((prev) => [...prev, {
              role: 'assistant',
              content: followUp.content,
            }])
            window.dispatchEvent(new CustomEvent('ai:response', { detail: { content: followUp.content } }))
          }
        } else {
          // Vision model returned empty — likely Qwen-VL not running
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: '[Vision analysis returned no result. Is Qwen-VL running in Ollama? Try `ollama run qwen2-vl` in a terminal.]',
          }])
          // Still feed back to LLM so it can continue reasoning
          const followUp = await window.ai.chatStream({
            messages: [
              ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
              { role: 'user' as const, content: `I attempted satellite image analysis but the vision model (Qwen-VL) returned no result. It may not be running. Continue your analysis using the available terrain data and map context instead.` },
            ],
            model: selectedModel,
            context: buildContext(),
          })
          if (followUp.content) {
            setMessages((prev) => [...prev, {
              role: 'assistant',
              content: followUp.content,
            }])
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `[Vision analysis failed: ${errMsg}]`,
        }])
        // Feed the failure back so the LLM can continue instead of getting stuck
        const followUp = await window.ai.chatStream({
          messages: [
            ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
            { role: 'user' as const, content: `Satellite image analysis failed with error: ${errMsg}. Continue your analysis using available terrain data and map context instead.` },
          ],
          model: selectedModel,
          context: buildContext(),
        })
        if (followUp.content) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: followUp.content,
          }])
        }
      }
      return
    }

    // Handle get_map_context — return current map state to the LLM
    if (tc.name === 'get_map_context') {
      const ctx = buildContext()
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `**Current map context:**\n\n${ctx}`,
      }])
      // Feed context back to LLM so it can reason about it
      const followUp = await window.ai.chatStream({
        messages: [
          ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: `Here is the current map context:\n\n${ctx}\n\nBased on this context, what would you recommend doing next?` },
        ],
        model: selectedModel,
        context: buildContext(),
      })
      if (followUp.content) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: followUp.content,
        }])
        window.dispatchEvent(new CustomEvent('ai:response', { detail: { content: followUp.content } }))
      }
      return
    }

    // Handle generate_hypotheses — the LLM should output hypothesis JSON directly,
    // but if it calls the tool, just prompt it to do so
    if (tc.name === 'generate_hypotheses') {
      // Active SAR: 2-3 tight, high-confidence hypotheses
      // Legacy: 4-6 wide, exploratory hypotheses
      const count = (tc.args as any).count || (mode === 'active-sar' ? 3 : 5)
      const styleHint = mode === 'active-sar'
        ? 'Generate TIGHT hypotheses with small zones (under 1km) and HIGH confidence. Be evidence-driven and conservative.'
        : 'Generate EXPLORATORY hypotheses with WIDE zones (1-5km) and alternative theories. Speculation is allowed. Consider that the person may not be alive or moving.'
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `[Generating ${count} hypotheses (${mode} mode)...]`,
      }])
      try {
        const followUp = await window.ai.chatStream({
          messages: [
            ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
            { role: 'user' as const, content: `Based on the current map context and analysis results, generate ${count} structured hypotheses for where the missing person might be. ${styleHint} Output each hypothesis as a \`\`\`hypothesis JSON block with id, title, statement, confidence (0-100), status, evidence array, and suggestedZones array with real coordinates from the current map.` },
          ],
          model: selectedModel,
          context: buildContext(),
        })
        if (followUp.content) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: followUp.content,
          }])
          window.dispatchEvent(new CustomEvent('ai:response', { detail: { content: followUp.content } }))
        }
      } catch (err) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `[Hypothesis generation failed: ${err instanceof Error ? err.message : String(err)}]`,
        }])
      }
      return
    }

    // Handle analysis tools — call the terrain IPC directly
    const getBounds = (): [LngLat, LngLat] => {
      if (!selection || selection.type !== 'bbox' || selection.coords.length < 2)
        throw new Error('No bounding box selected. Draw a bbox on the map first.')
      return [selection.coords[0], selection.coords[1]]
    }

    const analysisTools: Record<string, () => Promise<string>> = {
      run_slope_analysis: async () => {
        const bounds = getBounds()
        const profile = (tc.args as any).activity_profile || 'hiking'
        const res = await window.terrain.slopeAnalysis({ bounds, profile })
        const bands = res.bands || []
        const summary = bands.map((b: any) => `${b.class} (${b.slopeDeg?.toFixed(0) ?? '?'}deg): ${b.coords?.length || 0} pts`).join(', ')
        return `Slope analysis complete. ${bands.length} bands: ${summary}`
      },
      run_search_zones: async () => {
        if (!lkp) throw new Error('No Last Known Point set. Right-click on the map to place LKP.')
        const radii = (tc.args as any).radii || [500, 1000, 3000, 5000]
        const searchBounds = selection && selection.type === 'bbox' && selection.coords.length >= 2
          ? [selection.coords[0], selection.coords[1]] as [LngLat, LngLat]
          : undefined
        const res = await window.terrain.searchZones({ lkp, radii, tripParams, bounds: searchBounds, mode })
        const zones = res.zones || []
        const summary = zones.map((z: any) => `Ring ${z.radius}m: ${z.areas?.length || 0} areas`).join(', ')
        return `Search zones computed from LKP. ${zones.length} rings: ${summary}`
      },
      run_rest_points: async () => {
        if (!lkp) throw new Error('No Last Known Point set. Right-click on the map to place LKP.')
        const maxHours = (tc.args as any).max_hours || tripParams.hoursSinceLastSeen
        const bnds = selection && selection.type === 'bbox' && selection.coords.length >= 2
          ? [selection.coords[0], selection.coords[1]] as [LngLat, LngLat]
          : undefined
        const res = await window.terrain.restPoints({ lkp, maxHours, tripParams, bounds: bnds, mode })
        const pts = res.points || []
        return `Rest points analysis complete. Found ${pts.length} likely rest locations within the search area.`
      },
      run_route: async () => {
        if (!lkp || !endPoint) throw new Error('Need both LKP (right-click) and endpoint (shift-click) to plan a route.')
        const bounds = getBounds()
        const preference = (tc.args as any).preference || 'least-effort'
        const res = await window.terrain.routePlan({ start: lkp, end: endPoint, bounds, routePreference: preference, tripParams, mode })
        const dist = res.primary?.totalDistanceM ?? 0
        const time = res.primary?.estimatedHours ?? 0
        return `Route planned. Distance: ${dist.toFixed(0)}m, estimated time: ${time.toFixed(1)}h`
      },
      run_fall_risk: async () => {
        const bounds = getBounds()
        const res = await window.terrain.fallRisk({ bounds, tripParams, mode })
        const zones = res.zones || []
        return `Fall risk analysis complete. ${zones.length} risk zones identified.`
      },
      run_runoff: async () => {
        const bounds = getBounds()
        const rainfall = (tc.args as any).rainfall_mm || 25
        const res = await window.terrain.runoffAnalysis({ bounds, rainfallMm: rainfall, mode })
        return `Runoff analysis complete with ${rainfall}mm rainfall. ${res.flowPaths?.length || 0} flow paths, ${res.poolingAreas?.length || 0} pooling areas, ${res.floodRiskZones?.length || 0} flood risk zones.`
      },
      run_anomaly: async () => {
        const bounds = getBounds()
        const res = await window.terrain.anomalyAnalysis({ bounds, mode })
        const zones = res.zones || []
        return `Anomaly detection complete. ${zones.length} terrain anomalies found.`
      },
      run_canopy_analysis: async () => {
        const bounds = getBounds()
        const res = await window.terrain.canopyAnalysis({ bounds, mode })
        const zones = res.zones || []
        const defol = zones.filter((z: any) => z.type === 'defoliation').length
        const dead = zones.filter((z: any) => z.type === 'dead-trees').length
        const clearing = zones.filter((z: any) => z.type === 'clearing').length
        return `Canopy intelligence complete. Region: ${res.regionName}. Biome: ${res.biomeDescription}. Canopy height: ${res.regionalCanopyHeightM}m (${res.canopyHeightSource}). Found ${zones.length} zones: ${defol} defoliation, ${dead} dead tree clusters, ${clearing} clearings. Ground height correction applied (DEM minus canopy estimate).`
      },
      sentinel_search: async () => {
        const bounds = getBounds()
        const res = await window.terrain.sentinelSearch({ bounds, layerId: 'modis-true-color' })
        const layers = res.layers || []
        const best = res.best
        return `Satellite imagery available: ${layers.length} layers. Best match: ${best?.id || 'none'} (${best?.date || 'n/a'}). Use this for visual context and terrain interpretation.`
      },
    }

    if (analysisTools[tc.name]) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `[Running ${tc.name}...]`,
      }])
      try {
        const summary = await analysisTools[tc.name]()
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `**${tc.name} result:** ${summary}`,
        }])
        // Feed result back to LLM for interpretation
        const followUp = await window.ai.chatStream({
          messages: [
            ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
            { role: 'user' as const, content: `I ran ${tc.name}. Result: ${summary}\n\nInterpret this result in the context of the SAR situation.` },
          ],
          model: selectedModel,
          context: buildContext(),
        })
        if (followUp.content) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: followUp.content,
          }])
          window.dispatchEvent(new CustomEvent('ai:response', { detail: { content: followUp.content } }))
        }
      } catch (err) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `[${tc.name} failed: ${err instanceof Error ? err.message : String(err)}]`,
        }])
      }
      return
    }

    // Unknown tool — log it
    setMessages((prev) => [...prev, {
      role: 'assistant',
      content: `[Unknown tool: ${tc.name} — no handler available]`,
    }])
  }

  const rejectToolCall = (idx: number) => {
    if (!pendingToolCalls) return
    setPendingToolCalls(pendingToolCalls.filter((_, i) => i !== idx))
  }

  return (
    <section className="ai-chat-panel">
      <div className="ai-chat-header">
        <h3>AI Analyst</h3>
        <div className="ai-status-row">
          <span className={`ai-status-dot ${ollamaStatus}`} title={`Ollama: ${ollamaStatus}`}>
            Ollama {ollamaStatus}
          </span>
          <span className={`ai-status-dot ${clipStatus}`} title={`CLIP: ${clipStatus}`}>
            CLIP {clipStatus}
          </span>
        </div>
        {models.length > 0 && (
          <select
            className="ai-model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            title="Select LLM model"
          >
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        )}
      </div>

      {ollamaStatus === 'offline' && (
        <div className="ai-offline-notice">
          <p>Ollama is not running. Start it with:</p>
          <code>ollama serve</code>
          <p>Then ensure models are pulled:</p>
          <code>ollama pull qwen2.5-coder:7b</code>
          <code>ollama pull qwen2.5vl:7b</code>
        </div>
      )}

      <div className="ai-chat-messages" ref={scrollRef}>
        {messages.length === 0 && ollamaStatus === 'online' && (
          <div className="ai-chat-empty">
            <p>Ask me anything about the current map, analysis results, or SAR situation.</p>
            <p className="muted">Examples:</p>
            <ul>
              <li>"Summarize the terrain in the search area"</li>
              <li>"Where should we prioritize search teams?"</li>
              <li>"What are the main hazards in this route?"</li>
              <li>"Analyze the satellite image for structures"</li>
            </ul>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
            <div className="ai-msg-role">
              {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Analyst' : 'System'}
            </div>
            <div className="ai-msg-content">
              {msg.content || (msg.pending ? '...' : '')}
            </div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="ai-tool-calls">
                <div className="muted">Tool calls:</div>
                {msg.toolCalls.map((tc, j) => (
                  <div key={j} className="ai-tool-call">
                    {tc.name}({JSON.stringify(tc.args)})
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pending tool call approval */}
      {pendingToolCalls && pendingToolCalls.length > 0 && (
        <div className="ai-tool-approval">
          <div className="muted">Tool call requests — approve to run:</div>
          {pendingToolCalls.map((tc, i) => (
            <div key={i} className="ai-tool-approval-item">
              <span>{tc.name}({JSON.stringify(tc.args)})</span>
              <button className="ai-approve-btn" onClick={() => approveToolCall(i)}>Approve</button>
              <button className="ai-reject-btn" onClick={() => rejectToolCall(i)}>Reject</button>
            </div>
          ))}
        </div>
      )}

      <div className="ai-chat-input-row">
        <textarea
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Ask the analyst..."
          rows={2}
          disabled={streaming || ollamaStatus !== 'online'}
        />
        <button
          className="ai-send-btn"
          onClick={send}
          disabled={!input.trim() || streaming || ollamaStatus !== 'online'}
        >
          {streaming ? '...' : 'Send'}
        </button>
        {messages.length > 0 && (
          <button className="ai-clear-btn" onClick={clearChat} title="Clear chat">
            Clear
          </button>
        )}
      </div>
    </section>
  )
}
