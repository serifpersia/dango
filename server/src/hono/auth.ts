import type { Hono } from 'hono'
import logger from '../logger.js'
import { googleDriveService } from '../google.js'
import { githubSyncService } from '../github-sync.js'
import type { DatabaseWrapper } from '../db.js'
import type { HonoDbs } from '../app-hono.js'
import { initSyncProvider, getActiveProvider } from '../sync.js'
import { CONFIG } from '../config.js'
import { rcloneService } from '../rclone.js'
import { updateEnvFile } from '../utils/env.utils.js'

export type RunSyncSequence = (
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  provider?: 'github' | 'google' | 'rclone' | 'none'
) => Promise<void>

export function registerAuth(app: Hono, getDbs: () => HonoDbs, runSync: RunSyncSequence) {
  app.get('/api/auth/config-status', (c) => {
    const useWorker = !!CONFIG.GOOGLE_AUTH_WORKER_URL
    const hasLegacyConfig = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
    return c.json({ hasConfig: useWorker || hasLegacyConfig, useWorker })
  })

  app.get('/api/auth/google-auth', (c) => {
    return c.json({
      useWorker: !!CONFIG.GOOGLE_AUTH_WORKER_URL,
      hasCustomWorkerUrl: !!process.env.GOOGLE_AUTH_WORKER_URL,
      hasCustomClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    })
  })

  app.post('/api/auth/google-auth', async (c) => {
    const { clientId, clientSecret, workerUrl } = (await c.req.json()) as {
      clientId?: unknown
      clientSecret?: unknown
      workerUrl?: unknown
    }

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
    return c.json({ success: true })
  })

  app.get('/api/auth/github/auth', (c) => {
    return c.json({ hasCustomClientId: !!process.env.GITHUB_CLIENT_ID })
  })

  app.post('/api/auth/github/auth', async (c) => {
    const { clientId } = (await c.req.json()) as { clientId?: unknown }
    if (typeof clientId !== 'string') {
      return c.json({ error: 'clientId required' }, 400)
    }
    await updateEnvFile({ GITHUB_CLIENT_ID: clientId })
    return c.json({ success: true })
  })

  app.get('/api/auth/settings/rclone', async (c) => {
    const remotes = await rcloneService.listRemotes()
    return c.json({
      remote: CONFIG.RCLONE_REMOTE || '',
      availableRemotes: remotes,
      activeRemote: rcloneService.isActive() ? rcloneService.getRemoteName() : null,
    })
  })

  app.get('/api/auth/settings/sync', async (c) => {
    return c.json({
      activeProvider: process.env.SYNC_PROVIDER || 'default',
      actualActiveProvider: getActiveProvider(),
      authenticatedProviders: {
        github: githubSyncService.isAuthenticated(),
        google: googleDriveService.isAuthenticated(),
        rclone: rcloneService.isActive(),
      },
    })
  })

  app.post('/api/auth/settings/sync', async (c) => {
    const { provider } = (await c.req.json()) as { provider?: unknown }

    const value = provider === 'default' ? '' : (provider as string)
    await updateEnvFile({ SYNC_PROVIDER: value })
    await initSyncProvider()
    return c.json({ success: true, activeProvider: process.env.SYNC_PROVIDER || 'default' })
  })

  app.get('/api/auth/github/status', async (c) => {
    try {
      const user = await githubSyncService.getUserProfile()
      return c.json({
        authenticated: !!user,
        user,
        device: githubSyncService.getDeviceState(),
        hasCustomClientId: !!process.env.GITHUB_CLIENT_ID,
      })
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch GitHub auth status')
      return c.json({
        authenticated: false,
        user: null,
        device: githubSyncService.getDeviceState(),
        hasCustomClientId: !!process.env.GITHUB_CLIENT_ID,
      })
    }
  })

  app.post('/api/auth/github/start', async (c) => {
    const dbs = getDbs()
    const state = await githubSyncService.startDeviceAuth(dbs.db, (db, provider) =>
      runSync(db, dbs.mangaDb, provider)
    )
    return c.json(state)
  })

  app.get('/api/auth/github/poll', (c) => {
    return c.json(githubSyncService.getDeviceState())
  })

  app.post('/api/auth/github/logout', async (c) => {
    await githubSyncService.logout()
    await updateEnvFile({ SYNC_PROVIDER: '' })
    await initSyncProvider()
    return c.json({ success: true })
  })

  app.post('/api/auth/settings/rclone', async (c) => {
    const { remote } = (await c.req.json()) as { remote?: unknown }

    await updateEnvFile({
      RCLONE_REMOTE: remote as string,
      SYNC_PROVIDER: 'rclone',
    })
    const dbs = getDbs()
    await runSync(dbs.db, dbs.mangaDb, 'rclone')
    return c.json({ success: true })
  })

  app.get('/api/auth/google', async (c) => {
    const url = await googleDriveService.getAuthUrl()
    return c.json({ url })
  })

  app.post('/api/auth/google/login', async (c) => {
    const dbs = getDbs()
    if (googleDriveService.isAuthenticated()) {
      const user = await googleDriveService.getUserProfile()
      if (user) {
        await updateEnvFile({ SYNC_PROVIDER: 'google' })
        await runSync(dbs.db, dbs.mangaDb, 'google')
        return c.json({ url: null, authenticated: true })
      } else {
        logger.warn('Google tokens found but invalid. Clearing and requesting new auth.')
        await googleDriveService.logout()
      }
    }
    const url = await googleDriveService.getAuthUrl()
    return c.json({ url, authenticated: false })
  })

  app.get('/api/auth/google/callback', async (c) => {
    const code = c.req.query('code') as string
    if (!code) {
      return c.text('No code provided', 400)
    }

    await googleDriveService.handleCallback(code)
    const user = await googleDriveService.getUserProfile()

    await updateEnvFile({ SYNC_PROVIDER: 'google' })

    logger.info('User logged in. Syncing database (please wait)...')
    const dbs = getDbs()
    try {
      await runSync(dbs.db, dbs.mangaDb, 'google')
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
    return c.html(responseHtml)
  })

  app.get('/api/auth/user', async (c) => {
    const user = await googleDriveService.getUserProfile()
    return c.json(user)
  })

  app.post('/api/auth/logout', async (c) => {
    await googleDriveService.logout()
    await updateEnvFile({ SYNC_PROVIDER: '' })
    await initSyncProvider()
    return c.json({ success: true })
  })
}
