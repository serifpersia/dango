import { Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { DatabaseWrapper } from '../db'
import { SettingsRepository } from '../repositories/settings.repository'
import { LocalShowMappingRepository } from '../repositories/local-show-mapping.repository'
import { LocalEpisodesRepository } from '../repositories/local-episodes.repository'
import { LocalSubtitlesRepository, LocalSubtitle } from '../repositories/local-subtitles.repository'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository'
import {
  parseFilename,
  generateLocalId,
  isVideoFile,
  isSubtitleFile,
  detectSubtitleLanguage,
  detectSeasonFromDir,
  hasExplicitSeason,
  formatLocalEpisodeNumber,
  getSubtitleFormat,
} from '../lib/local-scan'
import { searchAnilistByTitle, getShowMetaById, searchAnilist } from '../lib/anilist'
import { malSearchTitle } from '../lib/mal'
import { malCacheStore } from '../repositories/mal-cache.repository'
import { pickBestMatch, buildQueryVariants } from '../providers/title-matching'
import logger from '../logger'

async function resolveLocalAnilistId(
  folderName: string,
  detectedTitle: string
): Promise<number | null> {
  const variants = [...new Set([folderName, detectedTitle].map((v) => v.trim()).filter(Boolean))]
  const queries = variants.slice(0, 2)
  const candidates: { id: number; title: string }[] = []
  const seen = new Set<number>()
  for (const q of [...queries, ...buildQueryVariants(detectedTitle).slice(0, 2)]) {
    if (!q) continue
    try {
      const results = await searchAnilist({ query: q, page: 1, perPage: 10 })
      for (const r of results) {
        const id = r.anilistId ?? Number((r as { id?: unknown }).id)
        if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue
        seen.add(id)
        const titles = [r.names?.romaji, r.names?.english, r.name].filter((t): t is string => !!t)
        for (const t of titles) candidates.push({ id, title: t })
      }
    } catch {
      // ignore
    }
    if (candidates.length >= 20) break
  }
  const best = pickBestMatch(candidates, variants, 0.7)
  if (best) return best.item.id
  try {
    const fallback = await searchAnilistByTitle(detectedTitle)
    return fallback?.id ?? null
  } catch {
    return null
  }
}

const log = logger.child({ module: 'LocalMedia' })

interface LocalShow {
  localId: string
  anilistId: number | null
  malId: number | null
  folderPath: string
  folderName: string
  detectedTitle: string
  detectedSeason: number
  name: string
  thumbnail: string | null
  episodeCount: number
  episodes: LocalEpisodeDetail[]
}

interface LocalEpisodeDetail {
  number: string
  title: string
  filePath: string
  fileName: string
  fileSize: number | null
  durationSeconds: number | null
  subtitles: LocalSubtitleDetail[]
  watched: boolean
  currentTime: number
  duration: number
}

interface LocalSubtitleDetail {
  language: string
  format: string
  filePath: string
}

function srtToVtt(body: string): string {
  const normalized = body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return /^\s*WEBVTT/i.test(converted) ? converted : `WEBVTT\n\n${converted}`
}

function assTimeToVtt(t: string): string | null {
  const m = t.trim().match(/^(?:(\d+):)?([0-5]?\d):([0-5]?\d)[.:](\d{1,3})$/)
  if (!m) return null
  const h = String(Number(m[1] ?? 0)).padStart(2, '0')
  const min = m[2].padStart(2, '0')
  const sec = m[3].padStart(2, '0')
  const ms = m[4].padEnd(3, '0').slice(0, 3)
  return `${h}:${min}:${sec}.${ms}`
}

function assToVtt(body: string): string {
  const cues: string[] = []
  for (const rawLine of body.replace(/^\uFEFF/, '').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.startsWith('Dialogue:')) continue
    const payload = line.slice('Dialogue:'.length)
    const parts: string[] = []
    let current = ''
    let commas = 0
    for (const ch of payload) {
      if (ch === ',' && commas < 8) {
        commas++
        parts.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    parts.push(current)
    if (parts.length < 10) continue
    const start = assTimeToVtt(parts[1])
    const end = assTimeToVtt(parts[2])
    if (!start || !end) continue
    const text = parts
      .slice(9)
      .join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .trim()
    if (!text) continue
    cues.push(`${start} --> ${end}\n${text}`)
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

const VTT_CONVERTIBLE = new Set(['.vtt', '.srt', '.ass', '.ssa'])

async function resolveLibraryPath(db: DatabaseWrapper): Promise<string | null> {
  const setting = await SettingsRepository.getByKey(db, 'localLibraryPath')
  if (!setting?.value) return null
  return setting.value
}

async function scanDirectory(dirPath: string): Promise<{ videos: string[]; subtitles: string[] }> {
  const videos: string[] = []
  const subtitles: string[] = []

  async function walk(currentDir: string) {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        if (isVideoFile(fullPath)) {
          videos.push(fullPath)
        } else if (isSubtitleFile(fullPath)) {
          subtitles.push(fullPath)
        }
      }
    }
  }

  await walk(dirPath)
  return { videos, subtitles }
}

interface ShowGroup {
  dir: string
  paths: string[]
}

function groupByShow(videos: string[]): Map<string, ShowGroup> {
  const shows = new Map<string, ShowGroup>()

  for (const videoPath of videos) {
    const dir = path.dirname(videoPath)

    if (!shows.has(dir)) {
      shows.set(dir, { dir, paths: [] })
    }
    shows.get(dir)!.paths.push(videoPath)
  }

  return shows
}

function matchSubtitlesToVideo(videoPath: string, allSubtitles: string[]): LocalSubtitle[] {
  const videoBase = path.basename(videoPath, path.extname(videoPath))
  const videoDir = path.dirname(videoPath)
  const matched: LocalSubtitle[] = []

  for (const subPath of allSubtitles) {
    const subDir = path.dirname(subPath)
    if (subDir !== videoDir) continue

    const subBase = path.basename(subPath, path.extname(subPath))

    const isExactMatch = subBase === videoBase
    const isLanguageTagged = subBase.startsWith(videoBase + '.')

    if (isExactMatch || isLanguageTagged) {
      matched.push({
        id: 0,
        episodeId: 0,
        filePath: subPath,
        language: detectSubtitleLanguage(subPath),
        format: getSubtitleFormat(subPath),
      })
    }
  }

  return matched
}

function generatePlaceholderThumbnail(title: string): string {
  const firstChar = (title || '?')[0].toUpperCase()
  const hue = Array.from(title).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="225" height="318" viewBox="0 0 225 318">
    <rect width="225" height="318" fill="hsl(${hue}, 45%, 25%)" rx="8"/>
    <text x="112" y="175" text-anchor="middle" dominant-baseline="central"
          font-family="Arial, sans-serif" font-size="96" font-weight="bold"
          fill="hsl(${hue}, 30%, 85%)">${firstChar}</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

export class LocalMediaController {
  constructor(private db: DatabaseWrapper) {}

  getLibraryPath = async (_req: Request, res: Response) => {
    const setting = await SettingsRepository.getByKey(this.db, 'localLibraryPath')
    res.json({ path: setting?.value || null })
  }

  setLibraryPath = async (req: Request, res: Response) => {
    const { path: libPath } = req.body
    if (!libPath || typeof libPath !== 'string') {
      res.status(400).json({ error: 'Path is required' })
      return
    }

    if (!fs.existsSync(libPath)) {
      res.status(400).json({ error: 'Directory does not exist' })
      return
    }

    const stat = await fs.promises.stat(libPath)
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' })
      return
    }

    await SettingsRepository.upsert(this.db, 'localLibraryPath', libPath)
    res.json({ path: libPath })
  }

  scan = async (_req: Request, res: Response) => {
    const libraryPath = await resolveLibraryPath(this.db)
    if (!libraryPath) {
      res.status(400).json({ error: 'Library path not configured' })
      return
    }

    if (!fs.existsSync(libraryPath)) {
      res.status(400).json({ error: 'Library directory not found' })
      return
    }

    try {
      const { videos, subtitles } = await scanDirectory(libraryPath)
      const shows = groupByShow(videos)

      const results: LocalShow[] = []

      for (const [showPath, group] of shows) {
        const videoPaths = group.paths
        const folderName = path.basename(showPath)
        const localId = generateLocalId(showPath)

        const parsedVideos = videoPaths.map((vp) => {
          const base = path.basename(vp, path.extname(vp))
          return { path: vp, base, parsed: parseFilename(path.basename(vp)) }
        })

        const primaryParsed = parsedVideos[0]?.parsed
        const detectedTitle = primaryParsed?.title || folderName
        const explicitSeasons = parsedVideos
          .filter((v) => hasExplicitSeason(v.base))
          .map((v) => v.parsed.season)
        const dirSeason = showPath === libraryPath ? null : detectSeasonFromDir(folderName)
        const detectedSeason =
          explicitSeasons.length > 0
            ? Math.max(...explicitSeasons)
            : (dirSeason ?? primaryParsed?.season ?? 1)

        LocalShowMappingRepository.upsert(this.db, {
          localId,
          folderPath: showPath,
          folderName,
          detectedTitle,
          detectedSeason,
        })

        const existingEpisodes = LocalEpisodesRepository.getByLocalId(this.db, localId)
        const existingPaths = new Set(existingEpisodes.map((e) => e.filePath))

        for (const { path: vp, base, parsed } of parsedVideos) {
          const season = hasExplicitSeason(base) ? parsed.season : (dirSeason ?? parsed.season)
          if (existingPaths.has(vp)) {
            const stat = await fs.promises.stat(vp).catch(() => null)
            LocalEpisodesRepository.upsert(this.db, {
              localId,
              episodeNumber: parsed.episodeNumber,
              season,
              filePath: vp,
              fileName: path.basename(vp),
              fileSize: stat?.size ?? null,
            })
          } else {
            const stat = await fs.promises.stat(vp).catch(() => null)
            LocalEpisodesRepository.upsert(this.db, {
              localId,
              episodeNumber: parsed.episodeNumber,
              season,
              filePath: vp,
              fileName: path.basename(vp),
              fileSize: stat?.size ?? null,
            })
          }
        }

        const episodeList = LocalEpisodesRepository.getByLocalId(this.db, localId)
        const missingEpisodes = episodeList.filter((e) => !fs.existsSync(e.filePath))
        if (missingEpisodes.length > 0) {
          const missingIds = missingEpisodes.map((e) => e.id)
          LocalSubtitlesRepository.deleteByEpisodeIds(this.db, missingIds)
          LocalEpisodesRepository.deleteByIds(this.db, missingIds)
        }
        const currentEpisodes = episodeList.filter((e) => fs.existsSync(e.filePath))
        const episodeIds = currentEpisodes.map((e) => e.id)
        const allSubs = LocalSubtitlesRepository.getByEpisodeIds(this.db, episodeIds)
        const missingSubs = allSubs.filter((s) => !fs.existsSync(s.filePath))
        if (missingSubs.length > 0) {
          LocalSubtitlesRepository.deleteByFilePaths(
            this.db,
            missingSubs.map((s) => s.filePath)
          )
        }
        const liveSubs = allSubs.filter((s) => fs.existsSync(s.filePath))

        for (const ep of currentEpisodes) {
          const existingSubs = liveSubs.filter((s) => s.episodeId === ep.id)
          if (existingSubs.length === 0) {
            const matchedSubs = matchSubtitlesToVideo(ep.filePath, subtitles)
            for (const sub of matchedSubs) {
              LocalSubtitlesRepository.upsert(this.db, {
                episodeId: ep.id,
                filePath: sub.filePath,
                language: sub.language,
                format: sub.format,
              })
            }
          }
        }

        const existingMapping = LocalShowMappingRepository.getById(this.db, localId)
        if (!existingMapping?.anilistId && !existingMapping?.malId) {
          try {
            const anilistId = await resolveLocalAnilistId(folderName, detectedTitle)
            if (anilistId) {
              LocalShowMappingRepository.updateAnilistId(this.db, localId, anilistId)
              const meta = await getShowMetaById(String(anilistId))
              const epCount = meta?.episodeCount != null ? Number(meta.episodeCount) : undefined
              ShowsMetaRepository.upsert(this.db, {
                id: localId,
                name: meta?.name || meta?.englishName || detectedTitle,
                anilistId,
                thumbnail: meta?.thumbnail || undefined,
                episodeCount: epCount,
              })
              log.info(
                { localId, title: detectedTitle, anilistId },
                'Auto-resolved AniList metadata'
              )
            } else {
              const malResult = await malSearchTitle(malCacheStore(), detectedTitle)
              if (malResult) {
                const malId = parseInt(malResult.replace('mal-', ''), 10)
                LocalShowMappingRepository.updateMalId(this.db, localId, malId)
                log.info({ localId, title: detectedTitle, malId }, 'Auto-resolved MAL metadata')
              }
            }
          } catch (err) {
            log.warn({ err, title: detectedTitle }, 'Auto-resolve failed')
          }
        }

        const resolvedMapping = LocalShowMappingRepository.getById(this.db, localId)
        const thumbnail = ShowsMetaRepository.getById(this.db, localId)
          ? (ShowsMetaRepository.getById(this.db, localId) as { thumbnail?: string })?.thumbnail ||
            null
          : null

        const multiSeason = new Set(currentEpisodes.map((e) => e.season ?? 1)).size > 1

        const episodes: LocalEpisodeDetail[] = currentEpisodes.map((ep) => {
          const key = formatLocalEpisodeNumber(ep.season ?? 1, ep.episodeNumber, multiSeason)
          const watchedEp = this.db.get<{ currentTime: number; duration: number }>(
            'SELECT currentTime, duration FROM watched_episodes WHERE showId = ? AND episodeNumber = ?',
            [localId, key]
          )
          const subs = liveSubs.filter((s) => s.episodeId === ep.id)
          return {
            number: key,
            title: `Episode ${key}`,
            filePath: ep.filePath,
            fileName: ep.fileName,
            fileSize: ep.fileSize,
            durationSeconds: ep.durationSeconds,
            subtitles: subs.map((s) => ({
              language: s.language,
              format: s.format,
              filePath: s.filePath,
            })),
            watched: !!watchedEp && watchedEp.currentTime > 0,
            currentTime: watchedEp?.currentTime || 0,
            duration: watchedEp?.duration || 0,
          }
        })

        const resolvedMeta = ShowsMetaRepository.getById(this.db, localId) as
          | {
              name?: string
              thumbnail?: string
            }
          | undefined

        results.push({
          localId,
          anilistId: resolvedMapping?.anilistId || null,
          malId: resolvedMapping?.malId || null,
          folderPath: showPath,
          folderName,
          detectedTitle,
          detectedSeason,
          name: resolvedMeta?.name || detectedTitle,
          thumbnail,
          episodeCount: episodes.length,
          episodes,
        })
      }

      const seenIds = new Set(results.map((r) => r.localId))
      const stale = LocalShowMappingRepository.getAll(this.db).filter(
        (m) =>
          (m.folderPath === libraryPath || m.folderPath.startsWith(libraryPath + path.sep)) &&
          !seenIds.has(m.localId)
      )
      for (const m of stale) {
        LocalShowMappingRepository.delete(this.db, m.localId)
      }

      res.json({
        libraryPath,
        showCount: results.length,
        shows: results,
      })
    } catch (err) {
      log.error({ err }, 'Library scan failed')
      res.status(500).json({ error: 'Scan failed' })
    }
  }

  getShows = async (_req: Request, res: Response) => {
    const shows = LocalShowMappingRepository.getAll(this.db)
    const results = shows.map((show) => {
      const episodes = LocalEpisodesRepository.getByLocalId(this.db, show.localId)
      const meta = ShowsMetaRepository.getById(this.db, show.localId) as
        | {
            thumbnail?: string
            name?: string
            episodeCount?: number
          }
        | undefined

      return {
        localId: show.localId,
        anilistId: show.anilistId,
        malId: show.malId,
        name: meta?.name || show.detectedTitle,
        thumbnail: meta?.thumbnail || generatePlaceholderThumbnail(show.detectedTitle),
        episodeCount: episodes.length,
        folderName: show.folderName,
        detectedSeason: show.detectedSeason,
      }
    })
    res.json(results)
  }

  getShow = async (req: Request, res: Response) => {
    const id = req.params.id as string
    const mapping = LocalShowMappingRepository.getById(this.db, id)
    if (!mapping) {
      res.status(404).json({ error: 'Show not found' })
      return
    }

    const episodes = LocalEpisodesRepository.getByLocalId(this.db, id)
    const episodeIds = episodes.map((e) => e.id)
    const allSubs = LocalSubtitlesRepository.getByEpisodeIds(this.db, episodeIds)

    const multiSeasonDetail = new Set(episodes.map((e) => e.season ?? 1)).size > 1

    const episodeDetails: LocalEpisodeDetail[] = episodes.map((ep) => {
      const key = formatLocalEpisodeNumber(ep.season ?? 1, ep.episodeNumber, multiSeasonDetail)
      const watchedEp = this.db.get<{ currentTime: number; duration: number }>(
        'SELECT currentTime, duration FROM watched_episodes WHERE showId = ? AND episodeNumber = ?',
        [id, key]
      )
      const subs = allSubs.filter((s) => s.episodeId === ep.id)
      return {
        number: key,
        title: `Episode ${key}`,
        filePath: ep.filePath,
        fileName: ep.fileName,
        fileSize: ep.fileSize,
        durationSeconds: ep.durationSeconds,
        subtitles: subs.map((s) => ({
          language: s.language,
          format: s.format,
          filePath: s.filePath,
        })),
        watched: !!watchedEp && watchedEp.currentTime > 0,
        currentTime: watchedEp?.currentTime || 0,
        duration: watchedEp?.duration || 0,
      }
    })

    const meta = ShowsMetaRepository.getById(this.db, id) as
      | {
          thumbnail?: string
          name?: string
        }
      | undefined

    res.json({
      localId: mapping.localId,
      anilistId: mapping.anilistId,
      malId: mapping.malId,
      name: meta?.name || mapping.detectedTitle,
      thumbnail: meta?.thumbnail || generatePlaceholderThumbnail(mapping.detectedTitle),
      folderPath: mapping.folderPath,
      folderName: mapping.folderName,
      detectedSeason: mapping.detectedSeason,
      episodes: episodeDetails,
    })
  }

  stream = async (req: Request, res: Response) => {
    const filePath = req.query.path as string
    if (!filePath) {
      res.status(400).json({ error: 'Path parameter required' })
      return
    }

    const libraryPath = await resolveLibraryPath(this.db)
    if (!libraryPath) {
      res.status(400).json({ error: 'Library path not configured' })
      return
    }

    const resolvedPath = path.resolve(filePath)
    if (!resolvedPath.startsWith(path.resolve(libraryPath))) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({ error: 'File not found' })
      return
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    const contentTypeMap: Record<string, string> = {
      '.mkv': 'video/x-matroska',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
    }
    const contentType = contentTypeMap[ext] || 'video/mp4'

    const stat = await fs.promises.stat(resolvedPath)
    const fileSize = stat.size
    log.debug({ resolvedPath, fileSize, range: req.headers.range }, 'Stream request')

    if (fileSize <= 0) {
      res.writeHead(200, {
        'Content-Length': 0,
        'Content-Type': contentType,
      })
      res.end()
      return
    }

    const range = req.headers.range

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunkSize = end - start + 1

      if (start >= fileSize || end >= fileSize || start > end || chunkSize <= 0) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
        })
        res.end()
        return
      }

      const stream = fs.createReadStream(resolvedPath, { start, end })
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      })
      stream.pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      })
      fs.createReadStream(resolvedPath).pipe(res)
    }
  }

  streamSubtitle = async (req: Request, res: Response) => {
    const filePath = req.query.path as string
    if (!filePath) {
      res.status(400).json({ error: 'Path parameter required' })
      return
    }

    const libraryPath = await resolveLibraryPath(this.db)
    if (!libraryPath) {
      res.status(400).json({ error: 'Library path not configured' })
      return
    }

    const resolvedPath = path.resolve(filePath)
    if (!resolvedPath.startsWith(path.resolve(libraryPath))) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({ error: 'File not found' })
      return
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    if (!VTT_CONVERTIBLE.has(ext)) {
      res.status(400).json({ error: 'Subtitle format not supported' })
      return
    }

    let body: string
    try {
      body = await fs.promises.readFile(resolvedPath, 'utf-8')
    } catch {
      res.status(404).json({ error: 'File not found' })
      return
    }

    res.set('Content-Type', 'text/vtt; charset=utf-8')
    if (ext === '.vtt') {
      const normalized = body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
      res.send(/^\s*WEBVTT/i.test(normalized) ? normalized : `WEBVTT\n\n${normalized}`)
    } else if (ext === '.srt') {
      res.send(srtToVtt(body))
    } else {
      res.send(assToVtt(body))
    }
  }

  resolveMetadata = async (req: Request, res: Response) => {
    const id = req.params.id as string
    const mapping = LocalShowMappingRepository.getById(this.db, id)
    if (!mapping) {
      res.status(404).json({ error: 'Show not found' })
      return
    }

    if (mapping.anilistId) {
      const meta = await getShowMetaById(String(mapping.anilistId))
      if (meta) {
        res.json({
          source: 'anilist',
          anilistId: meta.anilistId,
          name: meta.name,
          thumbnail: meta.thumbnail,
          episodeCount: meta.episodeCount,
        })
        return
      }
    }

    if (mapping.malId) {
      const meta = await getShowMetaById(`-${mapping.malId}`)
      if (meta) {
        res.json({
          source: 'mal',
          malId: mapping.malId,
          anilistId: meta.anilistId,
          name: meta.name,
          thumbnail: meta.thumbnail,
          episodeCount: meta.episodeCount,
        })
        return
      }
    }

    const title = mapping.detectedTitle

    try {
      const anilistId = await resolveLocalAnilistId(mapping.folderName, title)
      if (anilistId) {
        LocalShowMappingRepository.updateAnilistId(this.db, id, anilistId)
        const meta = await getShowMetaById(String(anilistId))
        const epCount = meta?.episodeCount != null ? Number(meta.episodeCount) : undefined
        const resolvedName = meta?.englishName || meta?.name || title
        ShowsMetaRepository.upsert(this.db, {
          id: id,
          name: resolvedName,
          anilistId,
          thumbnail: meta?.thumbnail || undefined,
          episodeCount: epCount,
        })
        res.json({
          source: 'anilist',
          anilistId,
          name: resolvedName,
          thumbnail: meta?.thumbnail || null,
          episodeCount: meta?.episodeCount || null,
        })
        return
      }
    } catch (err) {
      log.warn({ err }, 'AniList search failed, trying MAL')
    }

    try {
      const malResult = await malSearchTitle(malCacheStore(), title)
      if (malResult) {
        const malId = parseInt(malResult.replace('mal-', ''), 10)
        LocalShowMappingRepository.updateMalId(this.db, id, malId)
        res.json({
          source: 'mal',
          malId,
          name: title,
          thumbnail: null,
          episodeCount: null,
        })
        return
      }
    } catch (err) {
      log.warn({ err }, 'MAL search failed')
    }

    res.json({
      source: 'local',
      name: title,
      thumbnail: generatePlaceholderThumbnail(title),
      episodeCount: null,
    })
  }

  linkToAnilist = async (req: Request, res: Response) => {
    const id = req.params.id as string
    const { anilistId } = req.body

    if (!anilistId || typeof anilistId !== 'number') {
      res.status(400).json({ error: 'anilistId (number) required' })
      return
    }

    const mapping = LocalShowMappingRepository.getById(this.db, id)
    if (!mapping) {
      res.status(404).json({ error: 'Show not found' })
      return
    }

    LocalShowMappingRepository.updateAnilistId(this.db, id, anilistId)

    const meta = await getShowMetaById(String(anilistId))
    if (meta) {
      const epCount = meta.episodeCount != null ? Number(meta.episodeCount) : undefined
      ShowsMetaRepository.upsert(this.db, {
        id,
        name: meta.name,
        anilistId: meta.anilistId || anilistId,
        thumbnail: meta.thumbnail || undefined,
        episodeCount: epCount,
      })
    }

    res.json({ success: true, anilistId })
  }

  unlinkMetadata = async (req: Request, res: Response) => {
    const id = req.params.id as string
    const mapping = LocalShowMappingRepository.getById(this.db, id)
    if (!mapping) {
      res.status(404).json({ error: 'Show not found' })
      return
    }
    LocalShowMappingRepository.clearLinks(this.db, id)
    this.db.run('DELETE FROM shows_meta WHERE id = ?', [id])
    res.json({ success: true })
  }

  getUnmatched = async (_req: Request, res: Response) => {
    const unmatched = LocalShowMappingRepository.getUnmatched(this.db)
    res.json(
      unmatched.map((m) => ({
        localId: m.localId,
        detectedTitle: m.detectedTitle,
        folderName: m.folderName,
        folderPath: m.folderPath,
      }))
    )
  }

  browseDirectory = async (req: Request, res: Response) => {
    const dirPath = (req.query.path as string) || ''

    if (!dirPath) {
      const homeDir = process.env.USERPROFILE || process.env.HOME || ''
      try {
        const entries = await fs.promises.readdir(homeDir, { withFileTypes: true })
        const dirs = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => ({ name: e.name, path: path.join(homeDir, e.name) }))
          .sort((a, b) => a.name.localeCompare(b.name))
        const parent = path.dirname(homeDir)
        res.json({ path: homeDir, parent: parent !== homeDir ? parent : null, directories: dirs })
      } catch {
        res.json({ path: homeDir, parent: null, directories: [] })
      }
      return
    }

    const resolved = path.resolve(dirPath)
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Directory not found' })
      return
    }

    const stat = await fs.promises.stat(resolved)
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'Not a directory' })
      return
    }

    try {
      const entries = await fs.promises.readdir(resolved, { withFileTypes: true })
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name))

      const parent = path.dirname(resolved)
      const canGoUp = parent !== resolved

      res.json({
        path: resolved,
        parent: canGoUp ? parent : null,
        directories: dirs,
      })
    } catch (err) {
      log.error({ err }, 'Failed to read directory')
      res.status(500).json({ error: 'Cannot read directory' })
    }
  }
}
