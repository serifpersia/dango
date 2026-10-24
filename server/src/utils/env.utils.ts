import fs from 'fs'
import { CONFIG, INSTALL_CONFIG } from '../config.js'
import { profileScope } from '../profile-scope.js'

async function acquireLock(lockPath: string): Promise<fs.promises.FileHandle> {
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

function releaseLock(handle: fs.promises.FileHandle, lockPath: string) {
  handle.close().catch(() => {})
  fs.promises.unlink(lockPath).catch(() => {})
}

export async function updateEnvFile(updates: Record<string, string>) {
  if (profileScope.getStore()?.deleted) throw new Error('Profile has been deleted')
  const installation = Object.keys(updates).some((key) =>
    ['PORT', 'APP_PASSWORD_HASH', 'DISCORD_GATEWAY_TOKEN'].includes(key)
  )
  const envPath = installation ? INSTALL_CONFIG.ENV_PATH : CONFIG.ENV_PATH
  const lockPath = `${envPath}.lock`
  const lockHandle = await acquireLock(lockPath)
  try {
    if (profileScope.getStore()?.deleted) throw new Error('Profile has been deleted')
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

    Object.entries(updates).forEach(([key, value]) => {
      const scope = profileScope.getStore()
      if (scope && !installation) {
        scope.env[key] = value || undefined
        return
      }
      if (value === '') {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    })
  } finally {
    releaseLock(lockHandle, lockPath)
  }
}
