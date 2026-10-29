import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { badRequest, failed, notFound } from '../errors.js'
import { cached } from '../cache.js'
import { TempShowIdsRepository } from '../../repositories/temp-show-ids.repository.js'
import { malSearchMedia, malSearchTitle } from '../../lib/mal/index.js'
import type { AnilistMedia } from '../../lib/anilist/index.js'
import type { BrowseCaps } from '../../providers/remote-types.js'
import logger from '../../logger.js'
import { fromAnilistMedia, searchAnilist, searchAnilistByTitle } from '../../lib/anilist/index.js'
import {
  dataMatureResolveInput,
  dataMatureSearchInput,
  dataMatureAllocateInput,
} from '../schemas/data.js'
import { isMatureStreamingProvider, parseListParam } from '../../lib/resolve-show.js'
import { rankByTitleMatch } from '../../providers/title-matching.js'
import type { Show } from '../../providers/provider.interface.js'

const defaultValidate = (d: unknown) => Array.isArray(d) && d.length > 0

function rankMatureResults(shows: Show[], query: string): Show[] {
  return rankByTitleMatch(shows, query, (show) =>
    [
      show.name,
      show.names?.romaji,
      show.names?.english,
      show.names?.native,
      ...(show.names?.synonyms ?? []),
    ].filter((title): title is string => !!title)
  )
}

export const dataMatureRouter = router({
  matureResolve: protectedProcedure
    .input(dataMatureResolveInput())
    .query(async ({ ctx, input }) => {
      return cached(
        ctx,
        `mature-resolve-${input.title || ''}`,
        3600,
        async () => {
          try {
            const title = (input.title || '').trim()
            if (!title) throw badRequest('title is required')

            const anilistResult = await searchAnilistByTitle(title)
            if (anilistResult) {
              const id = anilistResult.id
              return { id: typeof id === 'number' && id < 0 ? `mal-${Math.abs(id)}` : id }
            }

            const malResult = await malSearchTitle(ctx.malCacheStore(), title)
            if (malResult) return { id: malResult, provider: 'mal' }

            throw notFound('No match found')
          } catch (e) {
            if (e instanceof TRPCError) throw e
            logger.error({ err: e }, 'mature resolve failed')
            throw failed('Resolve failed')
          }
        },
        defaultValidate
      )
    }),

  matureSearch: protectedProcedure.input(dataMatureSearchInput()).query(async ({ ctx, input }) => {
    const provider = (input.provider || 'anilist').toLowerCase()
    if (provider !== 'anilist' && provider !== 'mal' && !isMatureStreamingProvider(ctx, provider)) {
      throw badRequest('Unknown mature provider')
    }
    const queryEntries: Record<string, string> = {}
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) queryEntries[k] = String(v)
    }
    return cached(
      ctx,
      `mature-search-${JSON.stringify(queryEntries)}`,
      600,
      async () => {
        try {
          const query = input.query || ''
          const page = input.page || 1
          const limit = input.limit || 14
          if (provider === 'anilist') {
            const result = await searchAnilist({
              query,
              page,
              perPage: limit,
              format: input.type,
              status: input.status,
              season: input.season,
              seasonYear: input.year,
              countryOfOrigin: input.country,
              genre: input.genres,
              genre_not_in: parseListParam(input.excludeGenres),
              isAdult: true,
              sort: input.sortBy,
            })
            return { data: rankMatureResults(result, query), hasMore: result.length >= limit }
          }
          if (isMatureStreamingProvider(ctx, provider)) {
            const streaming = ctx.getProviders()[provider]
            if (streaming?.browse) {
              const genre = input.genre || input.genres || undefined
              const result = await streaming.browse({
                query,
                page,
                limit,
                pageSize: limit,
                genre,
                genres: input.genres || genre,
                order: input.order || input.sortBy || undefined,
                sort: input.sortBy || input.order || undefined,
                studio: input.studio || undefined,
                blacklist: input.blacklist || undefined,
              })
              return {
                data: rankMatureResults(result.shows, query),
                hasMore: result.hasMore,
                ...(result.total !== undefined ? { total: result.total } : {}),
                ...(result.genres ? { genres: result.genres } : {}),
              }
            }
            const shows = await streaming.search({ query })
            return {
              data: rankMatureResults(
                shows.map((s) => ({ ...s, isAdult: true })),
                query
              ),
              hasMore: false,
            }
          }
          if (provider === 'mal') {
            let result: AnilistMedia[] = []
            try {
              result = await malSearchMedia(ctx.malCacheStore(), {
                query,
                page,
                perPage: 50,
                format: input.type,
                status: input.status,
                genre: input.genres || undefined,
                genre_not_in: parseListParam(input.excludeGenres),
                isAdult: true,
                sort: input.sortBy,
                averageScore_greater: input.minScore,
                episodes_greater: input.minEpisodes,
              })
            } catch (e) {
              logger.error({ err: e }, 'mal mature search failed')
            }
            const shows = result.map((m) => {
              const show = fromAnilistMedia(m)
              return { ...show, isAdult: true }
            })
            const sliced = shows.slice(0, limit)
            return { data: rankMatureResults(sliced, query), hasMore: shows.length >= limit }
          }
          return { data: [], hasMore: false }
        } catch (e) {
          logger.error({ err: e }, 'mature search failed')
          return { data: [], hasMore: false }
        }
      },
      (d) => !!d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data)
    )
  }),

  matureFilters: protectedProcedure.query(async ({ ctx }) => {
    try {
      const catalog = ctx.getCatalog() ?? []
      const providers: Record<
        string,
        { label: string; browse?: BrowseCaps; genres?: string[]; orders?: string[] }
      > = {}
      for (const item of catalog) {
        if (!item.mature || (item.kind ?? 'anime') !== 'anime' || !item.loaded) continue
        providers[item.id] = {
          label: item.label,
          ...(item.browse ? { browse: item.browse } : {}),
          ...(item.facets?.genres?.length ? { genres: item.facets.genres } : {}),
          ...(item.facets?.orders?.length ? { orders: item.facets.orders } : {}),
        }
      }
      return { providers }
    } catch (e) {
      logger.error({ err: e }, 'mature filters failed')
      throw failed('Failed to load filters')
    }
  }),

  matureAllocate: protectedProcedure
    .input(dataMatureAllocateInput())
    .mutation(async ({ ctx, input }) => {
      try {
        const provider = String(input.provider || '').toLowerCase()
        const nativeId = String(input.nativeId || '').trim()
        const title = String(input.title || '').trim()
        const thumbnail = String(input.thumbnail || '')
        if (!provider || !isMatureStreamingProvider(ctx, provider)) {
          throw badRequest('Unknown provider')
        }
        if (!nativeId || !title) {
          throw badRequest('nativeId and title are required')
        }
        const row = await TempShowIdsRepository.allocate(ctx.db, {
          provider,
          nativeId,
          title,
          thumbnail,
        })
        return { id: row.id }
      } catch (e) {
        if (e instanceof TRPCError) throw e
        logger.error({ err: e }, 'temp show allocate failed')
        throw failed('Allocate failed')
      }
    }),
})
