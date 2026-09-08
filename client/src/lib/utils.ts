const thumbnailCache = new Map<string, string>()
const MAX_CACHE_SIZE = 500

export const fixThumbnailUrl = (
  url: string | undefined,
  width?: number,
  height?: number
): string => {
  if (!url || url.trim() === '') return '/placeholder.svg'

  // If it's already a full proxy URL, just handle dimensions
  if (url.includes('/api/image-proxy')) {
    let finalUrl = url
    if (width && !finalUrl.includes('w=')) {
      const separator = finalUrl.includes('?') ? '&' : '?'
      finalUrl += `${separator}w=${width}`
    }
    if (height && !finalUrl.includes('h=')) {
      const separator = finalUrl.includes('?') ? '&' : '?'
      finalUrl += `${separator}h=${height}`
    }
    return finalUrl
  }

  let finalUrl = url

  if (finalUrl.includes('aln.youtube-anime.com')) {
    finalUrl = finalUrl.replace(
      /https?:\/\/allanime\.day\/aln\.youtube-anime\.com/,
      'https://aln.youtube-anime.com'
    )

    if (finalUrl.includes('/images/mcovers')) {
      finalUrl = finalUrl.replace('/images/mcovers', '/mcovers')
    }
    if (finalUrl.includes('/images/images2')) {
      finalUrl = finalUrl.replace('/images/images2', '/images2')
    }
  }

  if (finalUrl.includes('allanime.day/s4.anilist.co')) {
    finalUrl = finalUrl.replace(
      /https?:\/\/allanime\.day\/s4\.anilist\.co/,
      'https://s4.anilist.co'
    )
  }

  if (finalUrl.includes('wp.youtube-anime.com/s4.anilist.co')) {
    finalUrl = finalUrl.replace(
      /https?:\/\/wp\.youtube-anime\.com\/s4\.anilist\.co/,
      'https://s4.anilist.co'
    )
  }

  const cacheKey = `${finalUrl}-${width}-${height}`
  if (thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey)!
  }

  let proxiedUrl: string
  if (finalUrl.startsWith('https://s4.anilist.co')) {
    proxiedUrl = finalUrl
    if (width) {
      proxiedUrl += `${proxiedUrl.includes('?') ? '&' : '?'}w=${width}`
    }
    if (height) {
      proxiedUrl += `${proxiedUrl.includes('?') ? '&' : '?'}h=${height}`
    }
  } else if (finalUrl.includes('animepahe')) {
    proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(finalUrl)}`
    const cookie = localStorage.getItem('animepahe_cookie')
    const ua = localStorage.getItem('animepahe_ua')
    if (cookie) proxiedUrl += `&cookie=${encodeURIComponent(cookie)}`
    if (ua) proxiedUrl += `&ua=${encodeURIComponent(ua)}`
  } else if (finalUrl.startsWith('http')) {
    proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(finalUrl)}`

    if (width) proxiedUrl += `&w=${width}`
    if (height) proxiedUrl += `&h=${height}`
    else if (!width) proxiedUrl += '&w=300'
  } else {
    const host =
      finalUrl.startsWith('mcovers') || finalUrl.startsWith('images2')
        ? 'https://aln.youtube-anime.com'
        : 'https://aln.youtube-anime.com/images'
    const fullUrl = `${host}/${finalUrl}`
    proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(fullUrl)}`

    if (width) proxiedUrl += `&w=${width}`
    if (height) proxiedUrl += `&h=${height}`
    else if (!width) proxiedUrl += '&w=300'
  }

  if (thumbnailCache.size > MAX_CACHE_SIZE) {
    thumbnailCache.clear()
  }
  thumbnailCache.set(cacheKey, proxiedUrl)
  return proxiedUrl
}

export const formatTime = (timeInSeconds: number): string => {
  if (isNaN(timeInSeconds) || timeInSeconds <= 0) return '00:00'
  const result = new Date(timeInSeconds * 1000).toISOString().slice(11, 19)
  const hours = parseInt(result.slice(0, 2), 10)
  return hours > 0 ? result : result.slice(3)
}

export function sanitizeText(html: string | undefined | null): string {
  if (!html) return ''
  return html
    .replace(/<[^>]*>?/gm, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}
