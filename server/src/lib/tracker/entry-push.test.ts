import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDbs } from '../../test-helpers.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { MangaLibraryRepository } from '../../repositories/manga.repository.js'
import { pushCompletedEpisode } from './episode-push.js'
import { pushMangaEntry } from './manga-push.js'
import { completedProgress } from './episode-sync.js'
import { AniListTracker } from './anilist-tracker.js'
import { MalTracker } from './mal-tracker.js'
import { subscribeTrackerActivity } from './tracker-activity.js'

for (const provider of ['anilist', 'mal'] as const) {
  test(`${provider}: single-entry playback imports remote membership, preserves progress, and gates writes`, async (t) => {
    const { db, cleanup } = await createTestDbs()
    t.after(cleanup)
    await SettingsRepository.upsert(
      db,
      provider === 'mal' ? 'tracker_mal_tokens' : 'tracker_anilist_token',
      'test'
    )
    const id = provider === 'mal' ? 'mal-42' : '42'
    let present = false
    let progress = 0
    let fail = false
    const writes: { progress: number; status?: string }[] = []
    t.mock.method(AniListTracker.prototype, 'getMediaEntry', async () => {
      if (fail) throw new Error('lookup failed')
      return {
        title: { english: 'Example' },
        mediaListEntry: present ? { status: 'CURRENT', progress, updatedAt: 1 } : null,
      }
    })
    t.mock.method(MalTracker.prototype, 'getAnime', async () => {
      if (fail) throw new Error('lookup failed')
      return {
        id: 42,
        title: 'Example',
        my_list_status: present
          ? { status: 'watching', num_episodes_watched: progress, updated_at: '2026-01-01' }
          : undefined,
      }
    })
    t.mock.method(
      AniListTracker.prototype,
      'updateMediaEntry',
      async (value: { progress: number; status: string }) => {
        writes.push(value)
      }
    )
    t.mock.method(
      MalTracker.prototype,
      'update',
      async (_id: number, value: number, status: string) => {
        writes.push({ progress: value, status })
      }
    )
    const activity: boolean[] = []
    const unsubscribe = subscribeTrackerActivity(db, (event) => activity.push(event.updating))
    t.after(unsubscribe)
    await WatchedEpisodesRepository.markCompleted(db, { showId: id, episodeNumber: '3' })
    await pushCompletedEpisode(db, id, '3')
    assert.equal(await WatchlistRepository.getById(db, id), undefined)
    assert.equal(writes.length, 0)
    assert.ok(!activity.includes(true))

    present = true
    progress = 5
    await pushCompletedEpisode(db, id, '4')
    assert.equal((await WatchlistRepository.getById(db, id))?.name, 'Example')
    assert.equal(await completedProgress(db, id), 5)
    assert.equal(writes.length, 0)

    await WatchlistRepository.updateStatus(db, id, 'Dropped')
    await pushCompletedEpisode(db, id)
    assert.deepEqual(
      writes.at(-1),
      provider === 'mal'
        ? { progress: 5, status: 'Dropped' }
        : { mediaId: 42, progress: 5, status: 'Dropped' }
    )

    await WatchlistRepository.updateStatus(db, id, 'On-Hold')
    fail = true
    const count = writes.length
    await pushCompletedEpisode(db, id)
    assert.equal(writes.length, count)
    assert.equal((await WatchlistRepository.getById(db, id))?.status, 'On-Hold')
    fail = false
    present = false
    await pushCompletedEpisode(db, id)
    assert.equal(writes.at(-1)?.status, 'On-Hold')
    assert.equal(writes.at(-1)?.progress, 5)
  })

  test(`${provider}: manga status creates one remote entry without losing remote chapter progress`, async (t) => {
    const { db, mangaDb, cleanup } = await createTestDbs()
    t.after(cleanup)
    await SettingsRepository.upsert(
      db,
      provider === 'mal' ? 'tracker_mal_tokens' : 'tracker_anilist_token',
      'test'
    )
    const id = `${provider}:42`
    await MangaLibraryRepository.upsert(mangaDb, {
      id,
      provider,
      mangaId: '42',
      title: 'Manga',
      cover: '',
      status: 'Completed',
    })
    await MangaLibraryRepository.setProgressPointer(mangaDb, id, '3')
    t.mock.method(AniListTracker.prototype, 'getMediaEntry', async () => ({
      mediaListEntry: { progress: 8 },
    }))
    t.mock.method(MalTracker.prototype, 'getManga', async () => ({
      my_list_status: { num_chapters_read: 8 },
    }))
    const writes: { progress: number; status: string }[] = []
    t.mock.method(
      AniListTracker.prototype,
      'updateMediaEntry',
      async (value: { progress: number; status: string }) => {
        writes.push(value)
      }
    )
    t.mock.method(
      MalTracker.prototype,
      'updateManga',
      async (_id: number, progress: number, status: string) => {
        writes.push({ progress, status })
      }
    )
    await pushMangaEntry(db, mangaDb, id)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].progress, 8)
    assert.equal(writes[0].status, 'Completed')
    assert.equal((await MangaLibraryRepository.getById(mangaDb, id))?.lastChapterNumber, '8')
  })
}
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { setTimeout as delay } from 'node:timers/promises'
import { router } from '../../trpc/index.js'
import type { TrpcContext } from '../../trpc/context.js'
import { watchlistRouter } from '../../trpc/routers/watchlist.js'
import { mangaLibraryRouter } from '../../trpc/routers/manga-library.js'
import { progressRouter } from '../../trpc/routers/progress.js'
import { AppCache } from '../../utils/cache.utils.js'
import { discordRPCService } from '../../discord-rpc.js'
import { offlineDb } from '../offline-db/index.js'
import { malCacheStore } from '../../repositories/mal-cache.repository.js'
import { withTrackerLock } from './sync-lock.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'

