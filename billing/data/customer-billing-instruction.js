import * as dagJSON from '@ipld/dag-json'
import { EncodeFailure, DecodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').CustomerBillingInstruction} CustomerBillingInstruction
 */

export const schema = Schema.struct({
  customer: Schema.did({ method: 'mailto' }),
  account: Schema.uri({ protocol: 'stripe:' }),
  product: Schema.text(),
  from: Schema.date(),
  to: Schema.date()
})

/** @type {import('../lib/api.js').Validator<CustomerBillingInstruction>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api.js').Encoder<CustomerBillingInstruction, string>} */
export const encode = message => {
  try {
    const data = {
      ...message,
      from: message.from.toISOString(),
      to: message.to.toISOString()
    }
    return { ok: dagJSON.stringify(data) }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding billing instruction message: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api.js').Decoder<string, CustomerBillingInstruction>} */
export const decode = str => {
  try {
    const data = dagJSON.parse(str)
    return {
      ok: {
        ...data,
        from: new Date(data.from),
        to: new Date(data.to)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding billing instruction message: ${err.message}`, { cause: err })
    }
  }
}
