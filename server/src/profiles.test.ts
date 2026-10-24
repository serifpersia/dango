import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { serve } from '@hono/node-server'
import './test-helpers.js'
import { ProfileStore, validateAvatar } from './profiles.js'
import { profileScope, profileEnv } from './profile-scope.js'
import { CONFIG, INSTALL_CONFIG } from './config.js'
import { SettingsRepository } from './repositories/settings.repository.js'
import { performWriteTransactionAsync } from './db/transaction.js'
import { updateEnvFile } from './utils/env.utils.js'
import { getGoogleDriveService } from './google.js'
import { getGitHubSyncService } from './github-sync.js'
import { KIND_SYNC, initSyncProvider, getActiveProvider } from './sync.js'
import { createHonoApp } from './app-hono.js'
import { initializeDatabase } from './db/ddl.js'
import { AppCache } from './utils/cache.utils.js'
import { isAllowedOrigin } from './utils/security.utils.js'
import { getMigratedId } from './lib/migration.js'

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='

test('profiles preserve Default, isolate concurrent data and credentials, and persist sessions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-profiles-'))
  let store = new ProfileStore(root, false)
  try {
    assert.equal(store.resolve()?.id, 'default')
    const original = await store.load('default')
    original.db.run("INSERT INTO watchlist (id, name) VALUES ('1', 'Existing library')")
    fs.writeFileSync(path.join(root, '.env'), 'SYNC_PROVIDER=none\n')
    store.attachDefault(original)
    assert.ok(fs.existsSync(path.join(root, 'before-profiles', 'db.db')))
    store.update('default', { name: 'Owner' })
    assert.equal(store.resolve()?.name, 'Owner')
    assert.throws(() => store.create('Second', ''), /Protect the owner/)
    store.update('default', { password: 'owner-password' })
    const ownerSession = store.login('default', 'owner-password')
    const second = store.create('Second', 'second-password')
    const secondSession = store.login(second.id, 'second-password')
    assert.equal(store.resolve(), undefined)
    assert.equal(store.resolve(secondSession)?.id, second.id)
    assert.throws(() => store.login(second.id, 'wrong'), /Invalid/)
    assert.throws(
      () => store.update('default', { password: '', currentPassword: 'owner-password' }),
      /must keep a password/
    )
    assert.throws(
      () => store.update(second.id, { password: 'new-password', currentPassword: 'wrong' }),
      /Current password/
    )
    const other = await store.load(second.id)
    assert.equal(
      other.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM watchlist')?.count,
      0
    )
    for (const [database, canonical] of [
      [original.db, 91],
      [other.db, 92],
    ] as const) {
      database.run("INSERT INTO watchlist (id, name) VALUES ('9', 'Alias')")
      database.run("INSERT INTO shows_meta (id, anilistId) VALUES ('9', ?)", [canonical])
    }
    const migrated = await Promise.all(
      ['default', second.id].map((id) =>
        profileScope.run(store.scope(id), async () => getMigratedId((await store.load(id)).db, '9'))
      )
    )
    assert.deepEqual(migrated, ['91', '92'])
    await Promise.all(
      ['default', second.id].map((id) =>
        profileScope.run(store.scope(id), async () => {
          const dbs = await store.load(id)
          await updateEnvFile({ GITHUB_TOKEN: `token-${id}`, SYNC_PROVIDER: 'none' })
          await new Promise((resolve) => setTimeout(resolve, id === 'default' ? 15 : 5))
          assert.equal(profileEnv('GITHUB_TOKEN'), `token-${id}`)
          assert.equal(CONFIG.ROOT, store.scope(id).root)
          assert.equal(
            KIND_SYNC.anime.manifestPath,
            path.join(store.scope(id).root, path.basename(INSTALL_CONFIG.LOCAL_MANIFEST_PATH))
          )
          await performWriteTransactionAsync(dbs.db, async (tx) => {
            await SettingsRepository.upsert(tx, 'preferredProvider', id)
          })
          await initSyncProvider('none')
          assert.equal(getActiveProvider(), 'none')
          assert.ok(fs.existsSync(CONFIG.LOCAL_MANIFEST_PATH))
        })
      )
    )
    assert.equal(
      (await SettingsRepository.getByKey(original.db, 'preferredProvider'))?.value,
      'default'
    )
    assert.equal(
      (await SettingsRepository.getByKey(other.db, 'preferredProvider'))?.value,
      second.id
    )
    const serviceA = profileScope.run(store.scope('default'), getGoogleDriveService)
    const serviceB = profileScope.run(store.scope(second.id), getGoogleDriveService)
    assert.notEqual(serviceA, serviceB)
    assert.notEqual(
      profileScope.run(store.scope('default'), getGitHubSyncService),
      profileScope.run(store.scope(second.id), getGitHubSyncService)
    )
    store.scope('default').claimCloud!('github', 'account')
    assert.throws(
      () => store.scope(second.id).claimCloud!('github', 'account'),
      /already connected/
    )
    store.scope('default').claimCloud!('github', null)
    store.scope(second.id).claimCloud!('github', 'account')
    const state = store.beginOAuth(second.id)
    assert.equal(store.finishOAuth('default', state), false)
    assert.equal(store.finishOAuth(second.id, state), false)
    const validState = store.beginOAuth(second.id)
    assert.equal(store.finishOAuth(second.id, validState), true)
    store.update(second.id, { avatar: image })
    assert.equal(store.getAvatar(second.id), image)
    store.update(second.id, { avatar: null })
    assert.equal(store.get(second.id)?.avatar, null)
    await store.close()
    store = new ProfileStore(root, false)
    assert.equal(store.resolve(ownerSession)?.name, 'Owner')
    assert.equal(store.resolve(secondSession)?.id, second.id)
    store.logout(secondSession)
    assert.equal(store.resolve(secondSession), undefined)
    const reopened = await store.load('default')
    assert.equal(
      reopened.db.get<{ name: string }>('SELECT name FROM watchlist WHERE id = ?', ['1'])?.name,
      'Existing library'
    )
  } finally {
    await store.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('profile HTTP routes enforce ownership, session identity, LAN protection and independent backups', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-profile-http-'))
  const store = new ProfileStore(root, false)
  const previousHash = INSTALL_CONFIG.APP_PASSWORD_HASH
  const previousEnvHash = process.env.APP_PASSWORD_HASH
  INSTALL_CONFIG.APP_PASSWORD_HASH = ''
  process.env.APP_PASSWORD_HASH = ''
  const dbs = await store.load('default')
  store.attachDefault(dbs)
  store.update('default', { password: 'owner-password' })
  const second = store.create('Second', 'second-password')
  const ownerToken = store.login('default', 'owner-password')
  const memberToken = store.login(second.id, 'second-password')
  const app = createHonoApp(
    () => ({ shuttingDown: false, dbReady: true }),
    () => ({ shuttingDown: false, dbsReady: true, bootSyncing: false }),
    () => dbs,
    {
      initializeDatabase,
      setDb: (db) => {
        dbs.db = db
      },
    },
    { getCatalog: () => [], refresh: async () => [] },
    async () => {},
    {
      getApiCache: () => new AppCache(),
      getProviders: () => ({}),
      getMangaProvider: () => undefined,
      getTvProvider: () => undefined,
      getProxyRules: () => [],
      getJasmr: () => undefined,
    },
    () => store
  )
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  const request = (url: string, token?: string, body?: unknown, extra?: Record<string, string>) =>
    fetch(base + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { cookie: `dango_profile=${token}` } : {}),
        'content-type': 'application/json',
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  try {
    assert.equal((await request('/api/health')).status, 200)
    assert.equal((await request('/api/backup-db')).status, 401)
    const status = await (await request('/api/profiles/status')).json()
    assert.equal(status.current, null)
    assert.equal(status.profiles.length, 2)
    assert.equal('password' in status.profiles[0], false)
    assert.equal(
      (await request('/api/profiles/create', memberToken, { name: 'Forbidden', password: '' }))
        .status,
      403
    )
    assert.equal(
      (await request('/api/trpc/auth.setServerPort', memberToken, { port: 4444 })).status,
      403
    )
    assert.equal(
      (await request('/api/trpc/watchlist.add', memberToken, { id: '42', name: 'Member show' }))
        .status,
      200
    )
    const ownerBackup = await (await request('/api/backup-db', ownerToken)).json()
    const memberBackup = await (await request('/api/backup-db', memberToken)).json()
    assert.equal(ownerBackup.databases.anime.tables.watchlist.length, 0)
    assert.equal(memberBackup.databases.anime.tables.watchlist[0].id, '42')
    assert.equal(
      (
        await request(
          '/api/trpc/watchlist.add',
          memberToken,
          { id: '43', name: 'Late write' },
          { 'x-dango-profile-id': 'default' }
        )
      ).status,
      409
    )
    assert.equal(
      (
        await request('/api/trpc/watchlist.add?_profile=default', memberToken, {
          id: '44',
          name: 'Late beacon',
        })
      ).status,
      409
    )
    assert.equal(
      (await request('/api/profiles/update', memberToken, { avatar: image })).status,
      200
    )
    assert.equal(
      (await (await request('/api/profiles/current', memberToken)).json()).image,
      store.get(second.id)!.avatar
    )
    const avatarResponse = await request(store.get(second.id)!.avatar!)
    assert.equal(avatarResponse.status, 200)
    assert.equal(avatarResponse.headers.get('content-type'), 'image/png')
    assert.deepEqual(
      Buffer.from(await avatarResponse.arrayBuffer()),
      Buffer.from(image.split(',')[1], 'base64')
    )
    assert.equal((await request('/api/profiles/update', memberToken, { avatar: null })).status, 200)
    assert.equal((await (await request('/api/profiles/current', memberToken)).json()).image, null)
    const google = profileScope.run(store.scope(second.id), getGoogleDriveService)
    const connected = t.mock.method(google, 'isAuthenticated', () => true)
    const cloudUser = t.mock.method(google, 'getUserProfile', async () => ({
      id: 'test',
      name: 'Cloud user',
      picture: 'https://example.com/avatar.png',
    }))
    assert.equal(
      (await (await request('/api/profiles/current', memberToken)).json()).image,
      'https://example.com/avatar.png'
    )
    await request('/api/profiles/update', memberToken, { avatar: image })
    assert.equal(
      (await (await request('/api/profiles/current', memberToken)).json()).image,
      store.get(second.id)!.avatar
    )
    await request('/api/profiles/update', memberToken, { avatar: null })
    assert.equal(
      (await (await request('/api/profiles/current', memberToken)).json()).image,
      'https://example.com/avatar.png'
    )
    connected.mock.restore()
    cloudUser.mock.restore()
    const listed = await (await request('/api/profiles/status')).json()
    assert.equal(
      listed.profiles.find((profile: { id: string }) => profile.id === second.id).cloudAvatar,
      'https://example.com/avatar.png'
    )
    assert.equal(
      (
        await request(
          '/api/profiles/update',
          memberToken,
          { name: 'CSRF' },
          { origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' }
        )
      ).status,
      403
    )
    assert.equal(
      (await request('/api/auth/google/callback?code=wrong&state=wrong', memberToken)).status,
      400
    )
    INSTALL_CONFIG.APP_PASSWORD_HASH = 'locked'
    assert.equal((await request('/api/profiles/status', memberToken)).status, 401)
    INSTALL_CONFIG.APP_PASSWORD_HASH = ''
    const login = await request('/api/profiles/login', undefined, {
      id: second.id,
      password: 'second-password',
    })
    assert.equal(login.status, 200)
    assert.match(login.headers.get('set-cookie')!, /HttpOnly/i)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const loggedIn = await fetch(base + '/api/profiles/current', { headers: { cookie } })
    assert.equal((await loggedIn.json()).id, second.id)
    assert.equal((await request('/api/profiles/logout', memberToken, {})).status, 200)
    assert.equal((await request('/api/backup-db', memberToken)).status, 401)
    const disposable = store.create('Disposable', 'delete-password')
    const disposableToken = store.login(disposable.id, 'delete-password')
    await store.load(disposable.id)
    assert.equal(
      (await request('/api/profiles/delete', disposableToken, { id: second.id, confirm: true }))
        .status,
      403
    )
    assert.equal(
      (await request('/api/profiles/delete', ownerToken, { id: disposable.id })).status,
      400
    )
    assert.equal(
      (await request('/api/profiles/delete', ownerToken, { id: 'default', confirm: true })).status,
      400
    )
    assert.equal(
      (await request('/api/profiles/delete', ownerToken, { id: disposable.id, confirm: true }))
        .status,
      200
    )
    assert.equal((await request('/api/backup-db', disposableToken)).status, 401)
    assert.equal(
      (
        await request('/api/profiles/login', undefined, {
          id: disposable.id,
          password: 'delete-password',
        })
      ).status,
      401
    )
    assert.equal(
      (await request('/api/profiles/delete', ownerToken, { id: disposable.id, confirm: true }))
        .status,
      400
    )
    assert.equal(
      (await (await request('/api/profiles/status')).json()).profiles.some(
        (profile: { id: string }) => profile.id === disposable.id
      ),
      false
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    await store.close()
    INSTALL_CONFIG.APP_PASSWORD_HASH = previousHash
    if (previousEnvHash === undefined) delete process.env.APP_PASSWORD_HASH
    else process.env.APP_PASSWORD_HASH = previousEnvHash
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('deletion revokes accounts immediately and removes only their local directory on restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-profile-delete-'))
  let store = new ProfileStore(root, false)
  try {
    const owner = await store.load('default')
    owner.db.run("INSERT INTO watchlist (id, name) VALUES ('1', 'Owner library')")
    store.update('default', { password: 'owner-password' })
    const target = store.create('Delete me', 'member-password')
    const other = store.create('Keep me', '')
    const targetDbs = await store.load(target.id)
    const scope = store.scope(target.id)
    scope.env.GITHUB_TOKEN = 'private-token'
    const folder = scope.root
    fs.writeFileSync(path.join(folder, '.env'), 'GITHUB_TOKEN=private-token\n')
    scope.claimCloud!('github', 'test-account')
    const session = store.login(target.id, 'member-password')
    const oauth = store.beginOAuth(target.id)
    let stopped = false
    store.onDelete = (dbs) => {
      assert.equal(dbs, targetDbs)
      stopped = true
    }
    assert.throws(() => store.remove('default'), /owner profile/)
    store.remove(target.id)
    assert.equal(stopped, true)
    assert.equal(store.get(target.id), undefined)
    assert.equal(store.resolve(session), undefined)
    assert.equal(store.finishOAuth(target.id, oauth), false)
    assert.throws(() => store.login(target.id, 'member-password'), /Invalid/)
    await assert.rejects(store.load(target.id), /Unknown profile/)
    assert.equal(scope.deleted, true)
    assert.equal(
      profileScope.run(scope, () => profileEnv('GITHUB_TOKEN')),
      undefined
    )
    await assert.rejects(
      profileScope.run(scope, () => updateEnvFile({ GITHUB_TOKEN: 'late-token' })),
      /deleted/
    )
    assert.throws(() => scope.claimCloud!('github', 'late-account'), /deleted/)
    store.scope(other.id).claimCloud!('github', 'test-account')
    assert.equal(targetDbs.db.isClosedCheck(), false)
    assert.equal(fs.existsSync(folder), true)
    const visited: string[] = []
    await store.each(async (_dbs, profile) => {
      visited.push(profile.id)
    })
    assert.deepEqual(visited, ['default', other.id])
    await store.close()
    store = new ProfileStore(root, false)
    assert.equal(fs.existsSync(folder), false)
    assert.equal(store.get(target.id), undefined)
    assert.equal(store.get(other.id)?.name, 'Keep me')
    const reopened = await store.load('default')
    assert.equal(
      reopened.db.get<{ name: string }>("SELECT name FROM watchlist WHERE id = '1'")?.name,
      'Owner library'
    )
    assert.equal(fs.existsSync(store.scope(other.id).root), true)
  } finally {
    await store.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('avatars reject executable and oversized input, and origins must match the server', () => {
  assert.equal(validateAvatar(image), image)
  assert.throws(() => validateAvatar('data:image/svg+xml;base64,PHN2Zz4='), /Use a PNG/)
  assert.throws(() => validateAvatar('data:image/png;base64,YmFk'), /Invalid image/)
  assert.throws(() => validateAvatar('a'.repeat(2_800_001)), /smaller/)
  assert.equal(isAllowedOrigin('http://192.168.1.4:3000', 'http://192.168.1.4:3000/api'), true)
  assert.equal(isAllowedOrigin('https://untrusted.example', 'http://192.168.1.4:3000/api'), false)
})
