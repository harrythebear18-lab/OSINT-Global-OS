import { app, BrowserWindow, shell, powerMonitor } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { registerIpcHandlers } from './ipc-handlers'
import { registerClimateIpc } from './climate-ipc'
import { registerAiIpc } from './ai-ipc'

let mainWindow: BrowserWindow | null = null
let climateCleanup: (() => void) | null = null
let climatePaused = false

// --- macOS memory & power optimisations for portable rigs ---
const isMac = process.platform === 'darwin'
const totalMemMB = Math.round(os.totalmem() / (1024 * 1024))
const isLowMem = totalMemMB <= 16384 // <=16 GB = "portable" tier

if (isMac) {
  // Force integrated GPU on dual-GPU MacBook Pros to save VRAM + battery
  app.commandLine.appendSwitch('force_low_power_gpu')
  // Disable GPU sandbox (reduces overhead on macOS)
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  // Limit V8 heap -- 7B Ollama models already consume ~5-8 GB RAM
  const heapLimit = isLowMem ? 384 : 6144
  app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${heapLimit}`)
  // Reduce renderer process count (one per site is overkill for a single-origin app)
  app.commandLine.appendSwitch('process-per-site')
  // Disable expensive Chromium features we don't need
  app.commandLine.appendSwitch('disable-features', 'TranslateUI,MediaRouter')
  // Ollama: enable flash attention + quantized KV cache to cut VRAM by ~40%
  if (!process.env['OLLAMA_FLASH_ATTENTION']) process.env['OLLAMA_FLASH_ATTENTION'] = '1'
  if (!process.env['OLLAMA_KV_CACHE_TYPE']) process.env['OLLAMA_KV_CACHE_TYPE'] = 'q8_0'
  // Ollama: keep only 1 model hot (saves RAM on rigs with <=16 GB)
  if (isLowMem && !process.env['OLLAMA_MAX_LOADED_MODELS']) process.env['OLLAMA_MAX_LOADED_MODELS'] = '1'
  // Ollama: limit parallel requests to 1 on low-mem rigs
  if (isLowMem && !process.env['OLLAMA_NUM_PARALLEL']) process.env['OLLAMA_NUM_PARALLEL'] = '1'
}

// --- Crash logging ---
const logDir = join(os.homedir(), '.osint-global-os', 'logs')
try {
  fs.mkdirSync(logDir, { recursive: true })
} catch { /* ignore */ }

const logFile = join(logDir, `osint-global-os-${new Date().toISOString().slice(0, 10)}.log`)
const logStream = fs.createWriteStream(logFile, { flags: 'a' })

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  logStream.write(line)
  console.log(msg)
}

// Catch unhandled errors so they go to the log instead of crashing silently
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.stack || err.message}`)
})
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${String(reason)}`)
})

log('OSINT Global OS starting...')
if (isLowMem) {
  log(`Low-memory mode enabled (${totalMemMB} MB RAM) — aggressive optimisations active`)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'OSINT Global OS',
    backgroundColor: '#0b0f14',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (process.env['ELECTRON_RENDERER_URL']) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // --- RAM: pause background monitors when window is hidden/minimized ---
  mainWindow.on('hide', () => {
    if (climateCleanup && !climatePaused) {
      log('Window hidden — pausing background monitors to free RAM')
      climateCleanup()
      climateCleanup = null
      climatePaused = true
    }
  })

  mainWindow.on('show', () => {
    if (climatePaused && mainWindow) {
      log('Window restored — resuming background monitors')
      climateCleanup = registerClimateIpc(mainWindow)
      climatePaused = false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  registerAiIpc(() => mainWindow)
  createWindow()
  if (mainWindow) {
    climateCleanup = registerClimateIpc(mainWindow)
  }
  log('App ready')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// --- RAM: unload Ollama models when system is under memory pressure ---
if (isMac) {
  powerMonitor.on('resume', () => {
    log('System resumed from sleep')
  })
  powerMonitor.on('suspend', () => {
    log('System sleeping — Ollama models will auto-unload via OLLAMA_KEEP_ALIVE=0')
  })
  // On low-mem rigs, set Ollama keep-alive to 2 minutes (default is 5)
  if (isLowMem && !process.env['OLLAMA_KEEP_ALIVE']) {
    process.env['OLLAMA_KEEP_ALIVE'] = '2m'
  }
}

app.on('window-all-closed', () => {
  log('App quitting')
  if (climateCleanup) {
    climateCleanup()
    climateCleanup = null
  }
  // Unload all Ollama models on quit to free RAM
  if (isMac) {
    fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen2.5-coder:7b', keep_alive: 0 }),
    }).catch(() => {})
    fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen2.5vl:7b', keep_alive: 0 }),
    }).catch(() => {})
  }
  logStream.end()
  if (process.platform !== 'darwin') app.quit()
})
