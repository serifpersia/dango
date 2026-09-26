import { protectedProcedure, router } from '../index.js'
import { defineSchema, optStr, reqObj, reqStr } from '../validation.js'
import type { TrpcContext } from '../context.js'
import { authRequiredError } from '../errors.js'
import logger from '../../logger.js'

async function cached<T>(
  ctx: TrpcContext,
  key: string,
  ttl: number | undefined,
  produce: () => Promise<T>
): Promise<T> {
  const hit = ctx.apiCache.get<T>(key)
  if (hit) return hit
  const body = await produce()
  if (ttl !== undefined) ctx.apiCache.set(key, body, ttl)
  else ctx.apiCache.set(key, body)
  return body
}

export type AsmrBrowseInput = { q?: string; page?: number; sort?: string; rating?: string }

const asmrBrowseInput = () =>
  defineSchema<AsmrBrowseInput, AsmrBrowseInput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    const out: AsmrBrowseInput = {}
    const q = optStr(obj, 'q')
    if (q !== undefined) out.q = q
    if (obj.page !== undefined) out.page = parseInt(String(obj.page), 10) || 1
    const sort = optStr(obj, 'sort')
    if (sort !== undefined) out.sort = sort
    const rating = optStr(obj, 'rating')
    if (rating !== undefined) out.rating = rating
    return out
  })

export type AsmrWorkInput = { rj: string }

const asmrWorkInput = () =>
  defineSchema<AsmrWorkInput, AsmrWorkInput>((value) => ({ rj: reqStr(reqObj(value), 'rj') }))

export const asmrRouter = router({
  browse: protectedProcedure.input(asmrBrowseInput()).query(async ({ ctx, input }) => {
    const q = input.q || ''
    const page = input.page || 1
    const sort = input.sort || ''
    const rating = input.rating || ''
    return cached(
      ctx,
      `route-asmr-browse-${q}-${page}-${sort}-${rating}-${sort === 'random' ? Date.now() : ''}`,
      300,
      async () => {
        try {
          const provider = ctx.getJasmr()
          if (!provider) return { shows: [], hasNext: false }
          return await provider.browse({ query: q, page, sort, rating })
        } catch (err) {
          if ((err as Error).message === 'AUTH_REQUIRED') throw authRequiredError('jasmr')
          logger.error({ err }, '[Asmr] browse failed')
          return { shows: [], hasNext: false }
        }
      }
    )
  }),

  work: protectedProcedure.input(asmrWorkInput()).query(async ({ ctx, input }) => {
    const rj = input.rj
    return cached(ctx, `route-asmr-work-${rj}`, 1800, async () => {
      try {
        const provider = ctx.getJasmr()
        if (!provider) {
          return { rjCode: rj, description: '', tracks: [], images: [], chapters: [] }
        }
        const rjCode = String(rj).trim().toUpperCase()
        const episodes = await provider.getEpisodes(rjCode)
        const [streams, images, chapters] = await Promise.all([
          provider.getStreamUrls(rjCode, '1'),
          provider.getImages(rjCode),
          provider.getChapters(rjCode),
        ])
        return {
          rjCode,
          description: episodes?.description || '',
          tracks: streams?.[0]?.links || [],
          images,
          chapters,
        }
      } catch (err) {
        if ((err as Error).message === 'AUTH_REQUIRED') throw authRequiredError('jasmr')
        logger.error({ err, rj }, '[Asmr] work fetch failed')
        return { rjCode: rj, description: '', tracks: [], images: [], chapters: [] }
      }
    })
  }),
})
