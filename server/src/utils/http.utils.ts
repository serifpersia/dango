export class HttpError extends Error {
  status: number

  constructor(status: number, message?: string) {
    super(message || `Upstream request failed with status ${status}`)
    this.name = 'HttpError'
    this.status = status
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

export interface FetchRetryOptions {
  retries?: number
  baseDelayMs?: number
  timeoutMs?: number
  signal?: AbortSignal
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {}
): Promise<Response> {
  const { retries = 0, baseDelayMs = 100, timeoutMs = 30000, signal } = options
  let attempt = 0
  for (;;) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetch(input, { ...init, signal: combined })
      if (!isRetryableStatus(response.status) || attempt >= retries) return response
      try {
        await response.body?.cancel()
      } catch {
        // ignore
      }
    } catch (err) {
      if (signal?.aborted || attempt >= retries) throw err
      if (!isAbortError(err) && !(err instanceof TypeError)) throw err
    }
    attempt += 1
    await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), 3000))
  }
}
