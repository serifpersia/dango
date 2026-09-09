#!/usr/bin/env node
const { spawn, execSync } = require('child_process')
const readline = require('readline')
const http = require('http')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const axios = require('axios')

const shutdownToken = crypto.randomBytes(32).toString('hex')
const mode = process.argv[2] || 'prod'
const isWin = os.platform() === 'win32'
const npmCmd = isWin ? 'npm.cmd' : 'npm'

const colors = {
  reset: '\x1b[0m',
  server: '\x1b[36m',
  client: '\x1b[32m',
  system: '\x1b[33m',
}

if (mode === '--version' || mode === '-v') {
  const pkg = require('./package.json')
  console.log(`dango version ${pkg.version}`)
  process.exit(0)
}

if (mode === '--help' || mode === '-h') {
  console.log('Usage: dango [dev|prod] [--no-update] [--version] [--help]')
  console.log('  dev          Run with hot-reload (server + client)')
  console.log('  prod         Run pre-built version (default)')
  console.log('  --no-update  Skip update checks')
  console.log('  --version, -v  Print version and exit')
  console.log('  --help, -h     Show this help and exit')
  process.exit(0)
}

async function checkForUpdates() {
  if (process.argv.includes('--no-update') || mode === 'dev') return

  try {
    const npmGlobalPrefix = execSync(`${npmCmd} config get prefix`, {
      encoding: 'utf8',
    }).trim()
    const scriptPath = path.resolve(__dirname)
    const isGlobalInstall = scriptPath.includes(npmGlobalPrefix)

    const pkg = require('./package.json')
    const current = pkg.version

    if (isGlobalInstall) {
      const { data } = await axios.get('https://registry.npmjs.org/@serifpersia/dango/latest', {
        timeout: 3000,
        headers: { 'User-Agent': 'dango-cli' },
      })
      const latest = data.version

      if (current !== latest) {
        console.log(
          `\n${colors.system}[Update]${colors.reset} ` +
            `New version ${colors.client}${latest}${colors.reset} available (current: ${current})`
        )

        if (process.stdin.isTTY) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
          const answer = await new Promise((resolve) => {
            rl.question(
              `${colors.system}[Update]${colors.reset} Would you like to perform a clean install now? (y/N) `,
              (ans) => {
                rl.close()
                resolve(ans.toLowerCase())
              }
            )
          })

          if (answer === 'y' || answer === 'yes') {
            console.log(`${colors.system}[Update]${colors.reset} Updating dango...`)
            try {
              execSync(`${npmCmd} install -g @serifpersia/dango@latest`, {
                stdio: 'inherit',
              })
              console.log(
                `\n${colors.system}[Update]${colors.reset} Update successful! Please restart dango to apply changes.`
              )
              process.exit(0)
            } catch (err) {
              console.error(
                `\n${colors.system}[Update]${colors.reset} Update failed: ${err.message}`
              )
              if (!isWin) {
                console.log(
                  `${colors.system}[Update]${colors.reset} Hint: If you encounter EACCES permission errors, configure npm global directory without root:`
                )
                console.log(
                  `${colors.system}[Update]${colors.reset} ${colors.client}npm config set prefix ~/.npm-global${colors.reset}\n`
                )
              }
              console.log(
                `${colors.system}[Update]${colors.reset} Continuing with current version...\n`
              )
            }
          } else {
            console.log(
              `${colors.system}[Update]${colors.reset} Continuing with version ${current}...\n`
            )
          }
          if (process.stdin.isTTY) process.stdin.resume()
        } else {
          console.log(
            `${colors.system}[Update]${colors.reset} Run: npm install -g @serifpersia/dango to update.\n`
          )
        }
      }
    } else {
      const { data } = await axios.get(
        'https://api.github.com/repos/serifpersia/dango/releases/latest',
        { timeout: 3000, headers: { 'User-Agent': 'dango-cli' } }
      )
      const remoteVersion = (data.name && data.name.match(/v(\d+\.\d+\.\d+)/)?.[1]) || null
      if (remoteVersion) {
        if (remoteVersion !== current) {
          console.log(`\n${colors.system}====================================================`)
          console.log(
            `${colors.system}[Update Available]${colors.reset} New version ${remoteVersion} found (current: ${current})!`
          )
          console.log(
            `Please download the latest release: ${colors.client}${data.html_url}${colors.reset}`
          )
          console.log(`Replace your current files with the new ones from the zip.`)
          console.log(
            `${colors.system}====================================================\n${colors.reset}`
          )
        }
        return
      }
      if (!pkg.versionDate) return

      const latestDate = new Date(data.published_at)
      const pkgDate = new Date(pkg.versionDate)

      if (latestDate > pkgDate) {
        console.log(`\n${colors.system}====================================================`)
        console.log(`${colors.system}[Update Available]${colors.reset} New version found!`)
        console.log(
          `Please download the latest release: ${colors.client}${data.html_url}${colors.reset}`
        )
        console.log(`Replace your current files with the new ones from the zip.`)
        console.log(
          `${colors.system}====================================================\n${colors.reset}`
        )
      }
    }
  } catch (error) {
    // Silently ignore network/registry errors
  }
}

