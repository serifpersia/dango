import { defineSchema, optNum, optStr, readLimit, readPage, reqObj, reqStr } from '../validation.js'

export type DataScheduleInput = { date: string; format?: string }

export const dataScheduleInput = () =>
  defineSchema<DataScheduleInput, DataScheduleInput>((value) => {
    const obj = reqObj(value)
    const out: DataScheduleInput = { date: reqStr(obj, 'date') }
    const format = optStr(obj, 'format')
    if (format !== undefined) out.format = format
    return out
  })

export type DataLatestReleasesInput = { format?: string; page?: number; size?: number }

export const dataLatestReleasesInput = () =>
  defineSchema<DataLatestReleasesInput, DataLatestReleasesInput>((value) => {
    const obj = reqObj(value)
    const out: DataLatestReleasesInput = {}
    const format = optStr(obj, 'format')
    if (format !== undefined) out.format = format
    if (obj.page !== undefined) out.page = readPage(obj)
    if (obj.size !== undefined) out.size = readLimit(obj, 12, 50, 'size')
    return out
  })

export type DataSearchInput = {
  query?: string
  page?: number
  limit?: number
  sortBy?: string
  type?: string
  status?: string
  season?: string
  year?: string | number
  country?: string
  genres?: string
  excludeGenres?: string
  excludeTags?: string
  minScore?: string | number
  minEpisodes?: string | number
  adult?: string
}

type DataSearchParsed = {
  query?: string
  page?: number
  limit?: number
  sortBy?: string
  type?: string
  status?: string
  season?: string
  year?: number
  country?: string
  genres?: string
  excludeGenres?: string
  excludeTags?: string
  minScore?: number
  minEpisodes?: number
  adult?: string
}

export const dataSearchInput = () =>
  defineSchema<DataSearchInput, DataSearchParsed>((value) => {
    const obj = reqObj(value)
    const out: DataSearchParsed = {}
    const query = optStr(obj, 'query')
    if (query !== undefined) out.query = query
    if (obj.page !== undefined) out.page = readPage(obj)
    if (obj.limit !== undefined) out.limit = readLimit(obj, 14, 50)
    const sortBy = optStr(obj, 'sortBy')
    if (sortBy !== undefined) out.sortBy = sortBy
    const type = optStr(obj, 'type')
    if (type !== undefined) out.type = type
    const status = optStr(obj, 'status')
    if (status !== undefined) out.status = status
    const season = optStr(obj, 'season')
    if (season !== undefined) out.season = season
    const year = optNum(obj, 'year')
    if (year !== undefined) out.year = year
    const country = optStr(obj, 'country')
    if (country !== undefined) out.country = country
    const genres = optStr(obj, 'genres')
    if (genres !== undefined) out.genres = genres
    const excludeGenres = optStr(obj, 'excludeGenres')
    if (excludeGenres !== undefined) out.excludeGenres = excludeGenres
    const excludeTags = optStr(obj, 'excludeTags')
    if (excludeTags !== undefined) out.excludeTags = excludeTags
    const minScore = optNum(obj, 'minScore')
    if (minScore !== undefined) out.minScore = minScore
    const minEpisodes = optNum(obj, 'minEpisodes')
    if (minEpisodes !== undefined) out.minEpisodes = minEpisodes
    const adult = optStr(obj, 'adult')
    if (adult !== undefined) out.adult = adult
    return out
  })

export type DataMatureResolveInput = { title?: string }

export const dataMatureResolveInput = () =>
  defineSchema<DataMatureResolveInput, DataMatureResolveInput>((value) => {
    const obj = reqObj(value)
    const out: DataMatureResolveInput = {}
    const title = optStr(obj, 'title')
    if (title !== undefined) out.title = title
    return out
  })

export type DataSkipTimesInput = { showId?: string; episodeNumber?: string }

export const dataSkipTimesInput = () =>
  defineSchema<DataSkipTimesInput, DataSkipTimesInput>((value) => {
    const obj = reqObj(value)
    const out: DataSkipTimesInput = {}
    const showId = optStr(obj, 'showId')
    if (showId !== undefined) out.showId = showId
    const episodeNumber = optStr(obj, 'episodeNumber')
    if (episodeNumber !== undefined) out.episodeNumber = episodeNumber
    return out
  })

export type DataSeasonalInput = { page?: number; size?: number; format?: string }

export const dataSeasonalInput = () =>
  defineSchema<DataSeasonalInput, DataSeasonalInput>((value) => {
    const obj = reqObj(value)
    const out: DataSeasonalInput = {}
    if (obj.page !== undefined) out.page = readPage(obj)
    if (obj.size !== undefined) out.size = readLimit(obj, 14, 50, 'size')
    const format = optStr(obj, 'format')
    if (format !== undefined) out.format = format
    return out
  })

