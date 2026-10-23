import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.XDG_DATA_HOME = mkdtempSync(path.join(tmpdir(), 'dango-tracker-test-'))
const { initializeDatabase } = await import('../../db/ddl.js')
const { SettingsRepository: settings } = await import('../../repositories/settings.repository.js')
const { WatchedEpisodesRepository: watched } =
  await import('../../repositories/watched-episodes.repository.js')
const { MAL_KEYS, beginMalLogin, finishMalLogin, credentialSettings, MalTracker } =
  await import('../../lib/tracker/mal-tracker.js')
const { completedProgress } = await import('../../lib/tracker/episode-sync.js')
const { syncMyAnimeList } = await import('../../lib/tracker/mal-sync.service.js')
const { trackerRouter } = await import('../../trpc/routers/tracker.js')
const { settingsRouter } = await import('../../trpc/routers/settings.js')
const { exportTables, importTables } = await import('../../sync-payload.js')
import type { TrpcContext } from '../../trpc/context.js'

async function database(t: TestContext) {
  const db = await initializeDatabase(':memory:')
  t.after(() => db.close(() => {}))
  return db
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
async function connect(db: Awaited<ReturnType<typeof database>>, expiresAt = Date.now() + 3600000) {
  await settings.upsert(db, MAL_KEYS.clientId, 'test-client')
  await settings.upsert(
    db,
    MAL_KEYS.tokens,
    JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expiresAt })
  )
}
function context(db: Awaited<ReturnType<typeof database>>) {
  return { db, lanAuthed: true, discordRPC: { updatePresence() {} } } as unknown as TrpcContext
}

await test('MAL login uses PKCE, verifies state, and consumes callback once', async (t) => {
  const db = await database(t)
  await settings.upsert(db, MAL_KEYS.clientId, 'test-client')
  const login = await beginMalLogin(db, 'http://localhost:5174/api/tracker/mal/callback')
  const url = new URL(login.url)
  assert.equal(url.searchParams.get('code_challenge_method'), 'plain')
  assert.equal(url.searchParams.get('code_challenge')?.length, 128)
  await assert.rejects(finishMalLogin(db, 'test-code', 'mal:wrong'), /invalid state/)
  mockFetch(t, (url, init) => {
    if (url.endsWith('/token') || url.includes('/exchange') || url.includes('/refresh')) {
      const raw = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      const body =
        raw instanceof URLSearchParams ? raw : new URLSearchParams(raw as Record<string, string>)
      if (url.includes('/exchange')) {
        assert.equal(
          body.get('code_verifier'),
          new URL(login.url).searchParams.get('code_challenge')
        )
      }
      return json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 })
    }
    return json({ id: 1, name: 'Test viewer' })
  })
  assert.equal((await finishMalLogin(db, 'test-code', login.state)).name, 'Test viewer')
  await assert.rejects(finishMalLogin(db, 'test-code', login.state), /expired/)
  const status = await trackerRouter.createCaller(context(db)).status()
  assert.equal(status.mal.connected, true)
  assert.equal(JSON.stringify(status).includes('test-access'), false)
})

await test('credentials pair the saved app and otherwise fall back to the env app', async (t) => {
  const db = await database(t)
  const prev = { id: process.env.MAL_CLIENT_ID, secret: process.env.MAL_CLIENT_SECRET }
  t.after(() => {
    if (prev.id === undefined) delete process.env.MAL_CLIENT_ID
    else process.env.MAL_CLIENT_ID = prev.id
    if (prev.secret === undefined) delete process.env.MAL_CLIENT_SECRET
    else process.env.MAL_CLIENT_SECRET = prev.secret
  })
  process.env.MAL_CLIENT_ID = 'env-client'
  process.env.MAL_CLIENT_SECRET = 'env-secret'
  assert.equal((await credentialSettings(db)).mode, 'local')
  assert.equal((await credentialSettings(db)).clientId, 'env-client')
  assert.equal((await credentialSettings(db)).clientSecret, 'env-secret')
  await settings.upsert(db, MAL_KEYS.clientId, 'saved-client')
  await settings.upsert(db, MAL_KEYS.clientSecret, 'saved-secret')
  const saved = await credentialSettings(db)
  assert.equal(saved.clientId, 'saved-client')
  assert.equal(saved.clientSecret, 'saved-secret')
  assert.equal(saved.hasCustomId, true)
})

