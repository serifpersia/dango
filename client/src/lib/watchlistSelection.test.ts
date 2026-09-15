import { describe, it, expect } from 'vitest'
import { selectionKey, addPageToSelection, removePageFromSelection } from './watchlistSelection'

describe('selectionKey', () => {
  it('ignores the page param so paging keeps the selection', () => {
    const a = new URLSearchParams('query=naruto&page=1')
    const b = new URLSearchParams('query=naruto&page=2')
    expect(selectionKey('All', a)).toBe(selectionKey('All', b))
  })

  it('changes when filters change', () => {
    const a = new URLSearchParams('query=naruto&page=1')
    const b = new URLSearchParams('query=bleach&page=1')
    expect(selectionKey('All', a)).not.toBe(selectionKey('All', b))
  })

  it('changes when the filter tab changes', () => {
    const params = new URLSearchParams('page=1')
    expect(selectionKey('All', params)).not.toBe(selectionKey('Watching', params))
  })
})

describe('addPageToSelection', () => {
  it('accumulates ids across pages instead of replacing', () => {
    const prev = new Set(['a', 'b'])
    const next = addPageToSelection(prev, ['c', 'd'])
    expect([...next].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(prev.has('c')).toBe(false)
  })
})

describe('removePageFromSelection', () => {
  it('removes only the given page ids and keeps other pages', () => {
    const prev = new Set(['a', 'b', 'c'])
    expect([...removePageFromSelection(prev, ['a', 'b'])].sort()).toEqual(['c'])
  })
})
