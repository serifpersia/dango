import crypto from 'crypto'
import path from 'path'

export const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.webm', '.avi', '.mov'])

export const SUPPORTED_SUBTITLE_EXTENSIONS = new Set([
  '.ass',
  '.ssa',
  '.srt',
  '.vtt',
  '.sub',
  '.idx',
])

const SUBTITLE_FORMAT_MAP: Record<string, string> = {
  '.ass': 'ass',
  '.ssa': 'ass',
  '.srt': 'srt',
  '.vtt': 'vtt',
  '.sub': 'sub',
  '.idx': 'idx',
}

const QUALITY_TAGS =
  /\b(1080p|720p|480p|4k|2160p|bdrip|bluray|bdremux|dvdrip|hdtv|hdrip|webrip|webdl|web)\b/gi
const SOURCE_TAGS =
  /\b(hdrip|bluray|blu-ray|dvdrip|webrip|web-dl|webdl|hdtv|cam|ts|tc|hdcam|hddvd)\b/gi
const RELEASE_TAGS = /\b(repack|proper|internal|v2|v3|uncensored|censored|complete|batch)\b/gi

interface ParsedFilename {
  title: string
  episodeNumber: number
  season: number
  group: string
  rawTitle: string
}

function stripGroupTag(name: string): { cleanName: string; group: string } {
  const groupMatch = name.match(/^\[([^\]]+)\]\s*/)
  if (groupMatch) {
    return {
      cleanName: name.slice(groupMatch[0].length),
      group: groupMatch[1],
    }
  }
  const parenGroupMatch = name.match(/^\(([^)]+)\)\s*/)
  if (parenGroupMatch) {
    return {
      cleanName: name.slice(parenGroupMatch[0].length),
      group: parenGroupMatch[1],
    }
  }
  return { cleanName: name, group: '' }
}