for (const provider of ['anilist', 'mal'] as const) {
  test(`${provider}: HTTP mutations sync anime/manga adds, status changes, batches and playback retries`, async (t) => {
    const dbs = await createTestDbs()
    const { db } = dbs
    t.after(dbs.cleanup)
    await ShowsMetaRepository.upsert(db, { id: '42', anilistId: 42 })
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('Unexpected network request')
    })
    t.mock.method(discordRPCService, 'updatePresence', async () => {})
    const ctx: TrpcContext = {
      ...dbs,
      lanAuthed: true,
      apiCache: new AppCache(),
      getTvProvider: () => undefined,
      getMangaProvider: () => undefined,
      getJasmr: () => undefined,
      getProviders: () => ({}),
      getCatalog: () => [],
      discordRPC: discordRPCService,
      offlineDb,
      malCacheStore,
    }
    const api = router({
      watchlist: watchlistRouter,
      mangaLibrary: mangaLibraryRouter,
      progress: progressRouter,
    })
    const writes: { status?: string; progress?: number }[] = []
    let fail = false
    t.mock.method(AniListTracker.prototype, 'getMediaEntry', async () => {
      if (fail) throw new Error('offline')
      return { title: { english: 'Example' }, mediaListEntry: null }
    })
    t.mock.method(MalTracker.prototype, 'getAnime', async () => {
      if (fail) throw new Error('offline')
      return { id: 42, title: 'Example' }
    })
    t.mock.method(MalTracker.prototype, 'getManga', async () => ({ id: 42, title: 'Manga' }))
    t.mock.method(
      AniListTracker.prototype,
      'updateMediaEntry',
      async (value: { status?: string; progress?: number }) => {
        writes.push(value)
      }
    )
    for (const method of ['update', 'updateManga'] as const)
      t.mock.method(
        MalTracker.prototype,
        method,
        async (_id: number, progress: number, status: string) => {
          writes.push({ progress, status })
        }
      )
    await SettingsRepository.upsert(
      db,
      provider === 'mal' ? 'tracker_mal_tokens' : 'tracker_anilist_token',
      'test'
    )
    await SettingsRepository.upsert(db, 'tracker_mal_link_42', '42')
    const post = async (path: string, input: unknown) => {
      const response = await fetchRequestHandler({
        endpoint: '/api/trpc',
        req: new Request(`http://localhost/api/trpc/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
        router: api,
        createContext: () => ctx,
      })
      assert.equal(response.status, 200, await response.text())
    }
    const flushed = async (count: number) => {
      for (let n = 0; writes.length < count && n < 100; n++) await delay(5)
      assert.equal(writes.length, count)
      await withTrackerLock(db, provider, async () => {})
    }
    await post('watchlist.add', { id: '42', name: 'Example', status: 'Watching' })
    await flushed(1)
    await post('watchlist.setStatus', { id: '42', status: 'Completed' })
    await flushed(2)
    assert.equal(writes.at(-1)?.status, 'Completed')
    await post('watchlist.batchStatus', { ids: ['42'], status: 'On-Hold' })
    await flushed(3)
    assert.equal(writes.at(-1)?.status, 'On-Hold')
    await post('mangaLibrary.add', { provider, mangaId: '42', title: 'Manga', status: 'Reading' })
    await flushed(4)
    await post('mangaLibrary.setStatus', { id: `${provider}:42`, status: 'Completed' })
    await flushed(5)
    await post('mangaLibrary.batchStatus', { ids: [`${provider}:42`], status: 'Dropped' })
    await flushed(6)
    assert.equal(writes.at(-1)?.status, 'Dropped')

    fail = true
    let now = Date.now()
    t.mock.method(Date, 'now', () => now)
    const playback = {
      showId: '42',
      episodeNumber: '2',
      currentTime: 81,
      duration: 100,
      showName: 'Example',
    }
    await post('progress.updateProgress', playback)
    await delay(10)
    await withTrackerLock(db, provider, async () => {})
    assert.equal(writes.length, 6)
    fail = false
    now += 31000
    await post('progress.updateProgress', playback)
    await flushed(7)
    assert.equal(writes.at(-1)?.progress, 2)
    assert.equal(writes.at(-1)?.status, 'On-Hold')
    await post('progress.updateProgress', playback)
    await delay(10)
    assert.equal(writes.length, 7)
  })

  test(`${provider}: rewatches send the current episode and finish as Completed`, async (t) => {
    const { db, cleanup } = await createTestDbs()
    t.after(cleanup)
    await SettingsRepository.upsert(
      db,
      provider === 'mal' ? 'tracker_mal_tokens' : 'tracker_anilist_token',
      'test'
    )
    const id = provider === 'mal' ? 'mal-42' : '42'
    await WatchlistRepository.upsert(db, {
      id,
      name: 'Example',
      thumbnail: '',
      status: 'Completed',
      nativeName: '',
      englishName: '',
      type: 'TV',
    })
    await ShowsMetaRepository.upsert(db, { id, episodeCount: 12 })
    await WatchedEpisodesRepository.markCompleted(db, { showId: id, episodeNumber: '12' })
    let repeating = false
    t.mock.method(AniListTracker.prototype, 'getMediaEntry', async () => ({
      title: {},
      mediaListEntry: {
        status: repeating ? 'REPEATING' : 'COMPLETED',
        progress: repeating ? 1 : 12,
        updatedAt: 1,
      },
    }))
    t.mock.method(MalTracker.prototype, 'getAnime', async () => ({
      id: 42,
      title: 'Example',
      my_list_status: {
        status: repeating ? 'watching' : 'completed',
        num_episodes_watched: repeating ? 1 : 12,
        is_rewatching: repeating,
      },
    }))
    const writes: { progress: number; status: string; rewatching?: boolean }[] = []
    t.mock.method(
      AniListTracker.prototype,
      'updateMediaEntry',
      async (value: { progress: number; status: string }) => {
        writes.push(value)
        repeating = value.status === 'Rewatching'
      }
    )
    t.mock.method(
      MalTracker.prototype,
      'update',
      async (_id: number, progress: number, status: string, opts: { rewatching: boolean }) => {
        writes.push({ progress, status, ...opts })
        repeating = opts.rewatching
      }
    )
    await pushCompletedEpisode(db, id, '1')
    assert.equal(writes[0].progress, 1)
    assert.equal(writes[0].status, provider === 'mal' ? 'Watching' : 'Rewatching')
    assert.equal((await WatchlistRepository.getById(db, id))?.status, 'Watching')
    await pushCompletedEpisode(db, id, '12')
    assert.equal((await WatchlistRepository.getById(db, id))?.status, 'Completed')
    assert.equal(writes.at(-1)?.status, 'Completed')
  })
}
for (const provider of ['anilist', 'mal'] as const) {
  test(`${provider}: completing a show during a playback lookup wins over the older remote status`, async (t) => {
    const { db, cleanup } = await createTestDbs()
    t.after(cleanup)
    await SettingsRepository.upsert(
      db,
      provider === 'mal' ? 'tracker_mal_tokens' : 'tracker_anilist_token',
      'test'
    )
    const id = provider === 'mal' ? 'mal-42' : '42'
    await WatchlistRepository.upsert(db, {
      id,
      name: 'Example',
      thumbnail: '',
      status: 'Watching',
      nativeName: '',
      englishName: '',
      type: 'TV',
    })
    let entered!: () => void
    let release!: () => void
    const fetching = new Promise<void>((resolve) => {
      entered = resolve
    })
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    t.mock.method(AniListTracker.prototype, 'getMediaEntry', async () => {
      entered()
      await ready
      return {
        title: {},
        mediaListEntry: { status: 'CURRENT', progress: 2, updatedAt: 9999999999 },
      }
    })
    t.mock.method(MalTracker.prototype, 'getAnime', async () => {
      entered()
      await ready
      return {
        id: 42,
        title: 'Example',
        my_list_status: { status: 'watching', num_episodes_watched: 2, updated_at: '2099-01-01' },
      }
    })
    const writes: string[] = []
    t.mock.method(
      AniListTracker.prototype,
      'updateMediaEntry',
      async (value: { status: string }) => {
        writes.push(value.status)
      }
    )
    t.mock.method(
      MalTracker.prototype,
      'update',
      async (_id: number, _progress: number, status: string) => {
        writes.push(status)
      }
    )
    const playback = pushCompletedEpisode(db, id, '2')
    await fetching
    await WatchlistRepository.updateStatus(db, id, 'Completed')
    const completion = pushCompletedEpisode(db, id)
    release()
    await Promise.all([playback, completion])
    assert.equal((await WatchlistRepository.getById(db, id))?.status, 'Completed')
    assert.ok(writes.length > 0)
    assert.ok(writes.every((status) => status === 'Completed'))
  })
}