const SERVER_DIR = path.join(__dirname, 'server')
const CLIENT_DIR = path.join(__dirname, 'client')

let syncSpinner = null
let syncMessage = ''
let syncDots = 0

const startSpinner = (msg) => {
  stopSpinner()
  syncMessage = msg
  syncDots = 0
  process.stdout.write(`${colors.system}[System]${colors.reset} ${msg}`)
  syncSpinner = setInterval(() => {
    syncDots = (syncDots + 1) % 4
    process.stdout.write(
      `\r${colors.system}[System]${colors.reset} ${msg}${'.'.repeat(syncDots)}${' '.repeat(3 - syncDots)}`
    )
  }, 400)
}

const stopSpinner = () => {
  if (syncSpinner) {
    clearInterval(syncSpinner)
    syncSpinner = null
    process.stdout.write('\n')
  }
}

const log = (prefix, color, data) => {
  const str = data.toString()

  if (str.includes('[SYNC_START]')) {
    const parts = str.split('[SYNC_START]')
    if (parts[1]) startSpinner(parts[1].split('\n')[0].trim())
  }
  if (str.includes('[SYNC_END]')) {
    stopSpinner()
  }

  if (str.includes('[SERVER_EXIT]')) {
    isShuttingDown = true
    stopSpinner()
    console.log(
      `${colors.system}[System]${colors.reset} Server sync complete. Shutting down cleanly.`
    )
    terminateProcess(serverProcess)
    terminateProcess(clientProcess)
    setTimeout(() => process.exit(0), 2000)
    return
  }

  if (str.includes('[SYNC_START]') || str.includes('[SYNC_END]')) {
    // Fall through so remaining buffered lines are not swallowed
  }

  const lines = str.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) return

  if (syncSpinner) {
    process.stdout.write('\r\x1b[K')
    for (const line of lines) {
      console.log(`${color}[${prefix}]${colors.reset} ${line}`)
    }

    process.stdout.write(
      `${colors.system}[System]${colors.reset} ${syncMessage}${'.'.repeat(syncDots)}${' '.repeat(3 - syncDots)}`
    )
  } else {
    for (const line of lines) {
      console.log(`${color}[${prefix}]${colors.reset} ${line}`)
    }
  }
}

const spawnOpts = (cwd, extraEnv, withIpc = false) => ({
  // 'ipc' gives the child a structured message channel (see server/src/lib/ipc.ts).
  // It only works for directly spawned node processes (prod); under `npm run`
  // (dev) there is no IPC forwarding, so stdout tags remain the fallback signal.
  stdio: withIpc ? ['pipe', 'pipe', 'pipe', 'ipc'] : 'pipe',
  shell: false,
  cwd,
  detached: !isWin,
  windowsHide: true,
  env: { ...process.env, ...(extraEnv || {}) },
})

const spawnNpm = (args, cwd, env) => {
  if (isWin) {
    return spawn('cmd.exe', ['/c', npmCmd, ...args], spawnOpts(cwd, env))
  }
  return spawn(npmCmd, args, spawnOpts(cwd, env))
}

const terminateProcess = (proc, signal = 'SIGTERM') => {
  if (!proc || !proc.pid) return
  if (isWin) {
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch (err) {
      console.error(
        `${colors.system}[System]${colors.reset} Failed to kill pid ${proc.pid}: ${err.message}`
      )
    }
    return
  }
  try {
    process.kill(-proc.pid, signal)
  } catch (err) {
    // ESRCH just means the process group is already gone — not an error.
    if (err.code !== 'ESRCH') {
      console.error(
        `${colors.system}[System]${colors.reset} Failed to signal ${proc.pid} (${signal}): ${err.message}`
      )
    }
  }
}
let serverProcess, clientProcess
let isShuttingDown = false

