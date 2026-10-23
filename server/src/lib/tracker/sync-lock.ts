import type { DatabaseWrapper } from '../../db.js'

const locks = new WeakMap<DatabaseWrapper, Map<string, Promise<unknown>>>()
// Keep manual list sync and background episode writes ordered for each account.
export function withTrackerLock<T>(
  db: DatabaseWrapper,
  provider: string,
  task: () => Promise<T>
): Promise<T> {
  let accountLocks = locks.get(db)
  if (!accountLocks) {
    accountLocks = new Map()
    locks.set(db, accountLocks)
  }
  const previous = accountLocks.get(provider) || Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  accountLocks.set(provider, next)
  void next
    .finally(() => {
      if (accountLocks.get(provider) === next) accountLocks.delete(provider)
    })
    .catch(() => {})
  return next
}
