import type { DatabaseWrapper } from '../db.js'
import type { AppCache } from '../utils/cache.utils.js'
import type { TvProvider } from '../providers/tv.types.js'
import type { MangaProvider } from '../providers/manga/manga.types.js'
import type { JasmrApi } from '../hono/asmr.js'
import type { Provider } from '../providers/provider.interface.js'
import type { ProviderCatalogItem } from '../providers/remote-types.js'
import { getTokenFromHeaders, hasAppPassword, validateLanSession } from '../app-auth.js'

export type TrpcContext = {
  db: DatabaseWrapper
  mangaDb: DatabaseWrapper
  tvDb: DatabaseWrapper
  asmrDb: DatabaseWrapper
  apiCache: AppCache
  getTvProvider: (name: string) => TvProvider | undefined
  getMangaProvider: (name: string) => MangaProvider | undefined
  getJasmr: () => JasmrApi | undefined
  getProviders: () => Record<string, Provider>
  getCatalog: () => ProviderCatalogItem[]
  lanAuthed: boolean
}

export function buildTrpcContext(
  deps: {
    db: DatabaseWrapper
    mangaDb: DatabaseWrapper
    tvDb: DatabaseWrapper
    asmrDb: DatabaseWrapper
    apiCache: AppCache
    getTvProvider: (name: string) => TvProvider | undefined
    getMangaProvider: (name: string) => MangaProvider | undefined
    getJasmr: () => JasmrApi | undefined
    getProviders: () => Record<string, Provider>
    getCatalog: () => ProviderCatalogItem[]
  },
  authorization: string | undefined,
  cookie: string | undefined
): TrpcContext {
  return {
    ...deps,
    lanAuthed: !hasAppPassword() || validateLanSession(getTokenFromHeaders(authorization, cookie)),
  }
}
