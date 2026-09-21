import { Request, Response } from 'express'
import logger from '../logger.js'
import { googleDriveService } from '../google.js'
import { githubSyncService } from '../github-sync.js'
import { DatabaseWrapper } from '../db.js'
import { initializeDatabase, syncDownOnBoot, initSyncProvider } from '../sync.js'
import { CONFIG } from '../config.js'
import { rcloneService } from '../rclone.js'
import path from 'path'

export class AuthController {
  private runSyncSequence: (
    db: DatabaseWrapper,
    mangaDb: DatabaseWrapper,
    provider?: 'github' | 'google' | 'rclone' | 'none'
  ) => Promise<void>

  constructor(
    runSyncSequence: (
      db: DatabaseWrapper,
      mangaDb: DatabaseWrapper,
      provider?: 'github' | 'google' | 'rclone' | 'none'
    ) => Promise<void>
  ) {
    this.runSyncSequence = runSyncSequence
  }

  getConfigStatus = (_req: Request, res: Response) => {
    // New flow: Worker holds ID+secret, no local .env needed.
    // Legacy fallback: user-owned GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.
    const useWorker = !!CONFIG.GOOGLE_AUTH_WORKER_URL
    const hasLegacyConfig = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
    res.json({ hasConfig: useWorker || hasLegacyConfig, useWorker })
  }

  getGoogleAuthSettings = (_req: Request, res: Response) => {
    res.json({
      useWorker: !!CONFIG.GOOGLE_AUTH_WORKER_URL,
      hasCustomWorkerUrl: !!process.env.GOOGLE_AUTH_WORKER_URL,
      hasCustomClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    })
  }

  updateGoogleAuthSettings = async (req: Request, res: Response) => {
    const { clientId, clientSecret, workerUrl } = req.body
    const { updateEnvFile } = await import('../utils/env.utils.js')

    const updates: Record<string, string> = {}

    if (typeof clientId === 'string') {
      updates.GOOGLE_CLIENT_ID = clientId
    }

    if (typeof clientSecret === 'string') {
      updates.GOOGLE_CLIENT_SECRET = clientSecret
    }

    if (typeof workerUrl === 'string') {
      updates.GOOGLE_AUTH_WORKER_URL = workerUrl
    }

    await updateEnvFile(updates)
    if (typeof workerUrl === 'string') {
      ;(CONFIG as { GOOGLE_AUTH_WORKER_URL: string }).GOOGLE_AUTH_WORKER_URL = workerUrl
    }
    if (typeof clientId === 'string') {
      ;(CONFIG as { GOOGLE_CLIENT_ID?: string }).GOOGLE_CLIENT_ID = clientId || undefined
    }
    if (typeof clientSecret === 'string') {
      ;(CONFIG as { GOOGLE_CLIENT_SECRET?: string }).GOOGLE_CLIENT_SECRET =
        clientSecret || undefined
    }
    await initSyncProvider()
    res.json({ success: true })
  }

  getGitHubAuthOverride = (_req: Request, res: Response) => {
    res.json({ hasCustomClientId: !!process.env.GITHUB_CLIENT_ID })
  }

  updateGitHubAuthSettings = async (req: Request, res: Response) => {
    const { clientId } = req.body
    const { updateEnvFile } = await import('../utils/env.utils.js')
    if (typeof clientId !== 'string') {
      return res.status(400).json({ error: 'clientId required' })
    }
    await updateEnvFile({ GITHUB_CLIENT_ID: clientId })
    res.json({ success: true })
  }

  getRcloneSettings = async (_req: Request, res: Response) => {
    const remotes = await rcloneService.listRemotes()
    res.json({
      remote: CONFIG.RCLONE_REMOTE || '',
      availableRemotes: remotes,
      activeRemote: rcloneService.isActive() ? rcloneService.getRemoteName() : null,
    })
  }

  getSyncSettings = async (_req: Request, res: Response) => {
    const { getActiveProvider } = await import('../sync.js')
    res.json({
      activeProvider: process.env.SYNC_PROVIDER || 'default',
      actualActiveProvider: getActiveProvider(),
      authenticatedProviders: {
        github: githubSyncService.isAuthenticated(),
        google: googleDriveService.isAuthenticated(),
        rclone: rcloneService.isActive(),
      },
    })
  }

  updateSyncProvider = async (req: Request, res: Response) => {
    const { provider } = req.body
    const { updateEnvFile } = await import('../utils/env.utils.js')

    const value = provider === 'default' ? '' : provider
    await updateEnvFile({ SYNC_PROVIDER: value })
    await initSyncProvider()
    res.json({ success: true, activeProvider: process.env.SYNC_PROVIDER || 'default' })
  }

