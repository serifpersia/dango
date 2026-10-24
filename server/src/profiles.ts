import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parse } from 'dotenv'
import { hashAppPassword, verifyPasswordHash } from './app-auth.js'
import { INSTALL_CONFIG } from './config.js'
import { profileScope, type ProfileScope } from './profile-scope.js'
import type { HonoDbs } from './app-hono.js'
import {
  initializeDatabase,
  initializeMangaDatabase,
  initializeTvDatabase,
  initializeAsmrDatabase,
} from './db/ddl.js'
import type { Profile } from './profile.types.js'
import logger from './logger.js'

type ProfileRow = {
  id: string
  name: string
  owner: number
  password: string
  avatar: string | null
}
const sessionLifetime = 30 * 24 * 60 * 60 * 1000
const profileColumns = `id, name, owner, password != '' AS protected, cloudAvatar,
  CASE WHEN avatar IS NOT NULL THEN '/api/profiles/avatar/' || id || '?v=' || avatarVersion ELSE NULL END AS avatar`
export const PROFILE_COOKIE = 'dango_profile'

export function validateAvatar(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 2_800_000)
    throw new Error('Image must be smaller than 2 MB')
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw new Error('Use a PNG, JPEG, WebP, or GIF image')
  const bytes = Buffer.from(match[2], 'base64')
  const valid =
    match[1] === 'png'
      ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : match[1] === 'jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : match[1] === 'gif'
          ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
          : bytes.subarray(0, 4).toString() === 'RIFF' &&
            bytes.subarray(8, 12).toString() === 'WEBP'
  if (!valid || bytes.length > 2 * 1024 * 1024) throw new Error('Invalid image')
  return value
}

function validName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
    throw new Error('Name must contain 1–60 characters')
  return name.trim()
}

function validPassword(password: unknown): string {
  if (
    typeof password !== 'string' ||
    password.length > 256 ||
    (password.length > 0 && password.length < 8)
  )
    throw new Error('Use at least 8 characters, or leave the password empty')
  return password ? hashAppPassword(password) : ''
}

export class ProfileStore {
  readonly root: string
  readonly dev: boolean
  onOpen?: (dbs: HonoDbs) => Promise<void>
  onDelete?: (dbs: HonoDbs) => void
  private registry: DatabaseSync
  private scopes = new Map<string, ProfileScope>()
  private databases = new Map<string, Promise<HonoDbs>>()
  private oauth = new Map<string, { profileId: string; expires: number }>()

