import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { parseJsonBody } from '../../utils/http.utils.js'
import { defineSchema, optStr, reqObj } from '../validation.js'
import type {
  MangaContentRating,
  MangaProviderName,
  MangaProvider,
} from '../../providers/manga/manga.types.js'
import type { TrpcContext } from '../context.js'
import logger from '../../logger.js'

type MangaTrendingItem = {
  id: string
  title: string
  description: string
  tags: string[]
  year: number | null
  status: string | null
  cover: string
}

type MangaDexUpstream = {
  data?: Array<{
    id: string
    attributes?: {
      title?: Record<string, string>
      description?: Record<string, string>
      tags?: Array<{ attributes?: { name?: Record<string, string> } }>
      year?: number
      status?: string
    }
    relationships?: Array<{
      type: string
      attributes?: { fileName?: string }
    }>
  }>
}

const SAFE: MangaContentRating[] = ['safe']

function parseRatings(query: Record<string, string | undefined>): MangaContentRating[] {
  const mature = query['mature'] === '1'
  const raw = String(query['rating'] || 'safe')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is MangaContentRating =>
      ['safe', 'suggestive', 'erotica', 'pornographic'].includes(s)
    )
  if (!mature) return SAFE
  const exact = [...new Set(raw)]
  return exact.length > 0 ? exact : SAFE
}

function pick(ctx: TrpcContext, name: string): MangaProvider | undefined {
  return ctx.getMangaProvider(name.toLowerCase())
}

async function cached(
  ctx: TrpcContext,
  key: string,
  ttl: number | undefined,
  produce: () => Promise<{ status?: number; body: unknown }>
): Promise<unknown> {
  const hit = ctx.apiCache.get<unknown>(key)
  if (hit) return hit
  const result = await produce()
  if ((result.status ?? 200) >= 200 && (result.status ?? 200) < 400) {
    if (ttl !== undefined) ctx.apiCache.set(key, result.body, ttl)
    else ctx.apiCache.set(key, result.body)
  }
  if (result.status !== undefined && result.status !== 200) {
    throw new TRPCError({
      code:
        result.status === 400
          ? 'BAD_REQUEST'
          : result.status === 404
            ? 'NOT_FOUND'
            : 'INTERNAL_SERVER_ERROR',
      message: (result.body as { error?: string })?.error || 'Request failed',
    })
  }
  return result.body
}

export type MangaSearchInput = {
  provider?: string
  q?: string
  page?: number
  limit?: number
  sort?: string
  status?: string
  type?: string
  rating?: string
  mature?: string
}

const mangaSearchInput = () =>
  defineSchema<MangaSearchInput, MangaSearchInput>((value) => {
    const obj = reqObj(value)
    const out: MangaSearchInput = {}
    for (const k of ['provider', 'q', 'sort', 'status', 'type', 'rating', 'mature'] as const) {
      const v = optStr(obj, k)
      if (v !== undefined) out[k] = v
    }
    if (obj.page !== undefined) out.page = parseInt(String(obj.page), 10) || 1
    if (obj.limit !== undefined) out.limit = Math.min(parseInt(String(obj.limit), 10) || 24, 50)
    return out
  })

export type MangaInfoInput = { provider?: string; id?: string; rating?: string; mature?: string }

const mangaInfoInput = () =>
  defineSchema<MangaInfoInput, MangaInfoInput>((value) => {
    const obj = reqObj(value)
    const out: MangaInfoInput = {}
    for (const k of ['provider', 'id', 'rating', 'mature'] as const) {
      const v = optStr(obj, k)
      if (v !== undefined) out[k] = v
    }
    return out
  })

export type MangaPagesInput = { provider?: string; id?: string }

const mangaPagesInput = () =>
  defineSchema<MangaPagesInput, MangaPagesInput>((value) => {
    const obj = reqObj(value)
    const out: MangaPagesInput = {}
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    const id = optStr(obj, 'id')
    if (id !== undefined) out.id = id
    return out
  })

