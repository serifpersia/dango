import { Router } from 'express'
import multer from 'multer'
import { XMLParser } from 'fast-xml-parser'
import { AniListTracker } from '../lib/tracker/anilist-tracker.js'
import {
  syncAniList,
  importFromMalUsername,
  importFromUsername,
} from '../lib/tracker/sync.service.js'
import {
  syncAniListManga,
  importFromUsernameManga,
  importMangaFromMalUsername,
  importMangaFromMalXmlItems,
  type MalXmlMangaItem,
} from '../lib/tracker/manga-sync.service.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import { performWriteTransaction } from '../sync.js'

const TOKEN_KEY = 'tracker_anilist_token'
const USER_KEY = 'tracker_anilist_user'
const CLIENT_ID_KEY = 'tracker_anilist_client_id'

const malMangaXmlParser = new XMLParser({
  isArray: (name) => name === 'manga',
  parseTagValue: false,
  trimValues: true,
})

type MangaXmlVal = string | string[] | undefined

function mangaXmlText(value: MangaXmlVal): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return String(value ?? '')
}

function mapMalMangaXmlStatus(status: string): string {
  switch (status) {
    case 'Plan to Read':
      return 'Planned'
    case 'On Hold':
      return 'On-Hold'
    case 'Reading':
    case 'Completed':
    case 'Dropped':
      return status
    default:
      return 'Planned'
  }
}

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
  var frontend = location.origin + '/trackers';
  if (state) {
    try {
      var candidate = decodeURIComponent(state);
      if (candidate.startsWith('/') && !candidate.startsWith('//')) {
        frontend = location.origin + candidate;
      } else {
        var parsed = new URL(candidate, location.origin);
        if (parsed.origin === location.origin) {
          frontend = parsed.href;
        }
      }
    } catch(e) {}
  }
  if (frontend.indexOf('/api/tracker/anilist/callback') !== -1) {
    frontend = location.origin + '/trackers';
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
    const { username, erase } = req.body ?? {}
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' })
    }
    try {
      const count = await importFromUsername(req.db, username.trim(), erase === true)
      res.json({ success: true, count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      res.status(500).json({ error: message })
    }
  })

  router.post('/tracker/mal/import', async (req, res) => {
    const { username, erase, useOfflineDb, skipFallback } = req.body ?? {}
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'MAL username is required' })
    }
    try {
      const count = await importFromMalUsername(req.db, username.trim(), {
        erase: erase === true,
        useOfflineDb: useOfflineDb !== false,
        skipFallback: skipFallback === true,
      })
      res.json({ success: true, count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      if (message.includes('private') || message.includes('not found')) {
        return res.status(404).json({ error: message })
      }
      if (message.includes('blocked') || message.includes('HTTP 429')) {
        return res.status(429).json({ error: message })
      }
      res.status(500).json({ error: message })
    }
  })

  router.post('/tracker/manga/sync', async (req, res) => {
    const { direction } = req.body ?? {}
    try {
      if (!req.mangaDb || req.mangaDb.isClosedCheck()) {
        return res.status(503).json({ error: 'Manga database is not ready' })
      }
      const syncDirection = direction === 'pull-only' ? 'pull-only' : 'two-way'
      const result = await syncAniListManga(req.db, req.mangaDb, {
        direction: syncDirection,
      })
      res.json({
        success: true,
        summary: result.summary,
        details: result.details,
        direction: syncDirection,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Manga sync failed'
      res.status(500).json({ error: message })
    }
  })

  router.post('/tracker/manga/import', async (req, res) => {
    const { username, erase } = req.body ?? {}
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' })
    }
    try {
      if (!req.mangaDb || req.mangaDb.isClosedCheck()) {
        return res.status(503).json({ error: 'Manga database is not ready' })
      }
      const count = await importFromUsernameManga(
        req.db,
        req.mangaDb,
        username.trim(),
        erase === true
      )
      res.json({ success: true, count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      res.status(500).json({ error: message })
    }
  })

  router.post('/tracker/manga/mal-import', async (req, res) => {
    const { username, erase } = req.body ?? {}
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'MAL username is required' })
    }
    try {
      if (!req.mangaDb || req.mangaDb.isClosedCheck()) {
        return res.status(503).json({ error: 'Manga database is not ready' })
      }
      const result = await importMangaFromMalUsername(
        req.db,
        req.mangaDb,
        username.trim(),
        erase === true
      )
      res.json({ success: true, ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      if (message.includes('private') || message.includes('not found')) {
        return res.status(404).json({ error: message })
      }
      if (message.includes('blocked') || message.includes('HTTP 429')) {
        return res.status(429).json({ error: message })
      }
      res.status(500).json({ error: message })
    }
  })

  router.post('/import/mal-xml-manga', multer().single('xmlfile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' })
    const eraseRaw = req.body?.erase
    const erase = eraseRaw === true || eraseRaw === 'true' || eraseRaw === '1'
    try {
      if (!req.mangaDb || req.mangaDb.isClosedCheck()) {
        return res.status(503).json({ error: 'Manga database is not ready' })
      }
      let result: { myanimelist?: { manga?: Record<string, MangaXmlVal>[] } }
      try {
        result = malMangaXmlParser.parse(req.file.buffer.toString()) as {
          myanimelist?: { manga?: Record<string, MangaXmlVal>[] }
        }
      } catch {
        return res.status(400).json({ error: 'Invalid XML' })
      }
      const mangaList = result?.myanimelist?.manga || []
      if (mangaList.length === 0) {
        return res.status(400).json({ error: 'No manga found in XML' })
      }
      const items: MalXmlMangaItem[] = mangaList.map((item) => ({
        malId: parseInt(mangaXmlText(item.series_mangadb_id), 10) || 0,
        title: mangaXmlText(item.series_title),
        status: mapMalMangaXmlStatus(mangaXmlText(item.my_status)),
        chapters: Math.max(parseInt(mangaXmlText(item.my_read_chapters), 10) || 0, 0),
      }))
      const { imported, skipped } = await importMangaFromMalXmlItems(
        req.db,
        req.mangaDb,
        items,
        erase
      )
      res.json({ success: true, imported, skipped })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      res.status(500).json({ error: message })
    }
  })

  return router
}
