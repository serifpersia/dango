import type { Hono, Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { PROFILE_COOKIE, type ProfileStore } from '../profiles.js'
import { profileScope } from '../profile-scope.js'
import { getGoogleDriveService } from '../google.js'
import { getGitHubSyncService } from '../github-sync.js'
import { getActiveProvider } from '../sync.js'
import { closeTrackerActivityStreams } from './tracker-activity.js'

export function profileToken(c: Context) {
  return getCookie(c, PROFILE_COOKIE)
}

export function registerProfiles(app: Hono, getStore: () => ProfileStore | undefined) {
  const failures = new Map<string, { attempts: number; until: number }>()
  app.use('/api/profiles/*', bodyLimit({ maxSize: 3 * 1024 * 1024 }))

  app.get('/api/profiles/status', (c) => {
    const store = getStore()
    if (!store) return c.json({ error: 'Profiles initializing' }, 503)
    c.header('Cache-Control', 'no-store')
    const current = store.resolve(profileToken(c))
    return c.json({ profiles: store.list(), current: current ?? null })
  })

  app.get('/api/profiles/avatar/:id', (c) => {
    const avatar = getStore()?.getAvatar(c.req.param('id'))
    if (!avatar) return c.notFound()
    const [header, encoded] = avatar.split(',')
    c.header('Content-Type', header.slice(5, header.indexOf(';')))
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    return c.body(Buffer.from(encoded, 'base64'))
  })

  app.post('/api/profiles/login', async (c) => {
    const store = getStore()
    if (!store) return c.json({ error: 'Profiles initializing' }, 503)
    const body = await c.req.json().catch(() => null)
    if (
      typeof body?.id !== 'string' ||
      typeof body?.password !== 'string' ||
      body.password.length > 256
    )
      return c.json({ error: 'Invalid login' }, 400)
    for (const [key, value] of failures) if (value.until < Date.now()) failures.delete(key)
    const failure = failures.get(body.id)
    if (failure && failure.attempts >= 10)
      return c.json({ error: 'Too many attempts. Try again in 5 minutes.' }, 429)
    try {
      const token = store.login(body.id, body.password)
      failures.delete(body.id)
      const previous = profileToken(c)
      const oldProfile = store.resolve(previous)
      const oldDb = oldProfile && store.scope(oldProfile.id).dbs?.db
      if (oldDb) closeTrackerActivityStreams(oldDb)
      if (previous) store.logout(previous)
      setCookie(c, PROFILE_COOKIE, token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 30 * 86400,
        secure: new URL(c.req.url).protocol === 'https:',
      })
      return c.json({ success: true })
    } catch {
      if (store.get(body.id))
        failures.set(body.id, {
          attempts: (failure?.attempts ?? 0) + 1,
          until: failure?.until ?? Date.now() + 300000,
        })
      return c.json({ error: 'Invalid profile or password' }, 401)
    }
  })

  app.post('/api/profiles/logout', (c) => {
    const token = profileToken(c)
    const store = getStore()
    const profile = store?.resolve(token)
    const expected = c.req.header('x-dango-profile-id')
    if (expected && profile && expected !== profile.id)
      return c.json({ error: 'PROFILE_CHANGED' }, 409)
    const db = profile && store?.scope(profile.id).dbs?.db
    if (db) closeTrackerActivityStreams(db)
    if (token) getStore()?.logout(token)
    deleteCookie(c, PROFILE_COOKIE, { path: '/' })
    return c.json({ success: true })
  })

  app.use('/api/*', async (c, next) => {
    const store = getStore()
    if (!store || c.req.path.startsWith('/api/internal/')) return next()
    const profile = store.resolve(profileToken(c))
    if (!profile) return c.json({ error: 'PROFILE_AUTH_REQUIRED' }, 401)
    const expected = c.req.header('x-dango-profile-id') ?? c.req.query('_profile')
    if (expected && expected !== profile.id) return c.json({ error: 'PROFILE_CHANGED' }, 409)
    if (
      c.req.path === '/api/auth/google/callback' &&
      !store.finishOAuth(profile.id, c.req.query('state') ?? '')
    )
      return c.json({ error: 'Invalid or expired login. Start again from your profile.' }, 400)
    const dbs = await store.load(profile.id)
    if (!store.get(profile.id)) return c.json({ error: 'PROFILE_AUTH_REQUIRED' }, 401)
    const scope = store.scope(profile.id)
    scope.dbs = dbs
    scope.owner = profile.owner
    return profileScope.run(scope, next)
  })

  app.get('/api/profiles/current', async (c) => {
    const scope = profileScope.getStore()!
    const profile = getStore()!.get(scope.id)!
    let cloudAvatar: string | null = null
    const active = getActiveProvider()
    const provider =
      active === 'google' || active === 'github'
        ? active
        : getGitHubSyncService().isAuthenticated()
          ? 'github'
          : getGoogleDriveService().isAuthenticated()
            ? 'google'
            : 'none'
    if (!profile.avatar && provider === 'github')
      cloudAvatar = (await getGitHubSyncService().getUserProfile())?.avatarUrl ?? null
    if (!profile.avatar && provider === 'google')
      cloudAvatar = (await getGoogleDriveService().getUserProfile())?.picture ?? null
    if (!profile.avatar) scope.setCloudAvatar?.(cloudAvatar)
    c.header('Cache-Control', 'no-store')
    return c.json({ ...profile, image: profile.avatar ?? cloudAvatar })
  })

  app.post('/api/profiles/create', async (c) => {
    if (!profileScope.getStore()?.owner) return c.json({ error: 'Owner access required' }, 403)
    try {
      const body = await c.req.json()
      return c.json(getStore()!.create(body.name, body.password))
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid profile' }, 400)
    }
  })

  app.post('/api/profiles/update', async (c) => {
    try {
      const body = await c.req.json()
      const store = getStore()!
      const id = profileScope.getStore()!.id
      store.update(id, body)
      if (body.password !== undefined) {
        if (profileScope.getStore()?.dbs?.db)
          closeTrackerActivityStreams(profileScope.getStore()!.dbs!.db)
        const token = store.login(id, body.password)
        setCookie(c, PROFILE_COOKIE, token, {
          httpOnly: true,
          sameSite: 'Lax',
          path: '/',
          maxAge: 30 * 86400,
          secure: new URL(c.req.url).protocol === 'https:',
        })
      }
      return c.json({ success: true })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid profile' }, 400)
    }
  })

  app.post('/api/profiles/delete', async (c) => {
    if (!profileScope.getStore()?.owner) return c.json({ error: 'Owner access required' }, 403)
    const body = await c.req.json().catch(() => null)
    if (body?.confirm !== true) return c.json({ error: 'Confirmation required' }, 400)
    try {
      const store = getStore()!
      const target = typeof body.id === 'string' ? store.get(body.id) : undefined
      if (target?.owner) return c.json({ error: 'The owner profile cannot be deleted' }, 400)
      if (target) {
        const db = store.scope(target.id).dbs?.db
        if (db) closeTrackerActivityStreams(db)
      }
      store.remove(body.id)
      return c.json({ success: true })
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not delete profile' },
        400
      )
    }
  })
}
