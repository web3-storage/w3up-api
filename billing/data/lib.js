import { Failure } from '@ucanto/server'
import * as Validator from '@ucanto/validator'

export class DecodeFailure extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor (message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('DecodeFailure')
    this.detail = message
  }

  describe () {
    const detail = this.detail ? `: ${this.detail}` : ''
    return `decode failed${detail}`
  }
}

export class EncodeFailure extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor (message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('EncodeFailure')
    this.detail = message
  }

  describe () {
    const detail = this.detail ? `: ${this.detail}` : ''
    return `encode failed${detail}`
  }
}

/**
 * @template [I=unknown]
 * @extends {Validator.Schema.API<bigint, I>}
 */
export class BigIntSchema extends Validator.Schema.API {
  /**
   * @param {I} input
   */
  readWith (input) {
    return typeof input === 'bigint'
      ? { ok: input }
      : Validator.typeError({ expect: 'bigint', actual: input })
  }

  toString () {
    return 'bigint'
  }

  /**
   * @param {bigint} n
   */
  greaterThanEqualTo (n) {
    return this.refine(new GreaterThanEqualTo(n))
  }
}

/**
 * @template {bigint} T
 * @extends {Validator.Schema.API<T, T, bigint>}
 */
export class GreaterThanEqualTo extends Validator.Schema.API {
  /**
   * @param {T} input
   * @param {bigint} number
   * @returns {Validator.Schema.ReadResult<T>}
   */
  readWith (input, number) {
    return input >= number
      ? { ok: input }
      : Validator.Schema.error(`Expected ${input} >= ${number}`)
  }

  toString() {
    return `greaterThan(${this.settings})`
  }
}

/**
 * @template [I=unknown]
 * @extends {Validator.Schema.API<Date, I>}
 */
export class DateSchema extends Validator.Schema.API {
  /**
   * @param {I} input
   */
  readWith (input) {
    return input instanceof Date
      ? { ok: input }
      : Validator.typeError({ expect: 'Date', actual: input })
  }

  toString () {
    return 'Date'
  }
}

export const Schema = {
  ...Validator.Schema,
  bigint: () => new BigIntSchema(),
  date: () => new DateSchema()
}
