import { describe, it, expect } from 'vitest'
import { formatTime, sanitizeText } from './utils'

describe('formatTime', () => {
  it('returns 00:00 for non-positive or invalid input', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(-5)).toBe('00:00')
    expect(formatTime(NaN)).toBe('00:00')
  })

  it('formats seconds as m:ss below one hour', () => {
    expect(formatTime(5)).toBe('00:05')
    expect(formatTime(65)).toBe('01:05')
    expect(formatTime(3599)).toBe('59:59')
  })

  it('formats seconds as h:mm:ss at or above one hour', () => {
    expect(formatTime(3600)).toBe('01:00:00')
    expect(formatTime(3661)).toBe('01:01:01')
  })
})

describe('sanitizeText', () => {
  it('returns empty string for missing input', () => {
    expect(sanitizeText(undefined)).toBe('')
    expect(sanitizeText(null)).toBe('')
    expect(sanitizeText('')).toBe('')
  })

  it('strips HTML tags', () => {
    expect(sanitizeText('<b>Hello</b> <i>world</i>')).toBe('Hello world')
    expect(sanitizeText('Line<br>break')).toBe('Linebreak')
  })

  it('decodes common entities and trims', () => {
    expect(sanitizeText('  A &amp; B&nbsp;C  ')).toBe('A & B C')
    expect(sanitizeText('&lt;tag&gt; &quot;q&quot; &#39;s&#39;')).toBe('<tag> "q" \'s\'')
  })
})
