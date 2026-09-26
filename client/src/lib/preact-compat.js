export * from 'preact/compat'
export { default } from 'preact/compat'

import { useState } from 'preact/hooks'

export function useOptimistic(value) {
  const [, setOptimistic] = useState(value)
  return [value, setOptimistic]
}

export function use(resource) {
  if (typeof resource?.then === 'function') {
    throw resource
  }
  return resource
}
