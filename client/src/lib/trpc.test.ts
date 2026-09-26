import { describe, it, expect, vi } from 'vitest'
import { emitAuthFromTrpcBody } from './trpc'
import { subscribeAuthRequired, type AuthModalKind } from './auth-bus'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

function capture() {
  const kinds: AuthModalKind[] = []
  const seen = new Set<AuthModalKind>()
  const unsubs = (['lan', 'animepahe', 'jasmr'] as AuthModalKind[]).map((kind) =>
    subscribeAuthRequired(kind, () => {
      if (!seen.has(kind)) {
        seen.add(kind)
        kinds.push(kind)
      }
    })
  )
  return { kinds, done: () => unsubs.forEach((u) => u()) }
}

describe('emitAuthFromTrpcBody', () => {
  it('emits animepahe for a batched FORBIDDEN AUTH_REQUIRED envelope', async () => {
    const { kinds, done } = capture()
    await emitAuthFromTrpcBody(
      json([
        {
          error: {
            message: 'AUTH_REQUIRED',
            data: { code: 'FORBIDDEN', cause: { code: 'AUTH_REQUIRED', provider: 'animepahe' } },
          },
        },
      ])
    )
    done()
    expect(kinds).toEqual(['animepahe'])
  })

  it('emits lan for a LAN_AUTH_REQUIRED cause', async () => {
    const { kinds, done } = capture()
    await emitAuthFromTrpcBody(
      json({
        error: {
          message: 'LAN_AUTH_REQUIRED',
          data: { code: 'UNAUTHORIZED', cause: { code: 'LAN_AUTH_REQUIRED' } },
        },
      })
    )
    done()
    expect(kinds).toEqual(['lan'])
  })

  it('ignores success envelopes and non-JSON bodies', async () => {
    const { kinds, done } = capture()
    const listener = vi.fn()
    const unsub = subscribeAuthRequired('lan', listener)
    await emitAuthFromTrpcBody(json([{ result: { data: { value: 'x' } } }]))
    await emitAuthFromTrpcBody(new Response('ok', { headers: { 'content-type': 'text/plain' } }))
    unsub()
    done()
    expect(kinds).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })
})
