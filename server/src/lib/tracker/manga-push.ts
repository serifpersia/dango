import type { DatabaseWrapper } from '../../db.js'
import { MangaLibraryRepository } from '../../repositories/manga.repository.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { AniListTracker } from './anilist-tracker.js'
import { MalTracker } from './mal-tracker.js'
import { activeTracker } from './episode-push.js'
import { withTrackerLock } from './sync-lock.js'
import { withTrackerWrite } from './tracker-activity.js'
import {
  getLocalChapterProgress,
  isExactTitleMatch,
  parseAnilistMangaId,
} from './manga-sync/resolve.js'
import { matchesTitle as matchesMalMangaTitle, parseMalMangaId } from './mal-manga-sync.service.js'
import { searchAnilistMangaByTitle } from '../anilist/index.js'
import { readTrackerSyncState } from './sync-state.js'
import { clearRewatching } from './rewatch.js'
import logger from '../../logger.js'
import {
  performMangaWriteTransactionAsync,
  performWriteTransactionAsync,
} from '../../db/transaction.js'

export async function pushMangaEntry(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  id: string
): Promise<void> {
  try {
    const { provider, token } = await activeTracker(db)
    if (!provider) return
    await withTrackerLock(db, provider, async () => {
      const item = await MangaLibraryRepository.getById(mangaDb, id)
      if (!item) return
      let mediaId: number | undefined
      const anilist = new AniListTracker(token)
      const mal = new MalTracker(db)
      if (provider === 'anilist') {
        mediaId = item.anilistId || parseAnilistMangaId(id) || undefined
        if (!mediaId) {
          const match = await searchAnilistMangaByTitle(item.title)
          if (!match || !isExactTitleMatch(item, match.title)) return
          mediaId = match.id
          const linkedId = mediaId
          await performMangaWriteTransactionAsync(mangaDb, async (tx) => {
            await MangaLibraryRepository.setAnilistId(tx, id, linkedId, 'search')
          })
        }
      } else {
        mediaId =
          parseMalMangaId(id) ||
          Number((await SettingsRepository.getByKey(db, `tracker_mal_manga_link_${id}`))?.value) ||
          undefined
        if (!mediaId) {
          const match = (await mal.searchManga(item.title)).find((candidate) =>
            matchesMalMangaTitle(item, candidate)
          )
          if (!match) return
          mediaId = match.id
          await SettingsRepository.upsert(db, `tracker_mal_manga_link_${id}`, String(mediaId))
        }
      }
      const remoteProgress =
        provider === 'mal'
          ? (await mal.getManga(mediaId)).my_list_status?.num_chapters_read
          : (await anilist.getMediaEntry(mediaId))?.mediaListEntry?.progress
      const latest = await MangaLibraryRepository.getById(mangaDb, id)
      if (!latest) return
      const progress = Math.max(
        await getLocalChapterProgress(mangaDb, id, item.lastChapterNumber),
        remoteProgress || 0
      )
      if (provider === 'mal')
        await mal.updateManga(mediaId, progress, latest.status, { rewatching: false })
      else
        await withTrackerWrite(db, provider, () =>
          anilist.updateMediaEntry({ mediaId, progress, status: latest.status })
        )
      if (progress > 0)
        await performMangaWriteTransactionAsync(mangaDb, async (tx) => {
          await MangaLibraryRepository.setProgressPointer(tx, id, String(progress))
        })
      const key = `tracker_${provider}_manga_sync_state`
      const state = await readTrackerSyncState(db, key)
      const now = Math.floor(Date.now() / 1000)
      state[String(mediaId)] = { lastSyncedAt: now, remoteUpdatedAt: now }
      await performWriteTransactionAsync(db, async (tx) => {
        await clearRewatching(tx, provider, id)
        await SettingsRepository.upsert(tx, key, JSON.stringify(state))
      })
    })
  } catch (err) {
    logger.warn({ err, id }, '[AutoSync] Manga entry sync failed; local status kept')
  }
}
