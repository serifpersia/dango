export interface SubtitleLike {
  language?: string
  lang?: string
  label?: string
}

const langOf = (s: SubtitleLike): string => (s.language ?? s.lang ?? '').toLowerCase()
const labelOf = (s: SubtitleLike): string => (s.label ?? '').toLowerCase()

export const subtitleKey = (s: SubtitleLike): string =>
  `${s.language ?? s.lang ?? ''}|||${s.label ?? ''}`

export const isEnglishSubtitle = (s: SubtitleLike): boolean =>
  langOf(s).startsWith('en') || labelOf(s).includes('english')

export function pickSubtitleIndex<T extends SubtitleLike>(
  subs: T[],
  opts?: { lastKey?: string | null; enabled?: boolean }
): number {
  if (subs.length === 0) return -1
  if (opts?.enabled === false) return -1
  const lastKey = opts?.lastKey ?? null
  if (lastKey) {
    const idx = subs.findIndex((s) => subtitleKey(s) === lastKey)
    if (idx >= 0) return idx
  }
  const eng = subs.findIndex(isEnglishSubtitle)
  return eng >= 0 ? eng : 0
}
