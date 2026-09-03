import logger from '../../logger'
import { waitForAnilistSlot, applyRateLimitHeaders } from '../anilist'

const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co'

export type AniListMediaListStatus = 'CURRENT' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'PLANNING'

export const ANILIST_TO_DANGO_STATUS: Record<AniListMediaListStatus, string> = {
  CURRENT: 'Watching',
  COMPLETED: 'Completed',
  PAUSED: 'On-Hold',
  DROPPED: 'Dropped',
  PLANNING: 'Planned',
}

export const DANGO_TO_ANILIST_STATUS: Record<string, AniListMediaListStatus> = {
  Watching: 'CURRENT',
  Completed: 'COMPLETED',
  'On-Hold': 'PAUSED',
  Dropped: 'DROPPED',
  Planned: 'PLANNING',
}

export interface AnilistViewer {
  id: number
  name: string
  avatar?: string
}

export interface RemoteMediaEntry {
  mediaId: number
  entryId?: number
  idMal?: number
  status: string
  progress: number
  score?: number
  updatedAt: number
  title: { romaji?: string; english?: string; native?: string }
  coverImage?: string
  totalEpisodes?: number
}

interface RequestOptions {
  retries?: number
}

export async function exchangeAuthorizationCode(): Promise<{ access_token: string }> {
  throw new Error(
    'Authorization Code flow removed — use Implicit Grant (response_type=token) instead.'
  )
}

