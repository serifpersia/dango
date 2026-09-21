import fs from 'fs'
import os from 'os'
import path from 'path'
import dotenv from 'dotenv'
import { SHIPPED_DEFAULTS } from './shipped-defaults.js'

export const SERVER_ROOT = path.resolve(import.meta.dirname, '..')
const PACKAGE_ROOT = path.resolve(SERVER_ROOT, '..')

function resolveDataRoot() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'dango')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dango')
  }

  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, 'dango')
  }

  return path.join(os.homedir(), '.local', 'share', 'dango')
}

function moveFileIfNeeded(sourcePath: string, destinationPath: string) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(destinationPath)) {
    return
  }

  try {
    fs.renameSync(sourcePath, destinationPath)
  } catch {
    fs.copyFileSync(sourcePath, destinationPath)
    fs.unlinkSync(sourcePath)
  }
}

function migrateLegacyData(packageServerRoot: string, dataRoot: string) {
  const legacyFiles = [
    '.env',
    'google_tokens.json',
    'sync_manifest.json',
    'sync_manifest.dev.json',
    'anime.db',
    'anime.db-shm',
    'anime.db-wal',
    'anime.dev.db',
    'anime.dev.db-shm',
    'anime.dev.db-wal',
  ]

  fs.mkdirSync(dataRoot, { recursive: true })

  for (const filename of legacyFiles) {
    moveFileIfNeeded(path.join(packageServerRoot, filename), path.join(dataRoot, filename))
  }

  // Manga library database + manifests (added after anime DB; migrate if present)
  for (const filename of [
    'manga.db',
    'manga.db-shm',
    'manga.db-wal',
    'manga.dev.db',
    'manga.dev.db-shm',
    'manga.dev.db-wal',
    'manga.sync_manifest.json',
    'manga.sync_manifest.dev.json',
  ]) {
    moveFileIfNeeded(path.join(packageServerRoot, filename), path.join(dataRoot, filename))
  }
}

function resolveLegacyDataRoot() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'ani-web')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'ani-web')
  }

  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, 'ani-web')
  }

  return path.join(os.homedir(), '.local', 'share', 'ani-web')
}

function migrateFromAniWeb(dataRoot: string) {
  const legacyRoot = resolveLegacyDataRoot()
  if (legacyRoot === dataRoot) return
  if (!fs.existsSync(legacyRoot)) return

  const filesToMigrate = [
    '.env',
    'google_tokens.json',
    'sync_manifest.json',
    'sync_manifest.dev.json',
    'anime.db',
    'anime.db-shm',
    'anime.db-wal',
    'anime.dev.db',
    'anime.dev.db-shm',
    'anime.dev.db-wal',
  ]

  fs.mkdirSync(dataRoot, { recursive: true })

  for (const filename of filesToMigrate) {
    moveFileIfNeeded(path.join(legacyRoot, filename), path.join(dataRoot, filename))
  }
}

const DATA_ROOT = resolveDataRoot()
const ENV_PATH = path.join(DATA_ROOT, '.env')

migrateLegacyData(SERVER_ROOT, DATA_ROOT)
migrateFromAniWeb(DATA_ROOT)

dotenv.config({ path: path.join(SERVER_ROOT, '.env') })
dotenv.config({ path: ENV_PATH, override: true })

const IS_DEV = process.argv.includes('--dev')
const PORT = 3000
const HOST = process.env.HOST || '0.0.0.0'
const GOOGLE_REDIRECT_URI = IS_DEV
  ? 'http://localhost:5173/api/auth/google/callback'
  : `http://localhost:${PORT}/api/auth/google/callback`

export const CONFIG = {
  ROOT: DATA_ROOT,
  SERVER_ROOT,
  PACKAGE_ROOT,
  ENV_PATH,
  TOKEN_PATH: path.join(DATA_ROOT, 'google_tokens.json'),
  LOCAL_MANIFEST_PATH: path.join(
    DATA_ROOT,
    IS_DEV ? 'sync_manifest.dev.json' : 'sync_manifest.json'
  ),
  MANGA_LOCAL_MANIFEST_PATH: path.join(
    DATA_ROOT,
    IS_DEV ? 'manga.sync_manifest.dev.json' : 'manga.sync_manifest.json'
  ),
  DB_NAME_PROD: 'anime.db',
  DB_NAME_DEV: 'anime.dev.db',
  MANGA_DB_NAME_PROD: 'manga.db',
  MANGA_DB_NAME_DEV: 'manga.dev.db',
  REMOTE_FOLDER_PROD: 'dango_db',
  REMOTE_FOLDER_DEV: 'dango_dev_db',
  MANIFEST_FILENAME: IS_DEV ? 'sync_manifest.dev.json' : 'sync_manifest.json',
  GOOGLE_SCOPES: [
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  GOOGLE_SYNC_FILENAME: IS_DEV ? 'sync.dev.json' : 'sync.json',
  MANGA_GOOGLE_SYNC_FILENAME: IS_DEV ? 'manga.sync.dev.json' : 'manga.sync.json',
  RCLONE_SYNC_FILENAME: IS_DEV ? 'sync.dev.json' : 'sync.json',
  MANGA_RCLONE_SYNC_FILENAME: IS_DEV ? 'manga.sync.dev.json' : 'manga.sync.json',
  IS_DEV,
  PORT,
  HOST,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: GOOGLE_REDIRECT_URI,
  GOOGLE_AUTH_WORKER_URL:
    process.env.GOOGLE_AUTH_WORKER_URL || SHIPPED_DEFAULTS.GOOGLE_AUTH_WORKER_URL || '',
  RCLONE_REMOTE: process.env.RCLONE_REMOTE,
  SYNC_PROVIDER: process.env.SYNC_PROVIDER as 'github' | 'google' | 'rclone' | 'none' | undefined,
  DISCORD_CLIENT_ID:
    process.env.DISCORD_CLIENT_ID || SHIPPED_DEFAULTS.DISCORD_CLIENT_ID || undefined,
  DISCORD_ROLES_WORKER_URL:
    process.env.DISCORD_ROLES_WORKER_URL || SHIPPED_DEFAULTS.DISCORD_ROLES_WORKER_URL || '',
  APP_PASSWORD_HASH: process.env.APP_PASSWORD_HASH || '',
  PROVIDER_REPO_URL: process.env.PROVIDER_REPO_URL || SHIPPED_DEFAULTS.PROVIDER_REPO_URL || '',
  PROVIDER_ENABLED: process.env.PROVIDER_ENABLED || '',
  PROVIDER_REPO_REFRESH_MS: parseInt(process.env.PROVIDER_REPO_REFRESH_MS || '', 10) || 21600000,
}
