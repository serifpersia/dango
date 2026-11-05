import fs from 'fs/promises'
import { existsSync } from 'fs'
import type { DatabaseWrapper } from '../db.js'
import { runTx } from './drizzle.js'
import { dbGet } from '../utils/db-utils.js'
import { CONFIG } from '../config.js'
import { isFrozen } from '../frozen.js'

export async function getLocalManifestVersion(
  manifestPath: string = CONFIG.LOCAL_MANIFEST_PATH
): Promise<number> {
  if (existsSync(manifestPath)) {
    try {
      const content = await fs.readFile(manifestPath, 'utf-8')
      return JSON.parse(content).version || 0
    } catch {
      return 0
    }
  }
  return 0
}

export async function setLocalManifestVersion(
  version: number,
  manifestPath: string = CONFIG.LOCAL_MANIFEST_PATH
): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify({ version }))
}

export async function performWriteTransactionAsync(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => Promise<void>,
  setVersion: (version: number) => Promise<void> = (v) => setLocalManifestVersion(v),
  opts?: { allowWhenFrozen?: boolean }
): Promise<void> {
  if (isFrozen() && !opts?.allowWhenFrozen) return
  await runTx(db, async (tx) => {
    await runnable(tx)
    tx.run("UPDATE sync_metadata SET value = value + 1 WHERE key = 'db_version'")
  })

  const row = dbGet<{ value: number }>(
    db,
    "SELECT value FROM sync_metadata WHERE key = 'db_version'"
  )
  const newVersion = row?.value ?? 1

  await setVersion(newVersion)
}

export async function performMangaWriteTransactionAsync(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => Promise<void>,
  opts?: { allowWhenFrozen?: boolean }
): Promise<void> {
  await performWriteTransactionAsync(
    db,
    runnable,
    (v) => setLocalManifestVersion(v, CONFIG.MANGA_LOCAL_MANIFEST_PATH),
    opts
  )
}

export async function performTvWriteTransactionAsync(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => Promise<void>,
  opts?: { allowWhenFrozen?: boolean }
): Promise<void> {
  await performWriteTransactionAsync(
    db,
    runnable,
    (v) => setLocalManifestVersion(v, CONFIG.TV_LOCAL_MANIFEST_PATH),
    opts
  )
}

export async function performAsmrWriteTransactionAsync(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => Promise<void>,
  opts?: { allowWhenFrozen?: boolean }
): Promise<void> {
  await performWriteTransactionAsync(
    db,
    runnable,
    (v) => setLocalManifestVersion(v, CONFIG.ASMR_LOCAL_MANIFEST_PATH),
    opts
  )
}