  constructor(root: string = INSTALL_CONFIG.ROOT, dev = INSTALL_CONFIG.IS_DEV) {
    this.root = root
    this.dev = dev
    fs.mkdirSync(root, { recursive: true })
    this.registry = new DatabaseSync(path.join(root, dev ? 'accounts.dev.db' : 'accounts.db'))
    this.registry.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner INTEGER NOT NULL DEFAULT 0, password TEXT NOT NULL DEFAULT '', avatar TEXT, avatarVersion INTEGER NOT NULL DEFAULT 0, cloudAvatar TEXT);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, profileId TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cloud_accounts (provider TEXT NOT NULL, account TEXT NOT NULL, profileId TEXT NOT NULL, PRIMARY KEY (provider, account), UNIQUE (provider, profileId));
      CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);
      INSERT OR IGNORE INTO profiles (id, name, owner) VALUES ('default', 'Default', 1);
    `)
    if (
      !(this.registry.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]).some(
        (column) => column.name === 'deleted'
      )
    ) {
      this.registry.exec('ALTER TABLE profiles ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
    }
    this.cleanupDeletedProfiles()
    this.registry.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now())
  }

  list(): Profile[] {
    return this.registry
      .prepare(
        `SELECT ${profileColumns} FROM profiles WHERE deleted = 0 ORDER BY owner DESC, rowid`
      )
      .all()
      .map((row) => this.publicProfile(row as unknown as Profile))
  }

  get(id: string): Profile | undefined {
    const row = this.registry
      .prepare(`SELECT ${profileColumns} FROM profiles WHERE id = ? AND deleted = 0`)
      .get(id)
    return row ? this.publicProfile(row as unknown as Profile) : undefined
  }

  resolve(token?: string): Profile | undefined {
    if (token) {
      const row = this.registry
        .prepare('SELECT profileId FROM sessions WHERE token = ? AND expires > ?')
        .get(this.digest(token), Date.now()) as { profileId: string } | undefined
      if (row) return this.get(row.profileId)
      return undefined
    }
    const count = this.registry
      .prepare('SELECT COUNT(*) AS n FROM profiles WHERE deleted = 0')
      .get() as { n: number }
    const profile = count.n === 1 ? this.get('default') : undefined
    return profile && !profile.protected ? profile : undefined
  }

  login(id: string, password: string): string {
    const row = this.registry
      .prepare('SELECT * FROM profiles WHERE id = ? AND deleted = 0')
      .get(id) as ProfileRow | undefined
    if (!row || (row.password && !verifyPasswordHash(password, row.password)))
      throw new Error('Invalid profile or password')
    const token = crypto.randomBytes(32).toString('hex')
    this.registry
      .prepare('INSERT INTO sessions VALUES (?, ?, ?)')
      .run(this.digest(token), id, Date.now() + sessionLifetime)
    return token
  }

  logout(token: string) {
    this.registry.prepare('DELETE FROM sessions WHERE token = ?').run(this.digest(token))
  }

  beginOAuth(id: string) {
    for (const [key, value] of this.oauth) if (value.expires < Date.now()) this.oauth.delete(key)
    const state = crypto.randomBytes(32).toString('hex')
    this.oauth.set(state, { profileId: id, expires: Date.now() + 10 * 60 * 1000 })
    return state
  }

  finishOAuth(id: string, state: string) {
    const pending = this.oauth.get(state)
    this.oauth.delete(state)
    return pending?.profileId === id && pending.expires > Date.now()
  }

  create(name: unknown, password: unknown): Profile {
    if (!this.get('default')?.protected)
      throw new Error('Protect the owner profile with a password before adding profiles')
    if (this.list().length >= 20) throw new Error('A maximum of 20 profiles is supported')
    const id = crypto.randomUUID()
    this.registry
      .prepare('INSERT INTO profiles (id, name, password) VALUES (?, ?, ?)')
      .run(id, validName(name), validPassword(password))
    return this.get(id)!
  }

  update(
    id: string,
    input: { name?: unknown; password?: unknown; currentPassword?: unknown; avatar?: unknown }
  ) {
    const row = this.registry
      .prepare('SELECT * FROM profiles WHERE id = ? AND deleted = 0')
      .get(id) as ProfileRow | undefined
    if (!row) throw new Error('Profile not found')
    let password = row.password
    if (input.password !== undefined) {
      if (
        row.password &&
        (typeof input.currentPassword !== 'string' ||
          !verifyPasswordHash(input.currentPassword, row.password))
      )
        throw new Error('Current password is incorrect')
      password = validPassword(input.password)
      if (row.owner && !password && this.list().length > 1)
        throw new Error('The owner must keep a password while multiple profiles exist')
    }
    this.registry
      .prepare(
        'UPDATE profiles SET name = ?, password = ?, avatar = ?, avatarVersion = avatarVersion + ? WHERE id = ?'
      )
      .run(
        input.name === undefined ? row.name : validName(input.name),
        password,
        input.avatar === undefined ? row.avatar : validateAvatar(input.avatar),
        input.avatar === undefined ? 0 : 1,
        id
      )
    if (input.password !== undefined)
      this.registry.prepare('DELETE FROM sessions WHERE profileId = ?').run(id)
  }

  scope(id: string): ProfileScope {
    if (!this.get(id)) throw new Error('Unknown profile')
    let scope = this.scopes.get(id)
    if (!scope) {
      if (!this.get(id)) throw new Error('Unknown profile')
      const root = id === 'default' ? this.root : path.join(this.root, 'profiles', id)
      fs.mkdirSync(root, { recursive: true })
      const envPath = path.join(root, '.env')
      const env: Record<string, string | undefined> = fs.existsSync(envPath)
        ? parse(fs.readFileSync(envPath))
        : {}
      if (id === 'default' && this.root === INSTALL_CONFIG.ROOT) {
        for (const key of [
          'GITHUB_TOKEN',
          'GITHUB_CLIENT_ID',
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
          'GOOGLE_AUTH_WORKER_URL',
          'RCLONE_REMOTE',
          'SYNC_PROVIDER',
        ])
          env[key] ??= process.env[key]
      }
      scope = {
        id,
        root,
        env,
        beginOAuth: () => this.beginOAuth(id),
        claimCloud: (provider, account) => this.claimCloud(id, provider, account),
        setCloudAvatar: (image) => {
          this.registry
            .prepare('UPDATE profiles SET cloudAvatar = ? WHERE id = ? AND deleted = 0')
            .run(image?.startsWith('https://') ? image : null, id)
        },
      }
      this.scopes.set(id, scope)
    }
    return scope
  }

  attachDefault(dbs: HonoDbs) {
    if (!this.registry.prepare("SELECT name FROM migrations WHERE name = 'profiles'").get()) {
      const backupRoot = path.join(this.root, this.dev ? 'before-profiles.dev' : 'before-profiles')
      fs.mkdirSync(backupRoot, { recursive: true })
      for (const [kind, db] of Object.entries(dbs)) db.backup(path.join(backupRoot, `${kind}.db`))
      for (const file of ['.env', 'google_tokens.json', 'lan_sessions.json']) {
        const source = path.join(this.root, file)
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backupRoot, file))
      }
      this.registry.prepare("INSERT INTO migrations VALUES ('profiles')").run()
    }
    this.databases.set('default', Promise.resolve(dbs))
  }

  load(id: string): Promise<HonoDbs> {
    if (!this.get(id)) return Promise.reject(new Error('Unknown profile'))
    let promise = this.databases.get(id)
    if (!promise) {
      const scope = this.scope(id)
      promise = profileScope.run(scope, async () => {
        const suffix = this.dev ? '.dev.db' : '.db'
        const opened: HonoDbs = {
          db: await initializeDatabase(path.join(scope.root, `anime${suffix}`)),
          mangaDb: await initializeMangaDatabase(path.join(scope.root, `manga${suffix}`)),
          tvDb: await initializeTvDatabase(path.join(scope.root, `tv${suffix}`)),
          asmrDb: await initializeAsmrDatabase(path.join(scope.root, `asmr${suffix}`)),
        }
        scope.dbs = opened
        scope.owner = this.get(id)?.owner
        await this.onOpen?.(opened)
        return opened
      })
      this.databases.set(id, promise)
    }
    return promise
  }

  async each(task: (dbs: HonoDbs, profile: Profile) => Promise<void>) {
    for (const profile of this.list()) {
      if (!this.get(profile.id)) continue
      const dbs = await this.load(profile.id)
      if (!this.get(profile.id)) continue
      await profileScope.run(this.scope(profile.id), () => task(dbs, profile))
    }
  }

  async close() {
    for (const dbs of await Promise.all(this.databases.values()))
      for (const db of Object.values(dbs)) db.close()
    this.registry.close()
  }

  private digest(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex')
  }

  getAvatar(id: string): string | null {
    return (
      (
        this.registry
          .prepare('SELECT avatar FROM profiles WHERE id = ? AND deleted = 0')
          .get(id) as { avatar: string | null } | undefined
      )?.avatar ?? null
    )
  }

  private publicProfile(row: Profile): Profile {
    return { ...row, owner: !!row.owner, protected: !!row.protected }
  }

  private claimCloud(id: string, provider: string, account: string | null) {
    if (account !== null && !this.get(id)) throw new Error('Profile has been deleted')
    if (account === null) {
      this.registry
        .prepare('DELETE FROM cloud_accounts WHERE provider = ? AND profileId = ?')
        .run(provider, id)
      return
    }
    const existing = this.registry
      .prepare('SELECT profileId FROM cloud_accounts WHERE provider = ? AND account = ?')
      .get(provider, account) as { profileId: string } | undefined
    if (existing && existing.profileId !== id)
      throw new Error(
        'This cloud account is already connected to another profile. Use a separate account to keep libraries independent.'
      )
    this.registry
      .prepare('DELETE FROM cloud_accounts WHERE provider = ? AND profileId = ?')
      .run(provider, id)
    this.registry.prepare('INSERT INTO cloud_accounts VALUES (?, ?, ?)').run(provider, account, id)
  }

  remove(id: unknown) {
    if (typeof id !== 'string') throw new Error('Profile ID is required')
    const profile = this.get(id)
    if (!profile) throw new Error('Profile not found')
    if (profile.owner) throw new Error('The owner profile cannot be deleted')
    this.registry.exec('BEGIN IMMEDIATE')
    try {
      this.registry
        .prepare(
          "UPDATE profiles SET deleted = 1, name = '', password = '', avatar = NULL, cloudAvatar = NULL WHERE id = ?"
        )
        .run(id)
      this.registry.prepare('DELETE FROM sessions WHERE profileId = ?').run(id)
      this.registry.prepare('DELETE FROM cloud_accounts WHERE profileId = ?').run(id)
      this.registry.exec('COMMIT')
    } catch (error) {
      this.registry.exec('ROLLBACK')
      throw error
    }
    const scope = this.scopes.get(id)
    if (scope) {
      profileScope.run(scope, () => {
        if (scope.dbs) this.onDelete?.(scope.dbs)
      })
      scope.deleted = true
      scope.env = {}
    }
    for (const [state, pending] of this.oauth)
      if (pending.profileId === id) this.oauth.delete(state)
  }

  private cleanupDeletedProfiles() {
    // shortcut: clean files on restart so in-flight jobs can finish; drain jobs first if immediate cleanup is needed.
    const profilesRoot = path.resolve(this.root, 'profiles')
    for (const { id } of this.registry
      .prepare('SELECT id FROM profiles WHERE deleted = 1')
      .all() as { id: string }[]) {
      const target = path.resolve(profilesRoot, id)
      if (!/^[a-f0-9-]{36}$/.test(id) || path.dirname(target) !== profilesRoot)
        throw new Error('Invalid deleted profile path')
      try {
        fs.rmSync(target, { recursive: true, force: true })
        this.registry.prepare('DELETE FROM profiles WHERE id = ? AND deleted = 1').run(id)
      } catch (err) {
        logger.warn({ err, id }, 'Deleted profile cleanup will retry on the next restart')
      }
    }
  }
}
