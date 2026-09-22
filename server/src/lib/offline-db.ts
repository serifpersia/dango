import crypto from 'crypto'
import { DatabaseWrapper } from '../db.js'
import logger from '../logger.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import { decodeMaybeGzip } from '../utils/http.utils.js'

const log = logger.child({ module: 'OfflineDb' })

const OFFLINE_DB_URLS = [
  'https://github.com/cedya77/anime-offline-database/releases/latest/download/anime-offline-database-minified.json',
  'https://raw.githubusercontent.com/cedya77/anime-offline-database/master/anime-offline-database-minified.json',
  'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json',
  'https://raw.githubusercontent.com/manami-project/anime-offline-database/master/anime-offline-database-minified.json',
]

const FETCH_IDLE_TIMEOUT_MS = 60000
const FETCH_OVERALL_TIMEOUT_MS = 30 * 60 * 1000
const MAX_BODY_BYTES = 100 * 1024 * 1024
const CHUNK_SIZE = 1000
const INTERRUPTED_RETRY_COOLDOWN_MS = 60 * 60 * 1000

const CANONICAL_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
]

const canonicalGenreMap = new Map(CANONICAL_GENRES.map((g) => [g.toLowerCase(), g]))

export interface OfflineEntry {
  anilistId: number
  malId: number
  title: string
  thumbnail?: string
  type?: string
  genres?: string
}

export interface OfflineDbInfo {
  totalMapped: number
  totalMalMapped: number
  isInitialized: boolean
  isRefreshing: boolean
  autoUpdateEnabled: boolean
  lastCheckedAt: string | null
  lastUpdatedAt: string | null
  lastStatus: 'idle' | 'updating' | 'success' | 'failed'
  lastMessage: string | null
  sourceUrl: string | null
  releaseTag: string | null
  contentSha256: string | null
  entryCount: number
  schemaVersion: number
  nextDueAt: string | null
}

const SCHEMA_VERSION = 1
const TABLE = 'anime_id_map'
const STAGING_TABLE = 'anime_id_map_new'

function ensureTable(db: DatabaseWrapper, table: string = TABLE): void {
  const row = db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [table]
  )
  if (!row) {
    db.run(
      `CREATE TABLE ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, anilist_id INTEGER, mal_id INTEGER, title TEXT, thumbnail TEXT, type TEXT, genres TEXT)`
    )
  } else {
    const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`)
    const names = new Set(columns.map((c) => c.name))
    if (!names.has('mal_id')) db.run(`ALTER TABLE ${table} ADD COLUMN mal_id INTEGER`)
    if (!names.has('type')) db.run(`ALTER TABLE ${table} ADD COLUMN type TEXT`)
    if (!names.has('genres')) db.run(`ALTER TABLE ${table} ADD COLUMN genres TEXT`)
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_anime_id_map_anilist ON ${table}(anilist_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_anime_id_map_mal ON ${table}(mal_id)`)
}

function latestSaturdayUtc(): Date {
  const now = new Date()
  const daysSinceSaturday = (now.getUTCDay() + 1) % 7
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceSaturday,
      0,
      0,
      0,
      0
    )
  )
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const overall = setTimeout(() => controller.abort(), FETCH_OVERALL_TIMEOUT_MS)
  let idle: ReturnType<typeof setTimeout> | undefined
  const touchIdle = (): void => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => controller.abort(), FETCH_IDLE_TIMEOUT_MS)
  }
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Dango-Media-Client/1.0', Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const length = res.headers.get('content-length')
    if (length && Number(length) > MAX_BODY_BYTES) throw new Error('Response too large')
    if (!res.body) throw new Error('Empty response body')
    touchIdle()
    const chunks: Buffer[] = []
    let total = 0
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        touchIdle()
        total += value.byteLength
        if (total > MAX_BODY_BYTES) throw new Error('Response too large')
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    const text = decodeMaybeGzip(Buffer.concat(chunks)).toString('utf8')
    if (text.length > MAX_BODY_BYTES) throw new Error('Response too large')
    return text
  } finally {
    if (idle) clearTimeout(idle)
    clearTimeout(overall)
  }
}

class OfflineDb {
  private malToEntry = new Map<number, OfflineEntry>()
  private anilistToMal = new Map<number, number>()
  private anilistToEntry = new Map<number, OfflineEntry>()
  private isInitialized = false
  private isRefreshing = false

