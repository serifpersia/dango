#!/usr/bin/env node
const { spawn } = require('child_process')
const readline = require('readline')
const http = require('http')
const os = require('os')
const path = require('path')
const axios = require('axios')

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
  console.log(`ani-web version ${pkg.version}`)
  process.exit(0)
}

async function showDeprecationNotice() {
  const pkg = require('./package.json')
  console.log('')
  console.log(
    `${colors.system}[Deprecated]${colors.reset} ani-web has been rebranded to ${colors.client}dango${colors.reset}`
  )
  console.log('')
  console.log(`  This is the final release of ani-web (v${pkg.version}).`)
  console.log(`  To continue receiving updates, install dango:`)
  console.log('')
  console.log(`    ${colors.client}npm install -g @serifpersia/dango${colors.reset}`)
  console.log('')
  console.log(`  Once dango is working, you can remove ani-web:`)
  console.log('')
  console.log(`    ${colors.client}npm uninstall -g ani-web${colors.reset}`)
  console.log('')

  if (!process.stdin.isTTY) {
    console.log(`${colors.system}[System]${colors.reset} Non-interactive mode. Exiting.`)
    process.exit(0)
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => {
    rl.question(
      `${colors.system}[System]${colors.reset} Continue using ani-web v${pkg.version}? (y/N) `,
      (ans) => {
        rl.close()
        resolve(ans.toLowerCase())
      }
    )
  })

  if (answer !== 'y' && answer !== 'yes') {
    console.log(`\n${colors.system}[System]${colors.reset} Exiting. Install dango to continue:\n`)
    console.log(`  ${colors.client}npm install -g @serifpersia/dango${colors.reset}\n`)
    process.exit(0)
  }

  console.log(
    `\n${colors.system}[System]${colors.reset} Continuing with ani-web v${pkg.version} (no further updates)...\n`
  )
}

async function checkForUpdates() {
  if (process.argv.includes('--no-update') || mode === 'dev') return

  try {
    const npmGlobalPrefix = require('child_process')
      .execSync('npm config get prefix', { encoding: 'utf8' })
      .trim()
    const scriptPath = path.resolve(__dirname)
    const isGlobalInstall = scriptPath.includes(npmGlobalPrefix)

    const pkg = require('./package.json')
    const current = pkg.version

    if (isGlobalInstall) {
      const { data } = await axios.get('https://registry.npmjs.org/ani-web/latest', {
        timeout: 3000,
        headers: { 'User-Agent': 'ani-web-cli' },
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
            console.log(`${colors.system}[Update]${colors.reset} Updating ani-web...`)
            try {
              require('child_process').execSync(`${npmCmd} install -g ani-web@latest`, {
                stdio: 'inherit',
              })
              console.log(
                `\n${colors.system}[Update]${colors.reset} Update successful! Please restart ani-web to apply changes.`
              )
              process.exit(0)
            } catch (err) {
              console.error(
                `\n${colors.system}[Update]${colors.reset} Update failed: ${err.message}`
              )
              if (!isWin) {
                console.log(
                  `${colors.system}[Update]${colors.reset} Hint: You might need to run with sudo:`
                )
                console.log(
                  `${colors.system}[Update]${colors.reset} ${colors.client}sudo ani-web${colors.reset}\n`
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
            `${colors.system}[Update]${colors.reset} Run: npm install -g ani-web to update.\n`
          )
        }
      }
    } else {
      const { data } = await axios.get(
        'https://api.github.com/repos/serifpersia/ani-web/releases/latest',
        { timeout: 3000 }
      )
      const latestDate = new Date(data.published_at)
      const pkgDate = new Date(pkg.versionDate || 0)

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
    return
  }
  if (str.includes('[SYNC_END]')) {
    stopSpinner()
    return
  }

  if (str.includes('[SERVER_EXIT]')) {
    stopSpinner()
    console.log(
      `${colors.system}[System]${colors.reset} Server sync complete. Shutting down cleanly.`
    )

    if (isWin) {
      if (serverProcess) spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t'], { shell: true })
      if (clientProcess) spawn('taskkill', ['/pid', clientProcess.pid, '/f', '/t'], { shell: true })
    } else {
      if (serverProcess) {
        try {
          process.kill(-serverProcess.pid, 'SIGTERM')
        } catch {}
      }
      if (clientProcess) {
        try {
          process.kill(-clientProcess.pid, 'SIGTERM')
        } catch {}
      }
    }
    setTimeout(() => process.exit(0), 2000)
    return
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

const spawnOpts = (cwd) => ({
  stdio: 'pipe',
  shell: isWin,
  cwd,
  detached: !isWin,
  windowsHide: true,
})
let serverProcess, clientProcess
let isShuttingDown = false

async function main() {
  console.log(
    `${colors.system}[System]${colors.reset} Starting ani-web in ${mode.toUpperCase()} mode...`
  )
  console.log(
    `${colors.system}[System]${colors.reset} Press 'q' or 'Ctrl+C' to cleanly exit and sync data.\n`
  )

  if (mode === 'dev') {
    serverProcess = spawn(npmCmd, ['run', 'dev'], spawnOpts(SERVER_DIR))
    clientProcess = spawn(npmCmd, ['run', 'dev'], spawnOpts(CLIENT_DIR))
  } else {
    const serverPath = path.join(SERVER_DIR, 'dist', 'server.js')
    serverProcess = spawn('node', ['--max-old-space-size=256', serverPath], spawnOpts(SERVER_DIR))
  }

  if (serverProcess) {
    serverProcess.stdout.on('data', (data) => log('Server', colors.server, data))
    serverProcess.stderr.on('data', (data) => log('Server', colors.server, data))
    serverProcess.on('exit', (code) => {
      if (!isShuttingDown) {
        log('System', colors.system, `Server crashed or exited prematurely.`)
        process.exit(code || 0)
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
    if (isWin) spawn('taskkill', ['/pid', clientProcess.pid, '/f', '/t'], { shell: true })
    else {
      clientProcess.kill('SIGTERM')
      setTimeout(() => {
        if (clientProcess.connected || !clientProcess.killed) clientProcess.kill('SIGKILL')
      }, 5000)
    }
  }

  const req = http.request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/internal/shutdown',
    method: 'POST',
  })

  req.on('error', () => {
    console.log(`${colors.system}[System]${colors.reset} Server unreachable, forcing exit.`)
    if (isWin && serverProcess)
      spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t'], { shell: true })
    else if (serverProcess) {
      try {
        process.kill(-serverProcess.pid, 'SIGKILL')
      } catch {}
    }
    if (clientProcess) {
      if (isWin) spawn('taskkill', ['/pid', clientProcess.pid, '/f', '/t'], { shell: true })
      else
        try {
          process.kill(-clientProcess.pid, 'SIGKILL')
        } catch {}
    }
    setTimeout(() => process.exit(0), 1000)
  })

  req.end()

  setTimeout(() => {
    console.log(`${colors.system}[System]${colors.reset} Force exiting after timeout.`)
    if (isWin && serverProcess)
      spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t'], { shell: true })
    else if (serverProcess) {
      try {
        process.kill(-serverProcess.pid, 'SIGKILL')
      } catch {}
    }
    if (clientProcess) {
      if (isWin) spawn('taskkill', ['/pid', clientProcess.pid, '/f', '/t'], { shell: true })
      else
        try {
          process.kill(-clientProcess.pid, 'SIGKILL')
        } catch {}
    }
    setTimeout(() => process.exit(1), 1000)
  }, 15000)
}

process.on('SIGINT', () => {
  shutdown()
})
;(async () => {
  await showDeprecationNotice()
  main()
})()