export const mangaRouter = router({
  trending: protectedProcedure.query(async ({ ctx }) => {
    const cacheKey = 'route-manga-trending'
    const cached = ctx.apiCache.get<MangaTrendingItem[]>(cacheKey)
    if (cached) return cached
    try {
      const url =
        'https://api.mangadex.org/manga?limit=6&order%5BfollowedCount%5D=desc&includes%5B%5D=cover_art&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive'
      const upstream = await fetch(url, {
        headers: { 'User-Agent': 'dango/3.1.9' },
      })
      if (!upstream.ok) return []
      const data = await parseJsonBody<MangaDexUpstream>(upstream)
      const results: MangaTrendingItem[] = (data.data || []).map((m) => {
        const title = m.attributes?.title?.en || Object.values(m.attributes?.title || {})[0] || ''
        const desc = m.attributes?.description?.en || ''
        const tags = (m.attributes?.tags || [])
          .map((t) => t.attributes?.name?.en)
          .filter(Boolean) as string[]
        const coverArt = m.relationships?.find((r) => r.type === 'cover_art')
        const fileName = coverArt?.attributes?.fileName
        const cover = fileName
          ? `https://uploads.mangadex.org/covers/${m.id}/${fileName}.512.jpg`
          : ''
        return {
          id: m.id,
          title,
          description: desc,
          tags,
          year: m.attributes?.year || null,
          status: m.attributes?.status || null,
          cover,
        }
      })
      ctx.apiCache.set(cacheKey, results, 600)
      return results
    } catch {
      return []
    }
  }),

  search: protectedProcedure.input(mangaSearchInput()).query(async ({ ctx, input }) => {
    const provider = input.provider || ''
    const q = input.q || ''
    const page = input.page || 1
    return cached(
      ctx,
      `route-manga-search-${provider}-${q}-${page}-${input.sort || ''}-${input.status || ''}-${input.type || ''}-${input.rating || ''}-${input.mature || ''}`,
      300,
      async () => {
        try {
          const ratings = parseRatings({ rating: input.rating, mature: input.mature })
          const rawType = input.type || ''
          const type = rawType === 'doujinshi' && input.mature !== '1' ? '' : rawType
          const result = await pick(ctx, provider as string as MangaProviderName)?.search({
            query: q,
            page,
            limit: input.limit || 24,
            sort: input.sort || 'popular',
            status: input.status || '',
            type,
            ratings,
          })
          return { body: result ?? { items: [], hasNext: false } }
        } catch (err) {
          logger.error({ err }, '[Manga] search failed')
          return { body: { items: [], hasNext: false } }
        }
      }
    )
  }),

  info: protectedProcedure.input(mangaInfoInput()).query(async ({ ctx, input }) => {
    const provider = String(input.provider || '')
    const id = String(input.id || '')
    const rating = String(input.rating || '')
    const mature = String(input.mature || '')
    return cached(ctx, `route-manga-info-${provider}-${id}-${rating}-${mature}`, 600, async () => {
      try {
        if (!id) return { status: 400, body: { error: 'Missing id' } }
        const detail = await pick(ctx, provider as string as MangaProviderName)?.getDetail(
          id,
          parseRatings({ rating, mature })
        )
        if (!detail) return { status: 404, body: { error: 'Not found' } }
        return { body: detail }
      } catch (err) {
        logger.error({ err }, '[Manga] info failed')
        return { status: 500, body: { error: 'Failed to load manga' } }
      }
    })
  }),

  chapters: protectedProcedure.input(mangaInfoInput()).query(async ({ ctx, input }) => {
    const provider = String(input.provider || '')
    const id = String(input.id || '')
    const rating = String(input.rating || '')
    const mature = String(input.mature || '')
    return cached(
      ctx,
      `route-manga-chapters-${provider}-${id}-${rating}-${mature}`,
      600,
      async () => {
        try {
          if (!id) return { status: 400, body: { error: 'Missing id' } }
          const chapters =
            (await pick(ctx, provider as string as MangaProviderName)?.getChapters(
              id,
              parseRatings({ rating, mature })
            )) ?? []
          return { body: { chapters } }
        } catch (err) {
          logger.error({ err }, '[Manga] chapters failed')
          return { body: { chapters: [] } }
        }
      }
    )
  }),

  pages: protectedProcedure.input(mangaPagesInput()).query(async ({ ctx, input }) => {
    const provider = String(input.provider || '')
    const id = String(input.id || '')
    return cached(ctx, `route-manga-pages-${provider}-${id}`, 300, async () => {
      try {
        if (!id) return { status: 400, body: { error: 'Missing id' } }
        const pages = (await pick(ctx, provider as string as MangaProviderName)?.getPages(id)) ?? []
        return { body: { pages } }
      } catch (err) {
        logger.error({ err }, '[Manga] pages failed')
        return { body: { pages: [] } }
      }
    })
  }),
})