  async init(db: DatabaseWrapper): Promise<void> {
    try {
      ensureTable(db)
      this.loadCache(db)
      log.info(`OfflineDb loaded ${this.malToEntry.size} MAL mappings from SQLite`)
      const wasInterrupted =
        SettingsRepository.getByKey(db, 'offlineDbLastStatus')?.value === 'updating'
      const autoUpdateSetting = SettingsRepository.getByKey(db, 'offlineDbAutoUpdateEnabled')
      const autoUpdateEnabled = !autoUpdateSetting || autoUpdateSetting.value !== 'false'
      this.backfillShowsMetaGenres(db)

      if (this.malToEntry.size === 0) {
        log.info('OfflineDb cache is empty. Starting background download...')
        this.refreshDatabase(db).catch((err) => {
          log.warn({ err: err?.message }, 'Background offline database download failed')
        })
      } else if (wasInterrupted && autoUpdateEnabled && this.interruptedRetryDue(db)) {
        log.info('Previous offline database refresh was interrupted. Retrying in background...')
        SettingsRepository.upsert(db, 'offlineDbLastStatus', 'idle')
        SettingsRepository.upsert(
          db,
          'offlineDbLastMessage',
          'Previous refresh was interrupted by a restart. Retrying automatically...'
        )
        this.refreshDatabase(db).catch((err) => {
          log.warn({ err: err?.message }, 'Interrupted offline database retry failed')
        })
      } else if (wasInterrupted) {
        SettingsRepository.upsert(db, 'offlineDbLastStatus', 'idle')
        SettingsRepository.upsert(
          db,
          'offlineDbLastMessage',
          'Previous refresh was interrupted by a restart. Trigger an update to retry.'
        )
      }
      this.isInitialized = true
    } catch (e) {
      log.error({ err: e }, 'Failed to initialize OfflineDb')
    }
  }

  backfillShowsMetaGenres(db: DatabaseWrapper): number {
    try {
      ensureTable(db)
      db.run(`
        UPDATE shows_meta
        SET genres = (
          SELECT genres FROM ${TABLE}
          WHERE anilist_id = CAST(shows_meta.id AS INTEGER)
            AND genres IS NOT NULL AND genres != '[]'
          LIMIT 1
        )
        WHERE (genres IS NULL OR genres = '' OR genres = '[]')
          AND EXISTS (
            SELECT 1 FROM ${TABLE}
            WHERE anilist_id = CAST(shows_meta.id AS INTEGER)
              AND genres IS NOT NULL AND genres != '[]'
          )
      `)
      return 1
    } catch (err) {
      log.warn({ err }, 'Failed to backfill shows_meta genres from offline db')
      return 0
    }
  }

  private loadCache(db: DatabaseWrapper): void {
    try {
      ensureTable(db)
      const rows = db.all<{
        anilist_id: number | null
        mal_id: number | null
        title: string | null
        thumbnail: string | null
        type: string | null
        genres: string | null
      }>(
        `SELECT anilist_id, mal_id, title, thumbnail, type, genres FROM ${TABLE} WHERE anilist_id IS NOT NULL AND mal_id IS NOT NULL`
      )
      this.malToEntry.clear()
      this.anilistToMal.clear()
      this.anilistToEntry.clear()
      for (const row of rows) {
        if (!row.anilist_id || !row.mal_id) continue
        const entry: OfflineEntry = {
          anilistId: row.anilist_id,
          malId: row.mal_id,
          title: row.title || '',
          thumbnail: row.thumbnail || undefined,
          type: row.type || undefined,
          genres: row.genres || undefined,
        }
        this.malToEntry.set(row.mal_id, entry)
        this.anilistToMal.set(row.anilist_id, row.mal_id)
        this.anilistToEntry.set(row.anilist_id, entry)
      }
    } catch (err) {
      log.error({ err }, 'Failed to load offline mappings into memory')
    }
  }

  getByMalId(malId: number): OfflineEntry | null {
    return this.malToEntry.get(malId) ?? null
  }

  getByAnilistId(anilistId: number): OfflineEntry | null {
    return this.anilistToEntry.get(anilistId) ?? null
  }

  getAnilistIdByMal(malId: number): number | null {
    return this.malToEntry.get(malId)?.anilistId ?? null
  }

  getMalIdByAnilist(anilistId: number): number | null {
    return this.anilistToMal.get(anilistId) ?? null
  }

