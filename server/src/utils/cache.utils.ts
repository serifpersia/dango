import { LRUCache } from 'lru-cache'

export interface AppCacheOptions {
  ttlSeconds?: number
  maxKeys?: number
}

export class AppCache {
  private cache: LRUCache<string, object>

  constructor(options: AppCacheOptions = {}) {
    this.cache = new LRUCache<string, object>({
      max: options.maxKeys ?? 5000,
      ttl: (options.ttlSeconds ?? 3600) * 1000,
    })
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined
  }

  set(key: string, value: unknown, ttlSeconds?: number): void {
    const entry = value as object
    if (ttlSeconds === undefined) {
      this.cache.set(key, entry)
    } else {
      this.cache.set(key, entry, { ttl: ttlSeconds * 1000 })
    }
  }
}
