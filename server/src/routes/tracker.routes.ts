import { Router } from 'express'
import { AniListTracker } from '../lib/tracker/anilist-tracker'
import { syncAniList, importFromUsername } from '../lib/tracker/sync.service'
import { SettingsRepository } from '../repositories/settings.repository'
import { performWriteTransaction } from '../sync'

const TOKEN_KEY = 'tracker_anilist_token'
const USER_KEY = 'tracker_anilist_user'
const CLIENT_ID_KEY = 'tracker_anilist_client_id'

export function createTrackerRouter(): Router {
  const router = Router()

  router.get('/tracker/anilist/callback', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>AniList — completing login</title></head>
<body style="font-family:system-ui;padding:24px;background:#0b1426;color:#e5eefc"><p>Completing AniList login…</p>
<script>
(function(){
  var qs = new URLSearchParams(location.search);
  var state = qs.get('state');
  var hash = location.hash || '';
  var hp = new URLSearchParams(hash.slice(1));
  if (!state) state = hp.get('state');
  var token = hp.get('access_token');
  var error = hp.get('error') || qs.get('error');
  var frontend = '';
  try { frontend = state ? decodeURIComponent(state) : ''; } catch(e) { frontend = state || ''; }
  if (!frontend || !/^https?:\\/\\//.test(frontend)) {
    frontend = location.origin + '/trackers';
    if (frontend.indexOf('/api/tracker/anilist/callback') !== -1) frontend = location.origin + '/trackers';
  }
  if (error) {
    location.replace(frontend + (frontend.indexOf('?') !== -1 ? '&' : '?') + 'anilist=error&reason=' + encodeURIComponent(error));
    return;
  }
  if (token) {
    location.replace(frontend + hash);
    return;
  }
  var code = qs.get('code');
  if (code) {
    location.replace(frontend + (frontend.indexOf('?') !== -1 ? '&' : '?') + 'anilist=error&reason=code_flow_removed');
    return;
  }
  location.replace(frontend + (frontend.indexOf('?') !== -1 ? '&' : '?') + 'anilist=error&reason=no_token');
})();
</script></body></html>`)
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
    const { token } = req.body ?? {}
    const accessToken = typeof token === 'string' ? token.trim() : ''
    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' })
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