  getOfflineDbInfo(db: DatabaseWrapper): OfflineDbInfo {
    const get = (key: string) => SettingsRepository.getByKey(db, key)?.value ?? null
    const autoUpdate = get('offlineDbAutoUpdateEnabled')
    const lastStatus = get('offlineDbLastStatus') as OfflineDbInfo['lastStatus'] | null
    const entryCount = Number(get('offlineDbEntryCount') ?? this.malToEntry.size) || 0
    return {
      totalMapped: this.malToEntry.size,
      totalMalMapped: this.malToEntry.size,
      isInitialized: this.isInitialized,
      isRefreshing: this.isRefreshing,
      autoUpdateEnabled: autoUpdate ? autoUpdate !== 'false' : true,
      lastCheckedAt: get('offlineDbLastCheckedAt'),
      lastUpdatedAt: get('offlineDbLastUpdatedAt'),
      lastStatus: lastStatus || (this.isRefreshing ? 'updating' : 'idle'),
      lastMessage: get('offlineDbLastMessage'),
      sourceUrl: get('offlineDbSourceUrl'),
      releaseTag: get('offlineDbReleaseTag'),
      contentSha256: get('offlineDbContentSha256'),
      entryCount,
      schemaVersion: SCHEMA_VERSION,
      nextDueAt: latestSaturdayUtc().toISOString(),
    }
  }

  checkWeeklyUpdateDue(db: DatabaseWrapper): boolean {
    const autoUpdate = SettingsRepository.getByKey(db, 'offlineDbAutoUpdateEnabled')
    if (autoUpdate && autoUpdate.value === 'false') return false
    const lastChecked = SettingsRepository.getByKey(db, 'offlineDbLastCheckedAt')
    if (!lastChecked?.value) return true
    const lastCheckedTime = new Date(lastChecked.value).getTime()
    if (Number.isNaN(lastCheckedTime)) return true
    return lastCheckedTime < latestSaturdayUtc().getTime()
  }

  private interruptedRetryDue(db: DatabaseWrapper): boolean {
    const lastChecked = SettingsRepository.getByKey(db, 'offlineDbLastCheckedAt')
    if (!lastChecked?.value) return true
    const lastCheckedTime = new Date(lastChecked.value).getTime()
    if (Number.isNaN(lastCheckedTime)) return true
    return Date.now() - lastCheckedTime > INTERRUPTED_RETRY_COOLDOWN_MS
  }

  async executeScheduledUpdate(db: DatabaseWrapper): Promise<void> {
    if (this.isRefreshing) {
      log.info('Scheduled offline database update skipped: refresh already in progress')
      return
    }
    log.info('Starting scheduled weekly offline database update...')
    const result = await this.refreshDatabase(db)
    if (result.success)
      log.info(`Scheduled offline database update succeeded: ${result.count} entries`)
    else log.warn(`Scheduled offline database update failed: ${result.error}`)
  }

