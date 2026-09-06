import { spawn, execFile } from 'child_process'
import logger from './logger'
import { CONFIG } from './config'

class RcloneService {
  private activeRemote: string | null = null

  private executeCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('rclone', args, (err, stdout, stderr) => {
        if (err) {
          if (stderr) logger.warn({ stderr }, 'Rclone command warning')
          return reject(new Error(stderr || err.message))
        }
        resolve(stdout.trim())
      })
    })
  }

  private executeRcloneArgs(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('rclone', args, { stdio: 'ignore' })
      process.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Rclone exited with code ${code}`))
      })
      process.on('error', (err) => reject(err))
    })
  }
  public async listRemotes(): Promise<string[]> {
    try {
      const remotesStr = await this.executeCommand(['listremotes'])
      return remotesStr
        .split('\n')
        .map((r) => r.trim())
        .filter((r) => r !== '')
        .map((r) => r.replace(/:$/, ''))
    } catch {
      return []
    }
  }

  public async init(): Promise<boolean> {
    try {
      await this.executeCommand(['version'])

      const remotes = await this.listRemotes()

      if (CONFIG.RCLONE_REMOTE) {
        const found = remotes.find((r) => r.toLowerCase() === CONFIG.RCLONE_REMOTE?.toLowerCase())
        if (found) {
          this.activeRemote = found
          logger.info(`Rclone initialized with manual remote: ${this.activeRemote}`)
          return true
        } else {
          logger.warn(
            `Configured RCLONE_REMOTE '${CONFIG.RCLONE_REMOTE}' not found in rclone listremotes.`
          )
        }
      }

      if (remotes.length > 0 && !CONFIG.RCLONE_REMOTE) {
        logger.info({ remotes }, 'Rclone available but no manual remote is configured in settings.')
        return false
      }

      return false
    } catch (error) {
      logger.warn({ err: error }, 'Rclone initialization failed')
      return false
    }
  }

  public isActive(): boolean {
    return this.activeRemote !== null
  }

  public getRemoteName(): string {
    return this.activeRemote || 'unknown'
  }

  public async downloadFile(
    remoteFolder: string,
    fileName: string,
    localPath: string
  ): Promise<void> {
    if (!this.activeRemote) throw new Error('Rclone not active')
    const remotePath = `${this.activeRemote}:${remoteFolder}/${fileName}`
    await this.executeRcloneArgs(['copyto', remotePath, localPath])
  }

  public async uploadFile(
    localPath: string,
    remoteFolder: string,
    fileName: string
  ): Promise<void> {
    if (!this.activeRemote) throw new Error('Rclone not active')
    const remotePath = `${this.activeRemote}:${remoteFolder}/${fileName}`
    await this.executeRcloneArgs(['copyto', localPath, remotePath])
  }

  private executeRcloneArgsWithOutput(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('rclone', args, { stdio: 'pipe' })
      let stdout = ''
      let stderr = ''
      process.stdout?.on('data', (data) => (stdout += data))
      process.stderr?.on('data', (data) => (stderr += data))
      process.on('close', (code) => {
        if (code === 0) resolve(stdout.trim())
        else {
          if (stderr) logger.warn({ stderr }, 'Rclone command warning')
          reject(new Error(stderr || `Rclone exited with code ${code}`))
        }
      })
      process.on('error', (err) => reject(err))
    })
  }

  public async fileExists(remoteFolder: string, fileName: string): Promise<boolean> {
    if (!this.activeRemote) return false
    try {
      const remotePath = `${this.activeRemote}:${remoteFolder}/${fileName}`
      const output = await this.executeRcloneArgsWithOutput(['lsjson', remotePath])
      const json = JSON.parse(output)
      return json && json.length > 0
    } catch {
      return false
    }
  }
}

export const rcloneService = new RcloneService()