export type DataPopularListInput = { sort?: string; page?: number; size?: number }

export const dataPopularListInput = () =>
  defineSchema<DataPopularListInput, DataPopularListInput>((value) => {
    const obj = reqObj(value)
    const out: DataPopularListInput = {}
    const sort = optStr(obj, 'sort')
    if (sort !== undefined) out.sort = sort
    if (obj.page !== undefined) out.page = readPage(obj)
    if (obj.size !== undefined) out.size = readLimit(obj, 20, 50, 'size')
    return out
  })

export type DataEpisodesInput = { showId?: string; mode?: 'sub' | 'dub'; provider?: string }

export const dataEpisodesInput = () =>
  defineSchema<DataEpisodesInput, DataEpisodesInput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    const out: DataEpisodesInput = {}
    const showId = optStr(obj, 'showId')
    if (showId !== undefined) out.showId = showId
    const mode = optStr(obj, 'mode')
    if (mode === 'sub' || mode === 'dub') out.mode = mode
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    return out
  })

export type DataShowMetaInput = { id: string }

export const dataShowMetaInput = () =>
  defineSchema<DataShowMetaInput, DataShowMetaInput>((value) => ({
    id: reqStr(reqObj(value), 'id'),
  }))

export type DataVideoInput = {
  showId?: string
  episodeNumber?: string
  mode?: 'sub' | 'dub'
  provider?: string
}

export const dataVideoInput = () =>
  defineSchema<DataVideoInput, DataVideoInput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    const out: DataVideoInput = {}
    const showId = optStr(obj, 'showId')
    if (showId !== undefined) out.showId = showId
    const episodeNumber = optStr(obj, 'episodeNumber')
    if (episodeNumber !== undefined) out.episodeNumber = episodeNumber
    const mode = optStr(obj, 'mode')
    if (mode === 'sub' || mode === 'dub') out.mode = mode
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    return out
  })

export type DataMatureSearchInput = {
  provider?: string
  query?: string
  page?: number
  limit?: number
  type?: string
  status?: string
  season?: string
  year?: number
  country?: string
  genres?: string
  genre?: string
  excludeGenres?: string
  sortBy?: string
  order?: string
  studio?: string
  blacklist?: string
  minScore?: number
  minEpisodes?: number
}

export const dataMatureSearchInput = () =>
  defineSchema<DataMatureSearchInput, DataMatureSearchInput>((value) => {
    const obj = reqObj(value)
    const out: DataMatureSearchInput = {}
    for (const k of [
      'provider',
      'query',
      'type',
      'status',
      'season',
      'country',
      'genres',
      'genre',
      'excludeGenres',
      'sortBy',
      'order',
      'studio',
      'blacklist',
    ] as const) {
      const v = optStr(obj, k)
      if (v !== undefined) out[k] = v
    }
    if (obj.page !== undefined) out.page = readPage(obj)
    if (obj.limit !== undefined) out.limit = readLimit(obj, 14, 50)
    const year = optNum(obj, 'year')
    if (year !== undefined) out.year = year
    const minScore = optNum(obj, 'minScore')
    if (minScore !== undefined) out.minScore = minScore
    const minEpisodes = optNum(obj, 'minEpisodes')
    if (minEpisodes !== undefined) out.minEpisodes = minEpisodes
    return out
  })

export type DataMatureAllocateInput = {
  provider?: string
  nativeId?: string
  title?: string
  thumbnail?: string
}

export const dataMatureAllocateInput = () =>
  defineSchema<DataMatureAllocateInput, DataMatureAllocateInput>((value) => {
    const obj = reqObj(value)
    const out: DataMatureAllocateInput = {}
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    const nativeId = optStr(obj, 'nativeId')
    if (nativeId !== undefined) out.nativeId = nativeId
    const title = optStr(obj, 'title')
    if (title !== undefined) out.title = title
    const thumbnail = optStr(obj, 'thumbnail')
    if (thumbnail !== undefined) out.thumbnail = thumbnail
    return out
  })

export type DataMatureStreamInput = { provider?: string; nativeId?: string; episode?: string }

export const dataMatureStreamInput = () =>
  defineSchema<DataMatureStreamInput, DataMatureStreamInput>((value) => {
    const obj = reqObj(value)
    const out: DataMatureStreamInput = {}
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    const nativeId = optStr(obj, 'nativeId')
    if (nativeId !== undefined) out.nativeId = nativeId
    const episode = optStr(obj, 'episode')
    if (episode !== undefined) out.episode = episode
    return out
  })
