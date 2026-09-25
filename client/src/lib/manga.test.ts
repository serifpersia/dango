import { describe, it, expect } from 'vitest'
import {
  isMangaAdult,
  resolveMangaTitle,
  mangaNameVariants,
  parseSyntheticChapterId,
  findChapterByNumber,
} from './manga'

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

describe('parseSyntheticChapterId', () => {
  it('parses anilist chapter pointers', () => {
    expect(parseSyntheticChapterId('anilist:ch:5')).toBe(5)
    expect(parseSyntheticChapterId('anilist:ch:0')).toBe(0)
  })

  it('rejects real provider chapter ids and junk', () => {
    expect(parseSyntheticChapterId('8c697de6-a142-4cec')).toBeNull()
    expect(parseSyntheticChapterId('anilist:ch:abc')).toBeNull()
    expect(parseSyntheticChapterId('')).toBeNull()
    expect(parseSyntheticChapterId(null)).toBeNull()
  })
})

describe('findChapterByNumber', () => {
  const chapters = [{ number: '4' }, { number: '5.5' }, { number: ' 6 ' }, { number: 'Oneshot' }]

  it('prefers exact string matches', () => {
    expect(findChapterByNumber(chapters, 4)).toEqual({ number: '4' })
  })

  it('matches numeric equivalents', () => {
    expect(findChapterByNumber(chapters, 6)).toEqual({ number: ' 6 ' })
  })

  it('does not floor fractional chapters onto integers', () => {
    expect(findChapterByNumber(chapters, 5)).toBeNull()
  })

  it('returns null when the provider lacks the chapter', () => {
    expect(findChapterByNumber(chapters, 99)).toBeNull()
    expect(findChapterByNumber([], 1)).toBeNull()
  })
})