async function main() {
  console.log(
    `${colors.system}[System]${colors.reset} Starting dango in ${mode.toUpperCase()} mode...`
  )
  console.log(
    `${colors.system}[System]${colors.reset} Press 'q' or 'Ctrl+C' to cleanly exit and sync data.\n`
  )

  if (mode === 'dev') {
    serverProcess = spawnNpm(['run', 'dev', '--workspace=dango-server'], __dirname, {
      NODE_ENV: 'development',
      INTERNAL_SHUTDOWN_TOKEN: shutdownToken,
    })
    clientProcess = spawnNpm(['run', 'dev', '--workspace=dango-client'], __dirname, {
      NODE_ENV: 'development',
    })
  } else {
    const serverPath = path.join(SERVER_DIR, 'dist', 'server.js')
    serverProcess = spawn(
      'node',
      ['--max-old-space-size=512', serverPath],
      spawnOpts(SERVER_DIR, {
        NODE_ENV: 'production',
        INTERNAL_SHUTDOWN_TOKEN: shutdownToken,
      })
    )
  }

  if (serverProcess) {
    serverProcess.stdout.on('data', (data) => log('Server', colors.server, data))
    serverProcess.stderr.on('data', (data) => log('Server', colors.server, data))
    serverProcess.on('exit', (code) => {
      if (!isShuttingDown) {
        log('System', colors.system, `Server crashed or exited prematurely.`)
        terminateProcess(clientProcess)
        setTimeout(() => process.exit(code || 0), 500)
      }
    })
  }

  if (clientProcess) {
    clientProcess.stdout.on('data', (data) => log('Client', colors.client, data))
    clientProcess.stderr.on('data', (data) => log('Client', colors.client, data))
  }

  if (process.stdin.isTTY) {
    process.stdin.resume()
    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
  }

  process.stdin.on('keypress', (str, key) => {
    if (key && (key.name === 'q' || (key.ctrl && key.name === 'c'))) {
      shutdown()
    }
  })
}

const shutdown = () => {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`\n${colors.system}[System]${colors.reset} Initiating clean shutdown...`)

  if (clientProcess) {
    terminateProcess(clientProcess, 'SIGTERM')
    setTimeout(() => {
      if (clientProcess.exitCode === null && !clientProcess.killed) {
        terminateProcess(clientProcess, 'SIGKILL')
      }
    }, 5000)
  }

  const serverPort = Number(process.env.PORT) || 3000
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: serverPort,
      path: '/api/internal/shutdown',
      method: 'POST',
      headers: {
        'x-internal-token': shutdownToken,
      },
    },
    (res) => {
      if (res.statusCode !== 200) {
        console.log(
          `${colors.system}[System]${colors.reset} Server rejected shutdown request (${res.statusCode}), forcing exit.`
        )
        terminateProcess(serverProcess, 'SIGKILL')
        terminateProcess(clientProcess, 'SIGKILL')
        setTimeout(() => process.exit(0), 1000)
      }
    }
  )

  req.on('error', () => {
    console.log(`${colors.system}[System]${colors.reset} Server unreachable, forcing exit.`)
    terminateProcess(serverProcess, 'SIGKILL')
    terminateProcess(clientProcess, 'SIGKILL')
    setTimeout(() => process.exit(0), 1000)
  })

  req.end()

  setTimeout(() => {
    console.log(`${colors.system}[System]${colors.reset} Force exiting after timeout.`)
    terminateProcess(serverProcess, 'SIGKILL')
    terminateProcess(clientProcess, 'SIGKILL')
    setTimeout(() => process.exit(1), 1000)
  }, 15000)
}

const restoreTerminal = () => {
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
  } catch {
    // ignore terminal restore errors
  }
}

process.on('SIGINT', () => {
  shutdown()
})
process.on('SIGTERM', () => {
  shutdown()
})
process.on('SIGHUP', () => {
  shutdown()
})
process.on('exit', restoreTerminal)
checkForUpdates().catch(() => {})
main()
