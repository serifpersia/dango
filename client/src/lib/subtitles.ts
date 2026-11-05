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
    const sep = lastKey.indexOf('|||')
    if (sep >= 0) {
      const lastLang = lastKey.slice(0, sep)
      const lastLabel = lastKey.slice(sep + 3)
      const fuzzy = subs.findIndex((s) => {
        const lang = s.language ?? s.lang ?? ''
        const label = s.label ?? ''
        return (
          (lastLabel !== '' && label === lastLabel) ||
          (lastLang !== '' && lastLang !== 'undefined' && (lang === lastLang || label === lastLang))
        )
      })
      if (fuzzy >= 0) return fuzzy
    } else {
      const byId = subs.findIndex(
        (s) => s.label === lastKey || s.language === lastKey || s.lang === lastKey
      )
      if (byId >= 0) return byId
    }
  }
  const eng = subs.findIndex(isEnglishSubtitle)
  return eng >= 0 ? eng : 0
}