await test('MAL login goes through the auth worker when no custom app is saved', async (t) => {
  const db = await database(t)
  const prev = process.env.MAL_AUTH_WORKER_URL
  process.env.MAL_AUTH_WORKER_URL = 'https://mal-worker.test/'
  t.after(() => {
    if (prev === undefined) delete process.env.MAL_AUTH_WORKER_URL
    else process.env.MAL_AUTH_WORKER_URL = prev
  })
  assert.equal((await credentialSettings(db)).mode, 'worker')
  mockFetch(t, (url, init) => {
    if (url.startsWith('https://mal-worker.test/auth-url')) {
      const query = new URL(url).searchParams
      assert.equal(query.get('return_to'), 'http://localhost:3000/api/tracker/mal/callback')
      assert.equal(query.get('code_challenge_method'), 'plain')
      const authorize = new URL('https://myanimelist.net/v1/oauth2/authorize')
      authorize.search = new URLSearchParams({
        state: query.get('state')!,
        code_challenge: query.get('code_challenge')!,
      }).toString()
      return json({ url: authorize.toString() })
    }
    if (url === 'https://mal-worker.test/exchange') {
      const body = JSON.parse(String(init.body))
      assert.equal(body.code, 'worker-code')
      assert.equal(body.code_verifier?.length, 128)
      return json({
        access_token: 'worker-access',
        refresh_token: 'worker-refresh',
        expires_in: 3600,
      })
    }
    if (url === 'https://api.myanimelist.net/v2/users/@me')
      return json({ id: 2, name: 'Worker viewer' })
    throw new Error(`unexpected request ${url}`)
  })
  const login = await beginMalLogin(db, 'http://localhost:3000/api/tracker/mal/callback')
  assert.equal(new URL(login.url).hostname, 'myanimelist.net')
  const user = await finishMalLogin(db, 'worker-code', login.state)
  assert.equal(user.name, 'Worker viewer')
  const stored = JSON.parse((await settings.getByKey(db, MAL_KEYS.tokens))!.value)
  assert.equal(stored.access_token, 'worker-access')
})

await test('clearing a custom app falls back to the auth worker', async (t) => {
  const db = await database(t)
  const prev = process.env.MAL_AUTH_WORKER_URL
  process.env.MAL_AUTH_WORKER_URL = 'https://mal-worker.test'
  t.after(() => {
    if (prev === undefined) delete process.env.MAL_AUTH_WORKER_URL
    else process.env.MAL_AUTH_WORKER_URL = prev
  })
  await settings.upsert(db, MAL_KEYS.clientId, 'custom-client')
  await settings.upsert(db, MAL_KEYS.clientSecret, 'custom-secret')
  await settings.upsert(db, MAL_KEYS.tokens, '{"access_token":"stale"}')
  await settings.upsert(db, MAL_KEYS.user, '{"name":"stale"}')
  const caller = trackerRouter.createCaller(context(db))
  const custom = await caller.malConfig()
  assert.equal(custom.mode, 'local')
  assert.equal(custom.hasWorker, true)
  await caller.malClearConfig()
  const config = await caller.malConfig()
  assert.equal(config.mode, 'worker')
  assert.equal(config.hasCustomId, false)
  assert.equal(!!(await settings.getByKey(db, MAL_KEYS.tokens)), false)
  assert.equal(!!(await settings.getByKey(db, MAL_KEYS.user)), false)
})

await test('MAL rejects expired states and unsupported callback URLs', async (t) => {
  const db = await database(t)
  await settings.upsert(db, MAL_KEYS.clientId, 'test-client')
  await assert.rejects(beginMalLogin(db, 'https://example.com/other'), /callback/)
  const login = await beginMalLogin(db, 'http://localhost:3000/api/tracker/mal/callback')
  const pending = JSON.parse((await settings.getByKey(db, MAL_KEYS.pending))!.value)
  pending.expiresAt = 1
  await settings.upsert(db, MAL_KEYS.pending, JSON.stringify(pending))
  await assert.rejects(finishMalLogin(db, 'test-code', login.state), /expired/)
})

await test('concurrent MAL requests refresh expiring tokens only once', async (t) => {
  const db = await database(t)
  await connect(db, 0)
  let refreshes = 0
  mockFetch(t, async (url, init) => {
    if (url.endsWith('/token') || url.includes('/refresh')) {
      const raw = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      const body =
        raw instanceof URLSearchParams ? raw : new URLSearchParams(raw as Record<string, string>)
      refreshes++
      assert.equal(body.get('refresh_token'), 'test-refresh')
      await new Promise((r) => setTimeout(r, 10))
      return json({ access_token: 'test-new', refresh_token: 'test-rotated', expires_in: 3600 })
    }
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-new')
    return json({ id: 1, title: 'Example' })
  })
  await Promise.all([new MalTracker(db).getAnime(1), new MalTracker(db).getAnime(2)])
  assert.equal(refreshes, 1)
  assert.equal(
    JSON.parse((await settings.getByKey(db, MAL_KEYS.tokens))!.value).refresh_token,
    'test-rotated'
  )
})

await test('MAL 401 refreshes and retries the request', async (t) => {
  const db = await database(t)
  await connect(db)
  let calls = 0
  mockFetch(t, (url) => {
    if (url.endsWith('/token') || url.includes('/refresh'))
      return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })
    return ++calls === 1 ? json({}, 401) : json({ id: 1, title: 'Example' })
  })
  assert.equal((await new MalTracker(db).getAnime(1)).id, 1)
  assert.equal(calls, 2)
})