  getGitHubAuthStatus = async (_req: Request, res: Response) => {
    try {
      const user = await githubSyncService.getUserProfile()
      res.json({
        authenticated: !!user,
        user,
        device: githubSyncService.getDeviceState(),
        hasCustomClientId: !!process.env.GITHUB_CLIENT_ID,
      })
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch GitHub auth status')
      res.json({
        authenticated: false,
        user: null,
        device: githubSyncService.getDeviceState(),
        hasCustomClientId: !!process.env.GITHUB_CLIENT_ID,
      })
    }
  }

  startGitHubDeviceAuth = async (req: Request, res: Response) => {
    const mangaDb = req.mangaDb
    const runSync = this.runSyncSequence
    const state = await githubSyncService.startDeviceAuth(req.db, (db, provider) =>
      runSync(db, mangaDb, provider)
    )
    res.json(state)
  }

  pollGitHubDeviceAuth = (_req: Request, res: Response) => {
    res.json(githubSyncService.getDeviceState())
  }

  logoutGitHub = async (_req: Request, res: Response) => {
    await githubSyncService.logout()
    const { updateEnvFile } = await import('../utils/env.utils.js')
    await updateEnvFile({ SYNC_PROVIDER: '' })
    await initSyncProvider()
    res.json({ success: true })
  }

  updateRcloneSettings = async (req: Request, res: Response) => {
    const { remote } = req.body
    const { updateEnvFile } = await import('../utils/env.utils.js')

    await updateEnvFile({
      RCLONE_REMOTE: remote,
      SYNC_PROVIDER: 'rclone',
    })
    await this.runSyncSequence(req.db, req.mangaDb, 'rclone')
    res.json({ success: true })
  }

  getAuthUrl = async (_req: Request, res: Response) => {
    const url = await googleDriveService.getAuthUrl()
    res.json({ url })
  }

  loginGoogle = async (req: Request, res: Response) => {
    if (googleDriveService.isAuthenticated()) {
      const user = await googleDriveService.getUserProfile()
      if (user) {
        const { updateEnvFile } = await import('../utils/env.utils.js')
        await updateEnvFile({ SYNC_PROVIDER: 'google' })
        await this.runSyncSequence(req.db, req.mangaDb, 'google')
        return res.json({ url: null, authenticated: true })
      } else {
        logger.warn('Google tokens found but invalid. Clearing and requesting new auth.')
        await googleDriveService.logout()
      }
    }
    const url = await googleDriveService.getAuthUrl()
    res.json({ url, authenticated: false })
  }

  handleCallback = async (req: Request, res: Response) => {
    const code = req.query.code as string
    if (!code) {
      return res.status(400).send('No code provided')
    }

    await googleDriveService.handleCallback(code)
    const user = await googleDriveService.getUserProfile()

    const { updateEnvFile } = await import('../utils/env.utils.js')
    await updateEnvFile({ SYNC_PROVIDER: 'google' })

    logger.info('User logged in. Syncing database (please wait)...')
    try {
      await this.runSyncSequence(req.db, req.mangaDb, 'google')
    } catch (err) {
      logger.error({ err }, 'Post-login sync failed')
    }

    const responseHtml = `
            <html>
            <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
            <body>
            <h1>Authentication Successful</h1>
            <p>Database synced. Returning to dango...</p>
            <p><a href="/?google_auth=success">Tap here if you are not redirected</a></p>
            <script>
            (function () {
              var payload = { type: 'GOOGLE_AUTH_SUCCESS', user: ${JSON.stringify(user)} };
              try {
                if (window.opener && !window.opener.closed) {
                  window.opener.postMessage(payload, window.location.origin);
                  try {
                    window.opener.postMessage(payload, 'http://localhost:${CONFIG.PORT}');
                  } catch (e) {}
                  try {
                    window.opener.postMessage(payload, 'http://127.0.0.1:${CONFIG.PORT}');
                  } catch (e) {}
                  setTimeout(function () { window.close(); }, 300);
                  setTimeout(function () { window.location.href = '/?google_auth=success'; }, 1500);
                } else {
                  window.location.href = '/?google_auth=success';
                }
              } catch (e) {
                window.location.href = '/?google_auth=success';
              }
            })();
            </script>
            </body>
            </html>
            `
    res.send(responseHtml)
  }

  getUserProfile = async (_req: Request, res: Response) => {
    const user = await googleDriveService.getUserProfile()
    res.json(user)
  }

  logout = async (_req: Request, res: Response) => {
    await googleDriveService.logout()
    const { updateEnvFile } = await import('../utils/env.utils.js')
    await updateEnvFile({ SYNC_PROVIDER: '' })
    await initSyncProvider()
    res.json({ success: true })
  }
}
