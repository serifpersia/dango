export type AuthModalKind = string

type AuthModalListener = (kind: AuthModalKind) => void

const listeners = new Map<AuthModalKind, Set<AuthModalListener>>()
const anyListeners = new Set<AuthModalListener>()

function safeCall(listener: AuthModalListener, kind: AuthModalKind): void {
  try {
    listener(kind)
  } catch (err) {
    console.error(`auth-bus listener failed (${kind}):`, err)
  }
}

export function emitAuthRequired(kind: AuthModalKind): void {
  for (const listener of [...(listeners.get(kind) ?? [])]) safeCall(listener, kind)
  for (const listener of [...anyListeners]) safeCall(listener, kind)
}

export function subscribeAuthRequired(
  kind: AuthModalKind,
  listener: AuthModalListener
): () => void {
  let set = listeners.get(kind)
  if (!set) {
    set = new Set()
    listeners.set(kind, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(kind)
  }
}

export function subscribeAnyAuthRequired(listener: AuthModalListener): () => void {
  anyListeners.add(listener)
  return () => {
    anyListeners.delete(listener)
  }
}
