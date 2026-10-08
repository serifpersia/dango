import type { Hono } from 'hono'
import logger from '../logger.js'
import { googleDriveService } from '../google.js'
import type { DatabaseWrapper } from '../db.js'
import type { HonoDbs } from '../app-hono.js'
import { CONFIG } from '../config.js'
import { updateEnvFile } from '../utils/env.utils.js'

export type RunSyncSequence = (
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  provider?: 'github' | 'google' | 'rclone' | 'none'
) => Promise<void>

export function registerAuth(app: Hono, getDbs: () => HonoDbs, runSync: RunSyncSequence) {
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
}
