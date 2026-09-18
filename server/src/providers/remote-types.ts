export type RemoteSubType = 'soft' | 'hard' | 'mixed'
export type RemoteTier = 'direct' | 'embed' | 'cookie'

export interface BrowseCaps {
  genre?: boolean
  order?: boolean
  studio?: boolean
  sort?: boolean
  pageSize?: number
}

export interface BrowseFacets {
  genres?: string[]
  orders?: string[]
}

export interface RemoteProviderEntry {
  id: string
  label: string
  version: string
  entry: string
  sha256?: string
  minDango?: string
  mature: boolean
  kind?: 'anime' | 'asmr' | 'manga' | 'tv'
  sub?: RemoteSubType
  tier?: RemoteTier
  modes?: ('sub' | 'dub')[]
  browse?: BrowseCaps
  auth?: 'cookie' | 'none'
  enabledByDefault?: boolean
}

export interface RemoteRegistry {
  version: number
  updatedAt?: string
  providers: RemoteProviderEntry[]
}

export interface ProviderCatalogItem {
  id: string
  label: string
  version: string
  mature: boolean
  kind: 'anime' | 'asmr' | 'manga' | 'tv'
  sub?: RemoteSubType
  tier?: RemoteTier
  modes: ('sub' | 'dub')[]
  browse?: BrowseCaps
  facets?: BrowseFacets
  servers?: string[]
  enabledByDefault: boolean
  loaded: boolean
  remote: boolean
  error?: string
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/i
const SHA_RE = /^[0-9a-f]{64}$/i

export function parseRegistry(raw: unknown): RemoteRegistry {
  if (!raw || typeof raw !== 'object') throw new Error('registry: not an object')
  const r = raw as Record<string, unknown>
  if (typeof r.version !== 'number') throw new Error('registry.version must be a number')
  if (!Array.isArray(r.providers)) throw new Error('registry.providers must be an array')
  const providers = (r.providers as unknown[]).map((p, i) => parseEntry(p, i))
  const seen = new Set<string>()
  for (const p of providers) {
    const key = p.id.toLowerCase()
    if (seen.has(key)) throw new Error(`registry: duplicate provider id "${p.id}"`)
    seen.add(key)
  }
  return {
    version: r.version,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
    providers,
  }
}

function parseEntry(raw: unknown, index: number): RemoteProviderEntry {
  if (!raw || typeof raw !== 'object')
    throw new Error(`registry.providers[${index}]: not an object`)
  const p = raw as Record<string, unknown>
  const id = p.id
  const entry = p.entry
  const label = p.label
  const version = p.version
  if (typeof id !== 'string' || !ID_RE.test(id.trim())) {
    throw new Error(`registry.providers[${index}].id must match ${ID_RE}`)
  }
  if (typeof label !== 'string' || !label.trim()) {
    throw new Error(`registry.providers[${index}].label must be a non-empty string`)
  }
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error(`registry.providers[${index}].version must be a non-empty string`)
  }
  if (typeof entry !== 'string' || !entry.trim()) {
    throw new Error(`registry.providers[${index}].entry must be a non-empty string`)
  }
  if (p.sha256 !== undefined && (typeof p.sha256 !== 'string' || !SHA_RE.test(p.sha256.trim()))) {
    throw new Error(`registry.providers[${index}].sha256 must be 64 hex chars`)
  }
  if (p.mature !== undefined && typeof p.mature !== 'boolean') {
    throw new Error(`registry.providers[${index}].mature must be boolean`)
  }
  if (
    p.kind !== undefined &&
    p.kind !== 'anime' &&
    p.kind !== 'asmr' &&
    p.kind !== 'manga' &&
    p.kind !== 'tv'
  ) {
    throw new Error(`registry.providers[${index}].kind must be anime|asmr|manga|tv`)
  }
  if (p.sub !== undefined && p.sub !== 'soft' && p.sub !== 'hard' && p.sub !== 'mixed') {
    throw new Error(`registry.providers[${index}].sub must be soft|hard|mixed`)
  }
  if (p.tier !== undefined && p.tier !== 'direct' && p.tier !== 'embed' && p.tier !== 'cookie') {
    throw new Error(`registry.providers[${index}].tier must be direct|embed|cookie`)
  }
  let modes: ('sub' | 'dub')[] | undefined
  if (p.modes !== undefined) {
    if (!Array.isArray(p.modes))
      throw new Error(`registry.providers[${index}].modes must be an array`)
    modes = []
    for (const m of p.modes as unknown[]) {
      if (m !== 'sub' && m !== 'dub') {
        throw new Error(`registry.providers[${index}].modes must contain only sub|dub`)
      }
      if (!modes.includes(m)) modes.push(m)
    }
  }
  return {
    id: id.trim(),
    label: (label as string).trim(),
    version: (version as string).trim(),
    entry: (entry as string).trim(),
    sha256: typeof p.sha256 === 'string' ? p.sha256.trim().toLowerCase() : undefined,
    minDango: typeof p.minDango === 'string' ? p.minDango : undefined,
    mature: typeof p.mature === 'boolean' ? p.mature : false,
    kind: p.kind === 'asmr' || p.kind === 'manga' || p.kind === 'tv' ? p.kind : 'anime',
    sub: p.sub as RemoteSubType | undefined,
    tier: p.tier as RemoteTier | undefined,
    modes,
    browse: parseBrowseCaps(p.browse, index),
    auth: p.auth === 'cookie' ? 'cookie' : undefined,
    enabledByDefault: p.enabledByDefault === false ? false : true,
  }
}

function parseBrowseCaps(raw: unknown, index: number): BrowseCaps | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`registry.providers[${index}].browse must be an object`)
  }
  const b = raw as Record<string, unknown>
  const caps: BrowseCaps = {}
  for (const key of ['genre', 'order', 'studio', 'sort'] as const) {
    if (b[key] === undefined) continue
    if (typeof b[key] !== 'boolean') {
      throw new Error(`registry.providers[${index}].browse.${key} must be boolean`)
    }
    caps[key] = b[key]
  }
  if (b.pageSize !== undefined) {
    if (typeof b.pageSize !== 'number' || !Number.isInteger(b.pageSize) || b.pageSize < 1) {
      throw new Error(`registry.providers[${index}].browse.pageSize must be a positive integer`)
    }
    caps.pageSize = b.pageSize
  }
  return caps
}
