import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.XDG_DATA_HOME = mkdtempSync(path.join(tmpdir(), 'dango-mal-manga-test-'))
const { initializeDatabase, initializeMangaDatabase } = await import('../../db/ddl.js')
const { SettingsRepository: settings } = await import('../../repositories/settings.repository.js')
const { MangaLibraryRepository } = await import('../../repositories/manga.repository.js')
const { MAL_KEYS } = await import('../../lib/tracker/mal-tracker.js')
const { syncMyAnimeListManga } = await import('../../lib/tracker/mal-manga-sync.service.js')

type Db = Awaited<ReturnType<typeof initializeDatabase>>

async function databases(t: TestContext) {
  const db = await initializeDatabase(':memory:')
  const mangaDb = await initializeMangaDatabase(':memory:')
  t.after(() => {
    db.close(() => {})
    mangaDb.close(() => {})
  })
  await settings.upsert(db, MAL_KEYS.clientId, 'test-client')
  await settings.upsert(
    db,
    MAL_KEYS.tokens,
    JSON.stringify({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expiresAt: Date.now() + 3600000,
    })
  )
  return { db, mangaDb }
}

function mockFetch(
  t: TestContext,
  fn: (url: string, init: RequestInit) => Response | Promise<Response>
) {
  const original = globalThis.fetch
  globalThis.fetch = (async (url, init = {}) => fn(String(url), init)) as typeof fetch
  t.after(() => {
    globalThis.fetch = original
  })
}
const json = (body: unknown, status = 200) => Response.json(body, { status })

const remoteList = (entries: unknown[]) => json({ data: entries })

await test('MAL manga sync pushes local chapters, pulls remote-only entries, and keeps statuses', async (t) => {
  const { db, mangaDb } = await databases(t)
  await MangaLibraryRepository.upsert(mangaDb, {
    id: 'mal:5',
    provider: 'mal',
    mangaId: '5',
    title: 'Example',
    cover: '',
    status: 'Reading',
  })
  await MangaLibraryRepository.setProgressPointer(mangaDb, 'mal:5', '4')

  const writes: string[] = []
  mockFetch(t, (url, init) => {
    if (url.endsWith('/token') || url.includes('/refresh'))
      return json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 })
    if (url.includes('/mangalist?'))
      return remoteList([
        {
          node: { id: 5, title: 'Example', main_picture: { large: 'cover.jpg' } },
          list_status: {
            status: 'reading',
            num_chapters_read: 2,
            updated_at: '2026-01-01T00:00:00Z',
          },
        },
        {
          node: { id: 6, title: 'Remote only', main_picture: {} },
          list_status: {
            status: 'completed',
            num_chapters_read: 12,
            updated_at: '2026-01-01T00:00:00Z',
          },
        },
      ])
    assert.equal(init.method, 'PUT')
    writes.push(String((init.body as URLSearchParams).get('num_chapters_read')))
    return json({})
  })

  const summary = await syncMyAnimeListManga(db, mangaDb)
  assert.deepEqual(writes, ['4'])
  assert.equal(summary.pulled, 1)
  assert.equal(summary.merged, 1)
  assert.equal(summary.errors.length, 0)

  const pulled = (await MangaLibraryRepository.getAll(mangaDb)).find((row) => row.id === 'mal:6')
  assert.equal(pulled?.status, 'Completed')
  assert.equal(pulled?.lastChapterNumber, '12')
  assert.equal((await MangaLibraryRepository.getAll(mangaDb)).length, 2)
})

await test('MAL manga sync links a local title on an exact match and never guesses', async (t) => {
  const { db, mangaDb } = await databases(t)
  await MangaLibraryRepository.upsert(mangaDb, {
    id: 'provider-123',
    provider: 'some-provider',
    mangaId: '123',
    title: 'Example (2020)',
    cover: '',
    status: 'Reading',
  })
  await MangaLibraryRepository.setProgressPointer(mangaDb, 'provider-123', '2')

  mockFetch(t, (url, init) => {
    if (url.endsWith('/token'))
      return json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 })

    if (url.includes('/mangalist?'))
      return remoteList([
        {
          node: { id: 5, title: 'Example', main_picture: {} },
          list_status: {
            status: 'reading',
            num_chapters_read: 1,
            updated_at: '2026-01-01T00:00:00Z',
          },
        },
      ])
    assert.equal(init.method, 'PUT')
    assert.equal((init.body as URLSearchParams).get('num_chapters_read'), '2')
    return json({})
  })

  const summary = await syncMyAnimeListManga(db, mangaDb)
  assert.equal(summary.errors.length, 0)
  assert.equal((await settings.getByKey(db, 'tracker_mal_manga_link_provider-123'))?.value, '5')
  assert.equal((await MangaLibraryRepository.getAll(mangaDb)).length, 1)
})

await test('MAL manga sync links an unread title from the fetched list without a search', async (t) => {
  const { db, mangaDb } = await databases(t)
  await MangaLibraryRepository.upsert(mangaDb, {
    id: 'provider-7',
    provider: 'some-provider',
    mangaId: '7',
    title: 'Solo Leveling (2021)',
    cover: '',
    status: 'Planned',
  })
  let searches = 0
  mockFetch(t, (url, init) => {
    if (url.endsWith('/token'))
      return json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 })
    if (url.includes('/manga?q=')) {
      searches++
      return json({ data: [] })
    }
    if (url.includes('/mangalist?'))
      return remoteList([
        {
          node: {
            id: 7,
            title: 'Solo Leveling',
            alternative_titles: { en: 'Solo Leveling' },
            main_picture: {},
          },
          list_status: {
            status: 'reading',
            num_chapters_read: 5,
            updated_at: '2026-01-01T00:00:00Z',
          },
        },
      ])
    assert.equal(init.method, 'PUT')
    return json({})
  })

  const summary = await syncMyAnimeListManga(db, mangaDb)
  assert.equal(searches, 0)
  assert.equal((await settings.getByKey(db, 'tracker_mal_manga_link_provider-7'))?.value, '7')
  const rows = await MangaLibraryRepository.getAll(mangaDb)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'provider-7')
  assert.equal(rows[0].lastChapterNumber, '5')
  assert.equal(summary.merged, 1)
})
