// Minimal runtime stub for the `prop-types` package.
//
// `react-simple-maps` (used only by the /map page) still does
// `import PropTypes from 'prop-types'` for legacy runtime checks.
// We deliberately do not ship the real `prop-types` dependency:
// our code is strict TypeScript and never uses it directly.
// This stub provides no-op validators so the legacy import resolves
// at bundle time without pulling an unneeded dependency.

interface PropTypesValidator {
  (...args: unknown[]): null
  isRequired: PropTypesValidator
}

interface PropTypesModule extends PropTypesValidator {
  [key: string]: PropTypesValidator
}

const baseValidator = (): null => null
const validator = baseValidator as PropTypesValidator
validator.isRequired = validator

const handler: ProxyHandler<PropTypesValidator> = {
  get: () => validator,
  apply: () => validator,
}

const PropTypes = new Proxy(validator, handler) as PropTypesModule

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
