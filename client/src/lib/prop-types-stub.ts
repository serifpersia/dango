// Minimal runtime stub for the `prop-types` package.
//
// `react-simple-maps` (used only by the /map page) still does
// `import PropTypes from 'prop-types'` for legacy runtime checks.
// We deliberately do not ship the real `prop-types` dependency:
// our code is strict TypeScript and never uses it directly.
// This stub provides no-op validators so the legacy import resolves
// at bundle time without pulling an unneeded dependency.

const validator = () => null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(validator as any).isRequired = validator

const handler = {
  get: () => validator,
  apply: () => validator,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PropTypes: any = new Proxy(validator, handler)

export default PropTypes

export const array = validator
export const bool = validator
export const func = validator
export const number = validator
export const object = validator
export const string = validator
export const symbol = validator
export const node = validator
export const element = validator
export const any = validator