  async refreshDatabase(
    db: DatabaseWrapper
  ): Promise<{ success: boolean; count: number; error?: string }> {
    if (this.isRefreshing) {
      return { success: false, count: this.malToEntry.size, error: 'Refresh already in progress' }
    }
    this.isRefreshing = true
    const startedAt = Date.now()
    SettingsRepository.upsert(db, 'offlineDbLastStatus', 'updating')
    SettingsRepository.upsert(db, 'offlineDbLastCheckedAt', new Date().toISOString())
    SettingsRepository.upsert(db, 'offlineDbLastMessage', 'Downloading and parsing database...')

    try {
      let text: string | null = null
      let sourceUrl: string | null = null
      let lastErr: Error | null = null
      for (const url of OFFLINE_DB_URLS) {
        try {
          log.info(`Fetching anime-offline-database from ${url}...`)
          text = await fetchText(url)
          const parsed = JSON.parse(text)
          if (parsed && Array.isArray(parsed.data)) {
            sourceUrl = url
            break
          }
          text = null
        } catch (err) {
          lastErr = err as Error
          log.warn(`Failed downloading from ${url}: ${(err as Error).message}`)
        }
      }
      if (!text)
        throw lastErr || new Error('Could not download anime-offline-database from any source')

      const sha256 = crypto.createHash('sha256').update(text).digest('hex')
      const storedSha = SettingsRepository.getByKey(db, 'offlineDbContentSha256')?.value
      const data = (JSON.parse(text) as { data: unknown[] }).data
      log.info(`Parsing ${data.length} entries from anime-offline-database...`)

      const anilistRegex = /anilist\.co\/anime\/(\d+)/i
      const malRegex = /myanimelist\.net\/anime\/(\d+)/i
      const parsedEntries: OfflineEntry[] = []

      for (const item of data) {
        const rec = item as {
          sources?: unknown
          title?: unknown
          thumbnail?: unknown
          picture?: unknown
          type?: unknown
          tags?: unknown
        }
        if (!Array.isArray(rec.sources)) continue
        let anilistId: number | null = null
        let malId: number | null = null
        for (const src of rec.sources) {
          if (typeof src !== 'string') continue
          const anilistMatch = src.match(anilistRegex)
          if (anilistMatch) anilistId = parseInt(anilistMatch[1], 10)
          const malMatch = src.match(malRegex)
          if (malMatch) malId = parseInt(malMatch[1], 10)
        }
        if (!anilistId || !malId) continue

        let thumbnail =
          typeof rec.thumbnail === 'string'
            ? rec.thumbnail
            : typeof rec.picture === 'string'
              ? rec.picture
              : ''
        if (thumbnail.includes('cdn.myanimelist.net/images/anime/')) {
          thumbnail = thumbnail.replace(/t\.(jpe?g|png|webp)$/i, 'l.$1')
        }

        let genres: string | undefined
        if (Array.isArray(rec.tags)) {
          const matched = new Set<string>()
          for (const tag of rec.tags) {
            if (typeof tag !== 'string') continue
            const canonical = canonicalGenreMap.get(tag.trim().toLowerCase())
            if (canonical) matched.add(canonical)
          }
          if (matched.size > 0) genres = JSON.stringify([...matched])
        }

        parsedEntries.push({
          anilistId,
          malId,
          title: typeof rec.title === 'string' ? rec.title : '',
          thumbnail: thumbnail || undefined,
          type: typeof rec.type === 'string' ? rec.type : undefined,
          genres,
        })
      }

      log.info(`Saving ${parsedEntries.length} mapped entries to SQLite...`)
      db.run(`DROP TABLE IF EXISTS ${STAGING_TABLE}`)
      ensureTable(db, STAGING_TABLE)
      const stmt = db.prepare(
        `INSERT INTO ${STAGING_TABLE} (anilist_id, mal_id, title, thumbnail, type, genres) VALUES (?, ?, ?, ?, ?, ?)`
      )
      for (let i = 0; i < parsedEntries.length; i += CHUNK_SIZE) {
        const chunk = parsedEntries.slice(i, i + CHUNK_SIZE)
        db.serialize(() => {
          for (const entry of chunk) {
            stmt.run(
              entry.anilistId,
              entry.malId,
              entry.title,
              entry.thumbnail ?? null,
              entry.type ?? null,
              entry.genres ?? null
            )
          }
        })
        await new Promise((resolve) => setImmediate(resolve))
      }
      db.run(`DROP TABLE IF EXISTS ${TABLE}`)
      db.run(`ALTER TABLE ${STAGING_TABLE} RENAME TO ${TABLE}`)
      ensureTable(db)

      this.loadCache(db)
      this.backfillShowsMetaGenres(db)

      const releaseTag = sourceUrl?.includes('/releases/') ? 'latest' : 'raw'
      SettingsRepository.upsert(db, 'offlineDbLastStatus', 'success')
      SettingsRepository.upsert(db, 'offlineDbLastUpdatedAt', new Date().toISOString())
      SettingsRepository.upsert(db, 'offlineDbSourceUrl', sourceUrl ?? '')
      SettingsRepository.upsert(db, 'offlineDbReleaseTag', releaseTag)
      SettingsRepository.upsert(db, 'offlineDbContentSha256', sha256)
      SettingsRepository.upsert(db, 'offlineDbEntryCount', String(parsedEntries.length))
      const skipped = storedSha === sha256
      SettingsRepository.upsert(
        db,
        'offlineDbLastMessage',
        `Updated ${parsedEntries.length} entries in ${Math.round((Date.now() - startedAt) / 1000)}s${skipped ? ' (unchanged upstream hash)' : ''}.`
      )
      log.info(`OfflineDb refresh completed: ${parsedEntries.length} entries from ${sourceUrl}`)
      return { success: true, count: parsedEntries.length }
    } catch (err) {
      const errMsg = (err as Error).message || 'Failed to refresh offline database'
      log.error({ err }, 'Failed to refresh anime-offline-database')
      SettingsRepository.upsert(db, 'offlineDbLastStatus', 'failed')
      SettingsRepository.upsert(db, 'offlineDbLastMessage', errMsg)
      return { success: false, count: this.malToEntry.size, error: errMsg }
    } finally {
      this.isRefreshing = false
    }
  }
}

export const offlineDb = new OfflineDb()
