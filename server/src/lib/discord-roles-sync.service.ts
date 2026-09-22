import { DatabaseWrapper } from '../db.js'
import logger from '../logger.js'
import { CONFIG } from '../config.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import { InsightsRepository } from '../repositories/insights.repository.js'
import { parseJsonBody } from '../utils/http.utils.js'

export interface LinkedDiscordUser {
  id: string
  username: string
  avatar: string | null
}

interface CoreStats {
  totalSeconds?: number
}

interface WatchedShowMeta {
  genres: string
}

const SETTING_KEY = 'discordLinkedUser'
const SYNC_INTERVAL_MS = 10 * 60 * 1000

let syncTimer: NodeJS.Timeout | null = null
let lastSyncedSeconds: number | null = null

export async function getLinkedDiscordUser(db: DatabaseWrapper): Promise<LinkedDiscordUser | null> {
  const row = await SettingsRepository.getByKey(db, SETTING_KEY)
  if (!row?.value) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

export async function setLinkedDiscordUser(
  db: DatabaseWrapper,
  user: LinkedDiscordUser | null
): Promise<void> {
  if (!user) {
    await SettingsRepository.deleteByKey(db, SETTING_KEY)
    lastSyncedSeconds = null
  } else {
    await SettingsRepository.upsert(db, SETTING_KEY, JSON.stringify(user))
  }
}

export async function computeDiscordSyncStats(db: DatabaseWrapper): Promise<{
  totalSeconds: number
  topGenre: string
  genres: string[]
}> {
  const [core, watchedShows] = (await Promise.all([
    InsightsRepository.getCoreStats(db),
    InsightsRepository.getWatchedShowsMeta(db),
  ])) as [CoreStats, WatchedShowMeta[]]

  const genreCounts: Record<string, number> = {}
  for (const show of watchedShows) {
    if (!show.genres) continue
    let genres: string[] = []
    try {
      genres = show.genres.startsWith('[')
        ? JSON.parse(show.genres)
        : show.genres.split(',').map((g: string) => g.trim())
    } catch {
      // ignore
    }
    for (const g of genres) {
      genreCounts[g] = (genreCounts[g] || 0) + 1
    }
  }

  const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  const genres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)
  return {
    totalSeconds: core?.totalSeconds || 0,
    topGenre,
    genres,
  }
}

export async function syncDiscordRoles(
  db: DatabaseWrapper,
  force = false
): Promise<{
  success: boolean
  message: string
  skipped?: boolean
  dere?: string[]
  code?: string
  failures?: Array<{
    action: string
    roleId: string | null
    label: string
    status: number
    error: string
  }>
}> {
  const workerUrl = CONFIG.DISCORD_ROLES_WORKER_URL
  if (!workerUrl) {
    return { success: false, message: 'DISCORD_ROLES_WORKER_URL not configured' }
  }

  const user = await getLinkedDiscordUser(db)
  if (!user) {
    return { success: false, message: 'No Discord user linked in database' }
  }

  const { totalSeconds, topGenre, genres } = await computeDiscordSyncStats(db)

  if (!force && lastSyncedSeconds !== null && totalSeconds === lastSyncedSeconds) {
    return { success: true, message: 'Watch time unchanged, skipped sync', skipped: true }
  }

  try {
    const res = await fetch(`${workerUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discordId: user.id,
        username: user.username,
        totalSeconds,
        topGenre,
        genres,
        force,
      }),
    })

    const data = (await parseJsonBody(res).catch(() => ({}))) as {
      error?: string
      message?: string
      rank?: string
      dere?: string[]
      code?: string
      failures?: Array<{
        action: string
        roleId: string | null
        label: string
        status: number
        error: string
      }>
    }
    if (!res.ok || data.error) {
      logger.warn(
        { error: data.error || res.statusText, code: data.code, failures: data.failures },
        'Discord role sync returned error'
      )
      return {
        success: false,
        message: data.error || 'Worker sync failed',
        code: data.code,
        failures: data.failures,
      }
    }

    lastSyncedSeconds = totalSeconds
    logger.info(
      {
        user: user.username,
        rank: data.rank,
        dere: data.dere,
        totalHours: Math.round(totalSeconds / 3600),
      },
      'Discord roles synced successfully'
    )
    return { success: true, message: data.message || 'Roles synced', dere: data.dere }
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'Failed to communicate with Discord roles worker')
    return { success: false, message: (err as Error)?.message || 'Network error' }
  }
}

export function initDiscordRolesSync(db: DatabaseWrapper): void {
  const workerUrl = CONFIG.DISCORD_ROLES_WORKER_URL
  if (!workerUrl) return

  setTimeout(() => {
    syncDiscordRoles(db).catch((err) => {
      logger.warn({ err: err?.message }, 'Startup Discord roles sync failed')
    })
  }, 5000).unref()

  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval(() => {
    syncDiscordRoles(db).catch((err) => {
      logger.warn({ err: err?.message }, 'Periodic Discord roles sync failed')
    })
  }, SYNC_INTERVAL_MS)
  syncTimer.unref()
}
