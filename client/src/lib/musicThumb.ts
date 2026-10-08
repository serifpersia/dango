const DEAD = new Set<string>()
const WINNER = new Map<string, string>()

// strict=1 so a dead upstream 404s instead of returning the placeholder SVG,
// which the browser would treat as a successful load and cache.
const proxy = (url: string) => `/api/image-proxy?url=${encodeURIComponent(url)}&strict=1`

// yt3 tokens expire but the path does not, so any size suffix renders fine.
const upgrade = (url: string) =>
  /googleusercontent\.com/.test(url)
    ? url.replace(/=w\d+-h\d+(?:-l\d+)?(?:-rj)?$/, '=w544-h544-l90-rj')
    : url

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export function musicThumbCandidates(
  id: string | undefined,
  thumbnails?: { url: string }[]
): string[] {
  const out: string[] = []
  const known = id ? WINNER.get(id) : undefined
  if (known && !DEAD.has(known)) out.push(known)

  for (const t of thumbnails ?? []) {
    if (!t?.url) continue
    const url = proxy(upgrade(t.url))
    if (DEAD.has(url) || out.includes(url)) continue
    out.push(url)
  }

  if (id && VIDEO_ID.test(id)) {
    const stable = proxy(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`)
    if (!DEAD.has(stable) && !out.includes(stable)) out.push(stable)
  }

  return out
}

export function musicCoverUrl(id: string | undefined, thumbnails?: { url: string }[]): string {
  const first = thumbnails?.[0]?.url
  if (first) return upgrade(first)
  if (id && VIDEO_ID.test(id)) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  return ''
}

export function rememberThumb(id: string | undefined, url: string): void {
  if (!id || DEAD.has(url)) return
  WINNER.set(id, url)
  if (WINNER.size > 500) WINNER.clear()
}

export function forgetThumb(url: string): void {
  DEAD.add(url)
  for (const [id, won] of WINNER) if (won === url) WINNER.delete(id)
}
