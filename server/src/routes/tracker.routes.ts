import { Router } from 'express'
import { AniListTracker, exchangeAuthorizationCode } from '../lib/tracker/anilist-tracker'
import { syncAniList, importFromUsername } from '../lib/tracker/sync.service'
import { SettingsRepository } from '../repositories/settings.repository'
import { performWriteTransaction } from '../sync'

const TOKEN_KEY = 'tracker_anilist_token'
const USER_KEY = 'tracker_anilist_user'
const CLIENT_ID_KEY = 'tracker_anilist_client_id'
const CLIENT_SECRET_KEY = 'tracker_anilist_client_secret'

export function createTrackerRouter(): Router {
  const router = Router()

  // OAuth callback: AniList redirects here with ?code=&state=
  // Single registered redirect_uri covers both dev (5173 frontend + 3000 backend) and prod (3000)
  router.get('/tracker/anilist/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    // frontend origin to redirect back to (passed as state=encodeURIComponent(frontendUrl))
    let frontendBase: string
    try {
      frontendBase = state ? decodeURIComponent(state) : ''
    } catch {
      frontendBase = ''
    }
    // fallback to referer / host if state missing
    if (!frontendBase || !/^https?:\/\//.test(frontendBase)) {
      frontendBase = req.get('referer') || `http://localhost:3000/trackers`
    }

    if (!code) {
      return res.redirect(
        `${frontendBase}${frontendBase.includes('?') ? '&' : '?'}anilist=error&reason=no_code`
      )
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/tracker/anilist/callback`
    try {
      const clientIdRow = await SettingsRepository.getByKey(req.db, CLIENT_ID_KEY)
      const clientSecretRow = await SettingsRepository.getByKey(req.db, CLIENT_SECRET_KEY)
      if (!clientIdRow?.value || !clientSecretRow?.value) {
        return res.redirect(
          `${frontendBase}${frontendBase.includes('?') ? '&' : '?'}anilist=error&reason=missing_client`
        )
      }
      const exchanged = await exchangeAuthorizationCode({
        clientId: clientIdRow.value,
        clientSecret: clientSecretRow.value,
        redirectUri,
        code,
      })
      const tracker = new AniListTracker(exchanged.access_token)
      const viewer = await tracker.getViewer()
      await performWriteTransaction(req.db, (tx) => {
        SettingsRepository.upsert(tx, TOKEN_KEY, exchanged.access_token)
        SettingsRepository.upsert(tx, USER_KEY, JSON.stringify(viewer))
      })
      const sep = frontendBase.includes('?') ? '&' : '?'
      return res.redirect(
        `${frontendBase}${sep}anilist=success&user=${encodeURIComponent(viewer.name)}`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'exchange failed'
      return res.redirect(
        `${frontendBase}${frontendBase.includes('?') ? '&' : '?'}anilist=error&reason=${encodeURIComponent(msg)}`
      )
    }
  })

  router.get('/tracker/status', async (req, res) => {
    try {
      const tokenRow = await SettingsRepository.getByKey(req.db, TOKEN_KEY)
      const userRow = await SettingsRepository.getByKey(req.db, USER_KEY)
      let user: unknown = null
      if (userRow?.value) {
        try {
          user = JSON.parse(userRow.value)
        } catch {
          user = null
        }
      }
      res.json({
        anilist: { connected: !!tokenRow?.value, user },
      })
    } catch {
      res.status(500).json({ error: 'Failed to read tracker status' })
    }
  })

  router.post('/tracker/anilist/auth', async (req, res) => {
    const { token, code, redirectUri } = req.body ?? {}

    let accessToken = typeof token === 'string' ? token : ''

    // Authorization Code flow: exchange the ?code= from the redirect for a bearer token
    if (!accessToken && code && typeof code === 'string') {
      try {
        const clientIdRow = await SettingsRepository.getByKey(req.db, CLIENT_ID_KEY)
        const clientSecretRow = await SettingsRepository.getByKey(req.db, CLIENT_SECRET_KEY)
        if (!clientIdRow?.value || !clientSecretRow?.value) {
          return res
            .status(400)
            .json({ error: 'AniList client ID and secret must be configured first' })
        }
        if (!redirectUri || typeof redirectUri !== 'string') {
          return res.status(400).json({ error: 'redirectUri is required for code exchange' })
        }
        const exchanged = await exchangeAuthorizationCode({
          clientId: clientIdRow.value,
          clientSecret: clientSecretRow.value,
          redirectUri,
          code,
        })
        accessToken = exchanged.access_token
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Token exchange failed'
        return res.status(401).json({ error: message })
      }
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'Token or authorization code is required' })
    }

    try {
      const tracker = new AniListTracker(accessToken)
      const viewer = await tracker.getViewer()

      await performWriteTransaction(req.db, (tx) => {
        SettingsRepository.upsert(tx, TOKEN_KEY, accessToken)
        SettingsRepository.upsert(tx, USER_KEY, JSON.stringify(viewer))
      })

      res.json({ success: true, user: viewer })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      res.status(401).json({ error: message })
    }
  })

  router.post('/tracker/anilist/disconnect', async (req, res) => {
    try {
      await performWriteTransaction(req.db, (tx) => {
        SettingsRepository.upsert(tx, TOKEN_KEY, '')
        SettingsRepository.upsert(tx, USER_KEY, '')
      })
      res.json({ success: true })
    } catch {
      res.status(500).json({ error: 'Failed to disconnect' })
    }
  })

  router.post('/tracker/sync', async (req, res) => {
    const { provider = 'anilist' } = req.body ?? {}
    if (provider !== 'anilist') {
      return res.status(400).json({ error: `Provider "${provider}" is not supported yet` })
    }
    try {
      const summary = await syncAniList(req.db)
      res.json({ success: true, summary })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      res.status(500).json({ error: message })
    }
  })

  router.post('/tracker/anilist/import', async (req, res) => {
    const { username } = req.body ?? {}
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' })
    }
    try {
      const count = await importFromUsername(req.db, username.trim())
      res.json({ success: true, count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      res.status(500).json({ error: message })
    }
  })

  return router
}