export class AniListTracker {
  constructor(private token?: string) {}

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async request<T = Record<string, unknown>>(
    query: string,
    variables: Record<string, unknown> = {},
    options: RequestOptions = {}
  ): Promise<T> {
    const retries = options.retries ?? 3

    await waitForAnilistSlot()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`

    let response: Response
    try {
      response = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      })
    } catch (err) {
      logger.error({ err }, '[AniList Tracker] Network error')
      throw new Error('Could not reach AniList. Please try again later.', { cause: err })
    }

    applyRateLimitHeaders(response.headers)

    if (response.status === 429) {
      if (retries <= 0) throw new Error('AniList rate limit reached, try again later')
      const retryHeader = response.headers.get('retry-after')
      const waitSeconds = retryHeader ? Number.parseInt(retryHeader, 10) || 60 : 60
      logger.warn({ waitSeconds }, '[AniList Tracker] Rate limited, waiting before retry')
      await this.sleep(Math.min(waitSeconds, 60) * 1000)
      return this.request<T>(query, variables, { retries: retries - 1 })
    }

    if (!response.ok && response.status === 401) {
      throw new Error('AniList token is invalid or expired. Please reconnect your account.')
    }

    if (!response.ok) {
      throw new Error(`AniList request failed with status ${response.status}`)
    }

    const json = (await response.json()) as {
      data?: T | null
      errors?: { message: string }[]
    }

    if (json.errors && !json.data) {
      throw new Error(json.errors.map((e) => e.message).join(', '))
    }

    return json.data as T
  }

  async getViewer(): Promise<AnilistViewer> {
    const query = `
      query {
        Viewer {
          id
          name
          avatar { medium }
        }
      }
    `
    const data = await this.request<{
      Viewer: { id: number; name: string; avatar?: { medium?: string } }
    }>(query)
    return {
      id: data.Viewer.id,
      name: data.Viewer.name,
      avatar: data.Viewer.avatar?.medium,
    }
  }

  async fetchUserAnimeList(userIdOrName?: number | string): Promise<RemoteMediaEntry[]> {
    const query = `
      query ($userId: Int, $userName: String) {
        MediaListCollection(userId: $userId, userName: $userName, type: ANIME) {
          lists {
            entries {
              id
              mediaId
              status
              progress
              score(format: POINT_10)
              updatedAt
              media {
                id
                idMal
                episodes
                title { romaji english native }
                coverImage { large }
              }
            }
          }
        }
      }
    `
    const variables: Record<string, unknown> =
      typeof userIdOrName === 'number'
        ? { userId: userIdOrName }
        : typeof userIdOrName === 'string'
          ? { userName: userIdOrName }
          : {}

    const data = await this.request<{ MediaListCollection: { lists: AnilistListEntry[] } | null }>(
      query,
      variables
    )
    const lists = data.MediaListCollection?.lists ?? []
    const entries: RemoteMediaEntry[] = []

    for (const list of lists) {
      for (const entry of list.entries ?? []) {
        if (!entry.media) continue
        if (entry.status === 'REPEATING') continue
        entries.push({
          mediaId: entry.mediaId,
          entryId: (entry as { id?: number }).id,
          idMal: entry.media.idMal ?? undefined,
          status: ANILIST_TO_DANGO_STATUS[entry.status as AniListMediaListStatus] ?? 'Planned',
          progress: entry.progress ?? 0,
          score: entry.score ?? undefined,
          updatedAt: entry.updatedAt ?? 0,
          title: entry.media.title ?? {},
          coverImage: entry.media.coverImage?.large,
          totalEpisodes: entry.media.episodes ?? undefined,
        })
      }
    }
    return entries
  }

  async updateMediaEntry(params: {
    mediaId: number
    status?: string
    progress?: number
    score?: number
  }) {
    const mutation = `
      mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) {
          id
          mediaId
          status
          progress
        }
      }
    `
    const variables: Record<string, unknown> = { mediaId: params.mediaId }
    const status = params.status ? DANGO_TO_ANILIST_STATUS[params.status] : undefined
    if (status) variables.status = status
    if (params.progress !== undefined) variables.progress = params.progress
    if (params.score !== undefined) variables.score = params.score

    return this.request(mutation, variables)
  }

  async batchUpdateMediaEntries(
    entries: { mediaId: number; status?: string; progress?: number; score?: number }[]
  ) {
    if (entries.length === 0) return {}
    if (entries.length === 1) {
      return this.updateMediaEntry(entries[0])
    }

    const BATCH_SIZE = 10
    const results: Record<string, unknown> = {}

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE)
      const aliases: string[] = []
      const variables: Record<string, unknown> = {}
      const varDecls: string[] = []

      batch.forEach((entry, idx) => {
        const prefix = `a${i + idx}`
        const args: string[] = [`mediaId: $${prefix}mediaId`]

        variables[`${prefix}mediaId`] = entry.mediaId
        varDecls.push(`$${prefix}mediaId: Int!`)

        if (entry.status) {
          const anilistStatus = DANGO_TO_ANILIST_STATUS[entry.status]
          if (anilistStatus) {
            args.push(`status: $${prefix}status`)
            variables[`${prefix}status`] = anilistStatus
            varDecls.push(`$${prefix}status: MediaListStatus`)
          }
        }

        if (entry.progress !== undefined) {
          args.push(`progress: $${prefix}progress`)
          variables[`${prefix}progress`] = entry.progress
          varDecls.push(`$${prefix}progress: Int`)
        }

        if (entry.score !== undefined) {
          args.push(`score: $${prefix}score`)
          variables[`${prefix}score`] = entry.score
          varDecls.push(`$${prefix}score: Float`)
        }

        aliases.push(
          `${prefix}: SaveMediaListEntry(${args.join(', ')}) { id mediaId status progress }`
        )
      })

      const mutation = `mutation (${varDecls.join(', ')}) { ${aliases.join('\n')} }`

      const data = await this.request<Record<string, unknown>>(mutation, variables)
      if (data) Object.assign(results, data)
    }

    return results
  }

  async deleteMediaEntry(entryId: number) {
    const mutation = `
      mutation ($id: Int) {
        DeleteMediaListEntry(id: $id) { deleted }
      }
    `
    return this.request(mutation, { id: entryId })
  }

  async batchDeleteMediaEntries(entryIds: number[]) {
    if (entryIds.length === 0) return {}
    if (entryIds.length === 1) {
      return this.deleteMediaEntry(entryIds[0])
    }

    const BATCH_SIZE = 10
    const results: Record<string, unknown> = {}

    for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
      const batch = entryIds.slice(i, i + BATCH_SIZE)
      const aliases: string[] = []
      const variables: Record<string, unknown> = {}

      batch.forEach((entryId, idx) => {
        const prefix = `d${i + idx}`
        aliases.push(`${prefix}: DeleteMediaListEntry(id: $${prefix}id) { deleted }`)
        variables[`${prefix}id`] = entryId
      })

      const varDecls = batch.map((_, idx) => `$d${i + idx}id: Int`).join(', ')

      const mutation = `mutation (${varDecls}) { ${aliases.join('\n')} }`

      const data = await this.request<Record<string, unknown>>(mutation, variables)
      if (data) Object.assign(results, data)
    }

    return results
  }
}

interface AnilistListEntry {
  entries?: {
    id?: number
    mediaId: number
    status?: string
    progress?: number
    score?: number
    updatedAt?: number
    media?: {
      id: number
      idMal?: number
      episodes?: number
      title?: { romaji?: string; english?: string; native?: string }
      coverImage?: { large?: string }
    }
  }[]
}
