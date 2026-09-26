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
