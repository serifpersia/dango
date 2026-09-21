import { describe, it, expect } from 'vitest'
import { isMangaAdult, resolveMangaTitle, mangaNameVariants } from './manga'

describe('isMangaAdult', () => {
  it('flags erotica and pornographic ratings', () => {
    expect(isMangaAdult({ contentRating: 'erotica' })).toBe(true)
    expect(isMangaAdult({ contentRating: 'pornographic' })).toBe(true)
  })

  it('flags doujinshi type', () => {
    expect(isMangaAdult({ type: 'doujinshi' })).toBe(true)
  })

  it('passes safe content', () => {
    expect(isMangaAdult({ contentRating: 'safe' })).toBe(false)
    expect(isMangaAdult({ type: 'manga' })).toBe(false)
    expect(isMangaAdult({})).toBe(false)
  })
})

describe('resolveMangaTitle', () => {
  it('returns the picked title for name preference', () => {
    expect(resolveMangaTitle({ title: 'One Piece' }, 'name')).toBe('One Piece')
  })

  it('prefers exact variants when providers supply them', () => {
    const source = {
      title: 'One Piece',
      altTitle: 'ワンピース',
      titles: { en: 'One Piece', native: 'ワンピース' },
    }
    expect(resolveMangaTitle(source, 'englishName')).toBe('One Piece')
    expect(resolveMangaTitle(source, 'nativeName')).toBe('ワンピース')
  })

  it('falls back to alt title for native preference without variants', () => {
    expect(resolveMangaTitle({ title: 'Berserk', altTitle: 'ベルセルク' }, 'nativeName')).toBe(
      'ベルセルク'
    )
    expect(resolveMangaTitle({ title: 'Berserk' }, 'nativeName')).toBe('Berserk')
    expect(resolveMangaTitle({ title: 'Berserk', altTitle: 'ベルセルク' }, 'englishName')).toBe(
      'Berserk'
    )
  })
})

describe('mangaNameVariants', () => {
  it('maps variants for card display names', () => {
    expect(mangaNameVariants({ title: 'Berserk', altTitle: 'ベルセルク' })).toEqual({
      englishName: 'Berserk',
      nativeName: 'ベルセルク',
    })
    expect(mangaNameVariants({ title: 'Berserk' })).toEqual({
      englishName: 'Berserk',
      nativeName: undefined,
    })
  })
})
