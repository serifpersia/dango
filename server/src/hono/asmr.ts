export interface JasmrApi {
  browse(o: { query?: string; page?: number; sort?: string; rating?: string }): Promise<unknown>
  getEpisodes(showId: string): Promise<{ description?: string } | null>
  getStreamUrls(showId: string, episode: string): Promise<{ links: unknown[] }[] | null>
  getImages(showId: string): Promise<unknown>
  getChapters(showId: string): Promise<unknown>
}

export function isJasmrApi(mod: unknown): mod is JasmrApi {
  if (!mod || typeof mod !== 'object') return false
  const m = mod as Record<string, unknown>
  return (
    typeof m.browse === 'function' &&
    typeof m.getEpisodes === 'function' &&
    typeof m.getStreamUrls === 'function' &&
    typeof m.getImages === 'function' &&
    typeof m.getChapters === 'function'
  )
}
