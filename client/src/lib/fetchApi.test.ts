import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithLocalHeaders } from './fetchApi'

const notReady = () =>
  new Response('Database initializing...', {
    status: 503,
    headers: { 'x-dango-not-ready': '1' },
  })

describe('fetchWithLocalHeaders', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', { getItem: () => null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('backs off for readiness responses and returns an untouched successful body', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(notReady())
      .mockResolvedValueOnce(notReady())
      .mockResolvedValueOnce(new Response('{"ready":true}'))
    vi.stubGlobal('fetch', fetch)
    const pending = fetchWithLocalHeaders('/api/health')
    await vi.advanceTimersByTimeAsync(499)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await (await pending).json()).toEqual({ ready: true })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('stops after three retries and leaves the last error body readable', async () => {
    const fetch = vi.fn().mockImplementation(async () => notReady())
    vi.stubGlobal('fetch', fetch)
    const pending = fetchWithLocalHeaders('/api/health')
    await vi.runAllTimersAsync()
    expect(await (await pending).text()).toBe('Database initializing...')
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['/api/health', undefined, false],
    ['/api/trpc/settings.set', { method: 'POST', body: '{}' }, true],
    [new Request('http://localhost/api/mutate', { method: 'POST', body: '{}' }), undefined, true],
    ['https://external.example/api/health', undefined, true],
  ])('does not retry an unrelated failure or mutation: %s', async (url, init, marked) => {
    const response = marked ? notReady() : new Response('Provider unavailable', { status: 503 })
    const fetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetch)
    expect(await fetchWithLocalHeaders(url, init)).toBe(response)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the backoff immediately without another fetch', async () => {
    const fetch = vi.fn().mockResolvedValue(notReady())
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const pending = fetchWithLocalHeaders('/api/health', { signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    expect(vi.getTimerCount()).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('preserves Headers overrides and does not send local credentials to another origin', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://dango.example' } })
    vi.stubGlobal('localStorage', { getItem: () => 'secret' })
    const fetch = vi.fn().mockImplementation(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetch)
    await fetchWithLocalHeaders('/api/health', {
      headers: new Headers({ 'x-animepahe-ua': 'override' }),
    })
    expect(fetch.mock.calls[0][1].headers.get('x-animepahe-ua')).toBe('override')
    await fetchWithLocalHeaders('https://dango.example.evil/api/health')
    expect(fetch.mock.calls[1][1].headers.has('x-animepahe-cookie')).toBe(false)
    await fetchWithLocalHeaders('//external.example/api/health')
    expect(fetch.mock.calls[2][1].headers.has('x-animepahe-cookie')).toBe(false)
  })
})
