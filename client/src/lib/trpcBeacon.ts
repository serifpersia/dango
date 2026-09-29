function batchBody(input: unknown): string {
  return JSON.stringify({ 0: { json: input ?? {} } })
}

function batchUrl(path: string): string {
  return `/api/trpc/${path}?batch=1`
}

export function trpcBeacon(path: string, input: unknown): void {
  const body = batchBody(input)
  const url = batchUrl(path)
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      return
    }
  } catch {
    // ignore
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

export async function trpcKeepalive(path: string, input: unknown): Promise<void> {
  await fetch(batchUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: batchBody(input),
    keepalive: true,
  })
}

export function clearDiscordPresence(sessionId: string | undefined): void {
  if (!sessionId) return
  trpcBeacon('discord.clear', { sessionId })
  trpcBeacon('discord.heartbeat', { sessionId, bye: true })
}
