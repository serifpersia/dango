import type { TrpcContext } from '../trpc/context.js'
import type { Provider } from '../providers/provider.interface.js'

export function getProvider(ctx: TrpcContext, queryProvider: string | undefined): Provider | null {
  const providerName = queryProvider?.toLowerCase()
  if (!providerName) return null
  return ctx.getProviders()[providerName] || null
}
export function isMatureStreamingProvider(
  ctx: TrpcContext,
  provider: string | undefined | null
): boolean {
  const key = (provider || '').toLowerCase()
  const providers = ctx.getProviders()
  if (!key || !providers[key] || key === 'mal' || key === 'anilist') return false
  const mature = matureStreamingIds(ctx)
  return mature ? mature.has(key) : true
}

export function matureStreamingIds(ctx: TrpcContext): Set<string> | null {
  const catalog = ctx.getCatalog()
  if (!catalog || catalog.length === 0) return null
  return new Set(
    catalog
      .filter(
        (c) => c.mature && ((c.kind ?? 'anime') === 'anime' || c.kind === 'adult') && c.loaded
      )
      .map((c) => c.id.toLowerCase())
  )
}

export async function resolveMatureStreamingId(
  ctx: TrpcContext,
  title: string,
  wanted?: string
): Promise<{ provider: Provider; nativeId: string } | null> {
  const providers = ctx.getProviders()
  const mature = matureStreamingIds(ctx)
  const pool = mature ? [...mature] : Object.keys(providers)
  const names = [wanted, ...pool].filter(
    (p): p is string => !!p && p !== 'mal' && p !== 'anilist' && !!providers[p]
  )
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    try {
      const resolved = await providers[name].resolveShowId?.(title)
      if (resolved) return { provider: providers[name], nativeId: resolved }
    } catch {
      // ignore
    }
  }
  return null
}

export function parseListParam(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const list = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}