function extractSeasonEpisode(text: string): { season: number; episode: number; matchEnd: number } {
  const sxxexx = text.match(/S(\d{1,2})E(\d{1,3})/i)
  if (sxxexx) {
    return {
      season: parseInt(sxxexx[1], 10),
      episode: parseInt(sxxexx[2], 10),
      matchEnd: sxxexx.index! + sxxexx[0].length,
    }
  }

  const sxxe = text.match(/S(\d{1,2})\s*E(\d{1,3})/i)
  if (sxxe) {
    return {
      season: parseInt(sxxe[1], 10),
      episode: parseInt(sxxe[2], 10),
      matchEnd: sxxe.index! + sxxe[0].length,
    }
  }

  const epOnly = text.match(/(?:(?:EP|Eps?|Episode|#)\s*(\d{1,4})|(?<![A-Za-z])E\s*(\d{1,4}))/i)
  if (epOnly) {
    return {
      season: 1,
      episode: parseInt(epOnly[1] ?? epOnly[2], 10),
      matchEnd: epOnly.index! + epOnly[0].length,
    }
  }

  const dashEp = text.match(/-\s*(?:E\s*)?(\d{1,4})(?:\s|$)/i)
  if (dashEp) {
    return {
      season: 1,
      episode: parseInt(dashEp[1], 10),
      matchEnd: dashEp.index! + dashEp[0].length,
    }
  }

  const trailingNum = text.match(/\b(\d{1,4})\s*$/)
  if (trailingNum) {
    return {
      season: 1,
      episode: parseInt(trailingNum[1], 10),
      matchEnd: trailingNum.index! + trailingNum[0].length,
    }
  }

  const anyNum = text.match(/\b(\d{1,4})\b/)
  if (anyNum) {
    return {
      season: 1,
      episode: parseInt(anyNum[1], 10),
      matchEnd: anyNum.index! + anyNum[0].length,
    }
  }

  return { season: 1, episode: 0, matchEnd: 0 }
}

function extractSeasonFromTitle(title: string): { title: string; season: number } {
  const seasonPatterns = [
    { regex: /\bSeason\s*(\d{1,2})\b/i, group: 1 },
    { regex: /\b(\d{1,2})(?:st|nd|rd|th)\s*Season\b/i, group: 1 },
    { regex: /\b(?:Season)\s*(II|III|IV|V|VI|VII|VIII|IX|X)\b/i, group: 1 },
  ]

  const romanMap: Record<string, number> = {
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
  }

  let season = 1
  let working = title

  for (const { regex, group } of seasonPatterns) {
    const match = working.match(regex)
    if (match) {
      const val = match[group]
      season = romanMap[val.toUpperCase()] || parseInt(val, 10)
      working = working.replace(match[0], '').trim()
      break
    }
  }

  const courPart = working.match(/\b(?:cour|part)\s*(\d{1,2})\b/i)
  if (courPart) {
    working = working.replace(courPart[0], '').trim()
    if (season === 1) season = parseInt(courPart[1], 10)
  }

  return { title: working, season }
}

function cleanTitle(title: string): string {
  let cleaned = title
  cleaned = cleaned.replace(QUALITY_TAGS, '')
  cleaned = cleaned.replace(SOURCE_TAGS, '')
  cleaned = cleaned.replace(RELEASE_TAGS, '')
  cleaned = cleaned.replace(/\s*-\s*$/, '')
  cleaned = cleaned.replace(/^\s*-\s*/, '')
  cleaned = cleaned.replace(/\s{2,}/g, ' ')
  return cleaned.trim()
}

export function parseFilename(fileName: string): ParsedFilename {
  const ext = path.extname(fileName)
  const baseName = path.basename(fileName, ext)

  const { cleanName, group } = stripGroupTag(baseName)

  const { title: titleWithSeason, season } = extractSeasonFromTitle(cleanName)

  const { season: epSeason, episode } = extractSeasonEpisode(titleWithSeason)

  const titlePart = titleWithSeason.slice(
    0,
    titleWithSeason.search(/\s*-\s*\d|\s+(?:EP|Eps?|#|E)\s*\d|\s+S\d{1,2}E\d|\s+\d{1,4}\s*$/i) ||
      titleWithSeason.length
  )

  const finalSeason = season !== 1 ? season : epSeason

  return {
    title: cleanTitle(titlePart || titleWithSeason),
    episodeNumber: episode,
    season: finalSeason,
    group,
    rawTitle: baseName,
  }
}

export function generateLocalId(folderPath: string): string {
  const hash = crypto.createHash('md5').update(folderPath).digest('hex')
  return `local_${hash.slice(0, 12)}`
}

export function detectSeasonFromDir(dirName: string): number | null {
  const t = dirName.toLowerCase()
  const patterns = [
    /\bseason\s*(\d{1,2})\b/,
    /^s(\d{1,2})$/,
    /\bpart\s*(\d{1,2})\b/,
    /\bcour\s*(\d{1,2})\b/,
    /\bs(\d{1,2})\b/,
  ]
  for (const p of patterns) {
    const m = t.match(p)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

export function hasExplicitSeason(text: string): boolean {
  return /S\d{1,2}\s*E\d{1,3}/i.test(text)
}

export function formatLocalEpisodeNumber(
  season: number,
  episode: number,
  multiSeason: boolean
): string {
  if (!multiSeason) return String(episode)
  return `S${season}E${String(episode).padStart(2, '0')}`
}

export function parseLocalEpisodeKey(key: string): { season: number; episode: number } | null {
  const m = key.match(/^S(\d+)E(\d+)$/i)
  if (!m) return null
  return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) }
}

export function detectSubtitleLanguage(filePath: string): string {
  const codes: Record<string, string> = {
    eng: 'en',
    en: 'en',
    english: 'en',
    jpn: 'ja',
    ja: 'ja',
    jp: 'ja',
    japanese: 'ja',
    spa: 'es',
    es: 'es',
    spanish: 'es',
    fre: 'fr',
    fra: 'fr',
    fr: 'fr',
    french: 'fr',
    ger: 'de',
    deu: 'de',
    de: 'de',
    german: 'de',
    ita: 'it',
    it: 'it',
    italian: 'it',
    por: 'pt',
    pt: 'pt',
    portuguese: 'pt',
    bra: 'pt',
    rus: 'ru',
    ru: 'ru',
    russian: 'ru',
    chi: 'zh',
    zho: 'zh',
    zh: 'zh',
    chinese: 'zh',
    kor: 'ko',
    ko: 'ko',
    korean: 'ko',
    ara: 'ar',
    ar: 'ar',
    arabic: 'ar',
    ind: 'id',
    id: 'id',
    indonesian: 'id',
    tha: 'th',
    th: 'th',
    thai: 'th',
    dut: 'nl',
    nld: 'nl',
    nl: 'nl',
    dutch: 'nl',
    pol: 'pl',
    pl: 'pl',
    polish: 'pl',
    tur: 'tr',
    tr: 'tr',
    turkish: 'tr',
    swe: 'sv',
    sv: 'sv',
    swedish: 'sv',
    nor: 'no',
    no: 'no',
    norwegian: 'no',
    dan: 'da',
    da: 'da',
    danish: 'da',
    fin: 'fi',
    fi: 'fi',
    finnish: 'fi',
    vie: 'vi',
    vi: 'vi',
    vietnamese: 'vi',
    msa: 'ms',
    ms: 'ms',
    malay: 'ms',
    hin: 'hi',
    hi: 'hi',
    hindi: 'hi',
  }
  const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase()
  const tokens = baseName.split(/[^a-z]+/).filter(Boolean)
  for (const t of tokens) {
    const code = codes[t]
    if (code) return code
  }
  return 'und'
}

export function subtitleDisplayName(videoFilePath: string, subFilePath: string): string {
  const videoBase = path.basename(videoFilePath, path.extname(videoFilePath)).toLowerCase()
  const subBase = path.basename(subFilePath, path.extname(subFilePath))
  let rest = subBase
  if (subBase.toLowerCase().startsWith(videoBase)) {
    rest = subBase.slice(videoBase.length)
  }
  rest = rest
    .replace(/^[.\-_ \[\]()]+/, '')
    .replace(/[.\-_ \[\]()]+$/, '')
    .trim()
  if (!rest) return 'Default'
  rest = rest.replace(/[.\-_]+/g, ' ')
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

export function getSubtitleFormat(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return SUBTITLE_FORMAT_MAP[ext] || ext.slice(1)
}

export function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return SUPPORTED_VIDEO_EXTENSIONS.has(ext)
}

export function isSubtitleFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return SUPPORTED_SUBTITLE_EXTENSIONS.has(ext)
}
