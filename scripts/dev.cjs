// Launch script — removes ELECTRON_RUN_AS_NODE from env then runs electron-vite dev.
// This is needed because the dev environment has ELECTRON_RUN_AS_NODE=1 set globally,
// which forces Electron to run as plain Node.js (breaking require('electron')).
const { spawn } = require('child_process')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  env,
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 0))
