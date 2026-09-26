type StandardIssue = { message: string }

type StandardResult<T> = { value: T } | { issues: StandardIssue[] }

export type Schema<Input, Output> = {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly types: { readonly input: Input; readonly output: Output }
    validate(value: unknown): StandardResult<Output> | Promise<StandardResult<Output>>
  }
}

export function defineSchema<Input, Output>(
  parse: (value: unknown) => Output
): Schema<Input, Output> {
  return {
    '~standard': {
      version: 1,
      vendor: 'dango',
      types: undefined as unknown as { input: Input; output: Output },
      validate(value: unknown) {
        try {
          return { value: parse(value) }
        } catch (err) {
          return { issues: [{ message: err instanceof Error ? err.message : 'Invalid input' }] }
        }
      },
    },
  }
}

function readKey(value: unknown): string {
  if (typeof value !== 'object' || value === null) throw new Error('Expected an object')
  const key = (value as Record<string, unknown>).key
  if (typeof key !== 'string' || key.length === 0) throw new Error('key must be a string')
  return key
}

export function reqStr(obj: Record<string, unknown>, name: string): string {
  const value = obj[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a string`)
  }
  return value
}

export function optStr(obj: Record<string, unknown>, name: string): string | undefined {
  const value = obj[name]
  if (value === undefined || value === null) return undefined
  return String(value)
}

function reqEpNum(obj: Record<string, unknown>, name: string): string {
  const value = obj[name]
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
    throw new Error(`${name} must be a string`)
  }
  return String(value)
}

export function reqStrArray(
  obj: Record<string, unknown>,
  name: string,
  nonEmpty: boolean
): string[] {
  const value = obj[name]
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new Error(`${name} must be ${nonEmpty ? 'a non-empty ' : 'an '}array`)
  }
  return value.map((ep) => String(ep))
}

export function reqObj(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('Expected an object')
  return value as Record<string, unknown>
}

export const keyInput = () =>
  defineSchema<{ key: string }, { key: string }>((value) => ({ key: readKey(value) }))

export const idInput = () =>
  defineSchema<{ id: string }, { id: string }>((value) => ({ id: reqStr(reqObj(value), 'id') }))

export const showIdInput = () =>
  defineSchema<{ showId: string }, { showId: string }>((value) => ({
    showId: reqStr(reqObj(value), 'showId'),
  }))

export type EpisodeProgressInput = { showId: string; episodeNumber: string }

export const episodeProgressInput = () =>
  defineSchema<EpisodeProgressInput, EpisodeProgressInput>((value) => {
    const obj = reqObj(value)
    return { showId: reqStr(obj, 'showId'), episodeNumber: reqEpNum(obj, 'episodeNumber') }
  })

export const idsInput = () =>
  defineSchema<{ ids: string[] }, { ids: string[] }>((value) => ({
    ids: [...new Set(reqStrArray(reqObj(value), 'ids', true))],
  }))

export type WatchlistAddInput = {
  id: string
  status?: string
  name: string
  thumbnail?: string
  nativeName?: string
  englishName?: string
  type?: string
  isAdult?: boolean
}

export const watchlistAddInput = () =>
  defineSchema<WatchlistAddInput, WatchlistAddInput>((value) => {
    const obj = reqObj(value)
    const out: WatchlistAddInput = { id: reqStr(obj, 'id'), name: reqStr(obj, 'name') }
    const status = optStr(obj, 'status')
    if (status !== undefined) out.status = status
    const thumbnail = optStr(obj, 'thumbnail')
    if (thumbnail !== undefined) out.thumbnail = thumbnail
    const nativeName = optStr(obj, 'nativeName')
    if (nativeName !== undefined) out.nativeName = nativeName
    const englishName = optStr(obj, 'englishName')
    if (englishName !== undefined) out.englishName = englishName
    const type = optStr(obj, 'type')
    if (type !== undefined) out.type = type
    if (typeof obj.isAdult === 'boolean') out.isAdult = obj.isAdult
    return out
  })

export type WatchlistStatusInput = { id: string; status: string }

export const watchlistStatusInput = () =>
  defineSchema<WatchlistStatusInput, WatchlistStatusInput>((value) => {
    const obj = reqObj(value)
    return { id: reqStr(obj, 'id'), status: reqStr(obj, 'status') }
  })

export type WatchlistBatchStatusInput = { ids: string[]; status: string }

export const watchlistBatchStatusInput = () =>
  defineSchema<WatchlistBatchStatusInput, WatchlistBatchStatusInput>((value) => {
    const obj = reqObj(value)
    return { ids: [...new Set(reqStrArray(obj, 'ids', true))], status: reqStr(obj, 'status') }
  })

export type QueueMeta = {
  showName?: string
  showThumbnail?: string
  nativeName?: string
  englishName?: string
  type?: string
}

function readMeta(obj: Record<string, unknown>): QueueMeta {
  return {
    showName: optStr(obj, 'showName'),
    showThumbnail: optStr(obj, 'showThumbnail'),
    nativeName: optStr(obj, 'nativeName'),
    englishName: optStr(obj, 'englishName'),
    type: optStr(obj, 'type'),
  }
}

export type QueueAddInput = QueueMeta & { showId: string; episodeNumber: string }

export const queueAddInput = () =>
  defineSchema<QueueAddInput, QueueAddInput>((value) => {
    const obj = reqObj(value)
    return {
      ...readMeta(obj),
      showId: reqStr(obj, 'showId'),
      episodeNumber: reqEpNum(obj, 'episodeNumber'),
    }
  })

export type QueueBatchInput = QueueMeta & { showId: string; episodeNumbers: string[] }

export const queueBatchInput = () =>
  defineSchema<QueueBatchInput, QueueBatchInput>((value) => {
    const obj = reqObj(value)
    return {
      ...readMeta(obj),
      showId: reqStr(obj, 'showId'),
      episodeNumbers: reqStrArray(obj, 'episodeNumbers', true),
    }
  })

export type QueueRemoveInput = { showId: string; episodeNumber: string }

export const queueRemoveInput = () =>
  defineSchema<QueueRemoveInput, QueueRemoveInput>((value) => {
    const obj = reqObj(value)
    return { showId: reqStr(obj, 'showId'), episodeNumber: reqEpNum(obj, 'episodeNumber') }
  })

export type QueueRemoveManyInput = { showId: string; episodeNumbers?: string[] }

export const queueRemoveManyInput = () =>
  defineSchema<QueueRemoveManyInput, QueueRemoveManyInput>((value) => {
    const obj = reqObj(value)
    const out: QueueRemoveManyInput = { showId: reqStr(obj, 'showId') }
    if (obj.episodeNumbers !== undefined)
      out.episodeNumbers = reqStrArray(obj, 'episodeNumbers', false)
    return out
  })

export type QueueReorderItem = { id?: number; showId?: string; episodeNumber?: string }

export const queueReorderInput = () =>
  defineSchema<QueueReorderItem[], QueueReorderItem[]>((value) => {
    if (!Array.isArray(value)) throw new Error('items must be an array')
    return value.map((item) => {
      const entry = reqObj(item)
      const out: QueueReorderItem = {}
      if (typeof entry.id === 'number') out.id = entry.id
      if (entry.showId !== undefined) out.showId = String(entry.showId)
      if (entry.episodeNumber !== undefined) out.episodeNumber = String(entry.episodeNumber)
      return out
    })
  })

export const setSettingInput = () =>
  defineSchema<{ key: string; value: unknown }, { key: string; value: unknown }>((value) => {
    if (typeof value !== 'object' || value === null) throw new Error('Expected an object')
    return { key: readKey(value), value: (value as Record<string, unknown>).value }
  })

export type NotificationDismissInput = { showId: string; episodeNumber: string }

export const notificationDismissInput = () =>
  defineSchema<NotificationDismissInput, NotificationDismissInput>((value) => {
    const obj = reqObj(value)
    return { showId: reqStr(obj, 'showId'), episodeNumber: reqEpNum(obj, 'episodeNumber') }
  })
