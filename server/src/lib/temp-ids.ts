export const TEMP_SHOW_ID_PREFIX = 'dango-mt-'

export const isTempShowId = (id: string | undefined | null): boolean =>
  !!id && /^dango-mt-\d+$/.test(id)

export const isTempSyncRow = (row: Record<string, unknown>): boolean =>
  Object.values(row).some((v) => typeof v === 'string' && v.startsWith(TEMP_SHOW_ID_PREFIX))
