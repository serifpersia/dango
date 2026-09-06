import fs from 'fs'
import { CONFIG } from '../config'

const lockPath = `${CONFIG.ENV_PATH}.lock`

async function acquireLock(): Promise<fs.promises.FileHandle> {
  let handle: fs.promises.FileHandle | undefined
  let attempts = 0
  while (!handle) {
    try {
      handle = await fs.promises.open(lockPath, 'wx')
    } catch {
      if (++attempts >= 100) {
        fs.promises.unlink(lockPath).catch(() => {})
        throw new Error('Failed to acquire lock on .env file - another process may be holding it')
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  return handle
}

function releaseLock(handle: fs.promises.FileHandle) {
  handle.close().catch(() => {})
  fs.promises.unlink(lockPath).catch(() => {})
}

export async function updateEnvFile(updates: Record<string, string>) {
  const lockHandle = await acquireLock()
  try {
    const envPath = CONFIG.ENV_PATH

    let envContent = ''
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8')
    }

    const lines = envContent.split('\n')
    const newLines = [...lines]

    Object.entries(updates).forEach(([rawKey, rawValue]) => {
      const key = rawKey.trim()
      if (!/^[A-Z0-9_]+$/i.test(key)) {
        throw new Error(`Invalid environment variable key: ${key}`)
      }
      const value = String(rawValue ?? '').replace(/[\r\n]/g, '')

      let found = false
      for (let i = 0; i < newLines.length; i++) {
        const line = newLines[i]
        if (line && line.startsWith(`${key}=`)) {
          if (value === '') {
            newLines.splice(i, 1)
            continue
          } else {
            newLines[i] = `${key}=${value}`
          }
          found = true
          break
        }
      }
      if (!found && value !== '') {
        newLines.push(`${key}=${value}`)
      }
    })

    const finalContent =
      newLines
        .join('\n')
        .replace(/\n{2,}/g, '\n')
        .trim() + '\n'
    fs.writeFileSync(envPath, finalContent)

    // Update process.env so the changes are reflected immediately in the running process
    Object.entries(updates).forEach(([key, value]) => {
      if (value === '') {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    })
  } finally {
    releaseLock(lockHandle)
  }
}
