export const selectionKey = (filterBy: string, params: URLSearchParams): string => {
  const copy = new URLSearchParams(params)
  copy.delete('page')
  copy.sort()
  return `${filterBy}|${copy.toString()}`
}

export const addPageToSelection = (prev: Set<string>, pageIds: string[]): Set<string> => {
  const next = new Set(prev)
  pageIds.forEach((id) => next.add(id))
  return next
}

export const removePageFromSelection = (prev: Set<string>, pageIds: string[]): Set<string> => {
  const next = new Set(prev)
  pageIds.forEach((id) => next.delete(id))
  return next
}
