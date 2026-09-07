export const TEMP_SHOW_ID_PREFIX = 'dango-mt-'

export const TEMP_MATURE_PROVIDERS = ['wh', 'op', 'ht', 'hn'] as const

export const isTempShowId = (id: string | undefined | null): boolean =>
  !!id && /^dango-mt-\d+$/.test(id)

export const isTempMatureProvider = (provider: string | undefined | null): boolean =>
  !!provider && (TEMP_MATURE_PROVIDERS as readonly string[]).includes(provider.toLowerCase())

export const isTempSyncRow = (row: Record<string, unknown>): boolean =>
  Object.values(row).some((v) => typeof v === 'string' && v.startsWith(TEMP_SHOW_ID_PREFIX))