await test('MAL two-way sync paginates, pulls and pushes progress, and never deletes absent entries', async (t) => {
  const db = await database(t)
  await connect(db)
  db.run(
    "INSERT INTO watchlist (id,name,status) VALUES ('mal-1','Local','Watching'), ('mal-3','Local only','Planned')"
  )
  await watched.insertIfMissing(db, { showId: 'mal-1', episodeNumber: '3' })
  let pages = 0
  const writes: number[] = []
  mockFetch(t, (url, init) => {
    if (url.includes('/animelist?')) {
      pages++
      return pages === 1
        ? json({
            data: [
              {
                node: { id: 1, title: 'Local', num_episodes: 12 },
                list_status: { status: 'watching', num_episodes_watched: 1 },
              },
            ],
            paging: { next: 'https://untrusted.example/never-follow' },
          })
        : json({
            data: [
              {
                node: { id: 2, title: 'Remote only', num_episodes: 12 },
                list_status: { status: 'completed', num_episodes_watched: 12 },
              },
            ],
          })
    }
    assert.equal(init.method, 'PUT')
    writes.push(Number((init.body as URLSearchParams).get('num_watched_episodes')))
    return json({})
  })
  const result = await syncMyAnimeList(db)
  assert.equal(pages, 2)
  assert.equal(result.pulled, 1)
  assert.equal(result.merged, 1)
  assert.equal(result.pushed, 1)
  assert.ok(writes.includes(3))
  assert.equal(await completedProgress(db, 'mal-2'), 12)
  assert.equal(db.all('SELECT * FROM watchlist').length, 3)
})

await test('MAL secrets stay out of generic settings, status, and library exports; imports preserve local account', async (t) => {
  const db = await database(t)
  await connect(db)
  await settings.upsert(db, MAL_KEYS.clientSecret, 'test-private-secret')
  await assert.rejects(
    settingsRouter.createCaller(context(db)).getByKey({ key: MAL_KEYS.clientSecret }),
    /private/
  )
  const payload = exportTables(db, ['settings'] as const)
  assert.equal(JSON.stringify(payload).includes('test-private-secret'), false)
  assert.equal(JSON.stringify(payload).includes('test-access'), false)
  importTables(
    db,
    ['settings'],
    {
      version: 1,
      exportedAt: '',
      tables: {
        settings: [
          { key: MAL_KEYS.tokens, value: 'foreign-tokens' },
          { key: 'theme', value: 'dark' },
        ],
      },
    },
    { libraryTables: ['settings'], backupName: 'test-before-import.db' }
  )
  assert.equal(
    JSON.parse((await settings.getByKey(db, MAL_KEYS.tokens))!.value).access_token,
    'test-access'
  )
  await trackerRouter.createCaller(context(db)).malDisconnect()
  assert.equal((await trackerRouter.createCaller(context(db)).status()).mal.connected, false)
  assert.equal((await settings.getByKey(db, MAL_KEYS.clientId))?.value, 'test-client')
})

await test('remote MAL progress completes a partial local playback record', async (t) => {
  const db = await database(t)
  await connect(db)
  db.run("INSERT INTO watchlist (id,name,status) VALUES ('mal-1','Example','Watching')")
  await watched.upsert(db, { showId: 'mal-1', episodeNumber: '1', currentTime: 20, duration: 100 })
  mockFetch(t, () =>
    json({
      data: [
        {
          node: { id: 1, title: 'Example', num_episodes: 12 },
          list_status: { status: 'watching', num_episodes_watched: 2 },
        },
      ],
    })
  )
  await syncMyAnimeList(db)
  assert.equal(await completedProgress(db, 'mal-1'), 2)
  assert.equal((await watched.getByShowAndEpisode(db, 'mal-1', '1'))?.currentTime, 100)
})

await test('MAL sync does not retry a failed merge as a lower-progress local-only push', async (t) => {
  const db = await database(t)
  await connect(db)
  db.run("INSERT INTO watchlist (id,name,status) VALUES ('mal-1','Example','Watching')")
  await watched.insertIfMissing(db, { showId: 'mal-1', episodeNumber: '1' })
  let writes = 0
  mockFetch(t, (_url, init) => {
    if (init.method === 'PUT') {
      writes++
      return json({}, 503)
    }
    return json({
      data: [
        {
          node: { id: 1, title: 'Example', num_episodes: 12 },
          list_status: { status: 'on_hold', num_episodes_watched: 5 },
        },
      ],
    })
  })
  const result = await syncMyAnimeList(db)
  assert.equal(result.errors.length, 1)
  assert.equal(writes, 1)
})

await test('MAL write activity surrounds the request and clears even when it fails', async (t) => {
  const db = await database(t)
  await connect(db)
  const { subscribeTrackerActivity } = await import('./tracker-activity.js')
  const events: string[] = []
  const unsubscribe = subscribeTrackerActivity(db, (value) =>
    events.push(`${value.provider}:${value.updating}`)
  )
  t.after(unsubscribe)
  mockFetch(t, (_url, init) => {
    assert.equal(init.method, 'PUT')
    assert.deepEqual(events, ['anilist:false', 'mal:false', 'mal:true'])
    return json({}, 503)
  })
  await assert.rejects(new MalTracker(db).update(1, 2, 'Watching'))
  assert.deepEqual(events, ['anilist:false', 'mal:false', 'mal:true', 'mal:false'])
})
