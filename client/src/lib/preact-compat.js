// React 19 compatibility layer for Preact.
//
// `@preact/preset-vite` is configured with `reactAliasesEnabled: false`, so
// `react` resolves here instead of bare `preact/compat`. The compat package
// does not implement the React 19 APIs (`useOptimistic`, `use`) that
// `react-router` v8 imports, so this module re-exports everything from
// `preact/compat` and polyfills the two missing hooks.
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
