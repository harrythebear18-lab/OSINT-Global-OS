import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { registerIpcHandlers } from './ipc-handlers'
import { registerClimateIpc } from './climate-ipc'
import { registerAiIpc } from './ai-ipc'

let mainWindow: BrowserWindow | null = null
let climateCleanup: (() => void) | null = null

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
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (process.env['ELECTRON_RENDERER_URL']) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
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

app.on('window-all-closed', () => {
  log('App quitting')
  if (climateCleanup) {
    climateCleanup()
    climateCleanup = null
  }
  logStream.end()
  if (process.platform !== 'darwin') app.quit()
})
