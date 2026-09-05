/**
 * AI IPC Handlers — wires Ollama + CLIP services to the renderer.
 *
 * Channels:
 *  - AI_HEALTH: check if Ollama is running + list models
 *  - AI_CHAT: non-streaming chat completion
 *  - AI_CHAT_STREAM: streaming chat (pushes tokens to renderer)
 *  - AI_VISION: send image + prompt to Qwen-VL
 *  - AI_EMBED: text embeddings via Ollama
 *  - AI_CLIP_HEALTH: check CLIP server
 *  - AI_CLIP_EMBED_TEXT / IMAGE: CLIP embeddings
 *  - AI_CLIP_SIMILARITY: cosine similarity
 *  - AI_CLIP_SEARCH: text-to-image search
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import {
  checkHealth,
  chat,
  vision,
  embed,
  SAR_TOOLS,
  buildSystemPrompt,
  type ChatMessage,
  type ToolDefinition,
  type MapContext,
} from './services/ollama-service'
import {
  checkClipHealth,
  embedText as clipEmbedText,
  embedImage as clipEmbedImage,
  similarity as clipSimilarity,
  searchByText as clipSearchByText,
} from './services/clip-service'

function sendToRenderer(win: BrowserWindow | null, channel: string, data: unknown) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

export function registerAiIpc(getMainWindow: () => BrowserWindow | null): void {
  // --- Ollama health ---
  ipcMain.handle(IPC.AI_HEALTH, async () => {
    return await checkHealth()
  })

  // --- Chat (non-streaming) ---
  ipcMain.handle(IPC.AI_CHAT, async (_e, req: {
    messages: ChatMessage[]
    model?: string
    tools?: ToolDefinition[]
    context?: MapContext
    temperature?: number
  }) => {
    const messages = [...req.messages]
    // If context is provided, prepend a system prompt
    if (req.context) {
      const sysPrompt = buildSystemPrompt(req.context)
      messages.unshift({ role: 'system', content: sysPrompt })
    }
    const result = await chat({
      messages,
      model: req.model,
      tools: req.tools || SAR_TOOLS,
      stream: false,
      temperature: req.temperature,
    })
    return result
  })

  // --- Chat (streaming) ---
  ipcMain.handle(IPC.AI_CHAT_STREAM, async (e, req: {
    messages: ChatMessage[]
    model?: string
    tools?: ToolDefinition[]
    context?: MapContext
    temperature?: number
  }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const messages = [...req.messages]
    if (req.context) {
      const sysPrompt = buildSystemPrompt(req.context)
      messages.unshift({ role: 'system', content: sysPrompt })
    }
    const result = await chat({
      messages,
      model: req.model,
      tools: req.tools || SAR_TOOLS,
      stream: true,
      temperature: req.temperature,
      onToken: (token) => {
        sendToRenderer(win, 'ai:chat:token', { token })
      },
    })
    return result
  })

  // --- Vision (Qwen-VL) ---
  ipcMain.handle(IPC.AI_VISION, async (_e, req: {
    imageBase64: string
    prompt: string
    model?: string
  }) => {
    const result = await vision(req.imageBase64, req.prompt, req.model)
    return { content: result }
  })

  // --- Embeddings (Ollama) ---
  ipcMain.handle(IPC.AI_EMBED, async (_e, req: { text: string; model?: string }) => {
    return await embed(req.text, req.model)
  })

  // --- CLIP health ---
  ipcMain.handle(IPC.AI_CLIP_HEALTH, async () => {
    return await checkClipHealth()
  })

  // --- CLIP text embedding ---
  ipcMain.handle(IPC.AI_CLIP_EMBED_TEXT, async (_e, req: { text: string }) => {
    return await clipEmbedText(req.text)
  })

  // --- CLIP image embedding ---
  ipcMain.handle(IPC.AI_CLIP_EMBED_IMAGE, async (_e, req: { imagePath: string }) => {
    return await clipEmbedImage(req.imagePath)
  })

  // --- CLIP similarity ---
  ipcMain.handle(IPC.AI_CLIP_SIMILARITY, async (_e, req: { a: number[]; b: number[] }) => {
    return await clipSimilarity(req.a, req.b)
  })

  // --- CLIP text-to-image search ---
  ipcMain.handle(IPC.AI_CLIP_SEARCH, async (_e, req: {
    query: string
    candidates: { id: string; path: string }[]
  }) => {
    return await clipSearchByText(req.query, req.candidates)
  })
}
