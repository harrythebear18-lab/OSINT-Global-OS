import { useState, useRef, useEffect, useCallback } from 'react'
import { useMap } from '../hooks/useMap'
import type { LngLat, TripParams } from '@shared/types'

interface AIChatPanelProps {
  tripParams: TripParams
  /** Current analysis results for context injection */
  analysisResults: Record<string, unknown>
  activeLayers: string[]
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

/**
 * AI Chat Panel — embedded LLM analyst.
 *
 * Connects to local Ollama (qwen2.5-coder for reasoning, qwen2.5vl for vision).
 * Injects current map state + analysis results as context.
 * Supports tool calling (LLM can request analysis modules to run).
 * Streaming responses for low-latency UX.
 */
export function AIChatPanel({ tripParams, analysisResults, activeLayers }: AIChatPanelProps) {
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
    }
  }, [map, selection, lkp, endPoint, activeLayers, analysisResults, tripParams])

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

      // If there are tool calls, surface them for user approval
      if (result.toolCalls && result.toolCalls.length > 0) {
        setPendingToolCalls(result.toolCalls.map((tc: any) => ({
          name: tc.function?.name || 'unknown',
          args: tc.function?.arguments || {},
        })))
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

  const approveToolCall = (idx: number) => {
    if (!pendingToolCalls) return
    const tc = pendingToolCalls[idx]
    // Dispatch a window event that AnalysisPanel or other components can listen for
    window.dispatchEvent(new CustomEvent('ai:tool-call', { detail: tc }))
    // Remove from pending
    setPendingToolCalls(pendingToolCalls.filter((_, i) => i !== idx))
    // Add a message noting the tool was called
    setMessages((prev) => [...prev, {
      role: 'assistant',
      content: `[Tool called: ${tc.name} — dispatching to analysis module...]`,
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
