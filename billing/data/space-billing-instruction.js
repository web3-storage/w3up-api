import * as dagJSON from '@ipld/dag-json'
import { EncodeFailure, DecodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').SpaceBillingInstruction} SpaceBillingInstruction
 */

export const schema = Schema.struct({
  customer: Schema.did({ method: 'mailto' }),
  space: Schema.did(),
  provider: Schema.did({ method: 'web' }),
  account: Schema.uri({ protocol: 'stripe:' }),
  product: Schema.text(),
  from: Schema.date(),
  to: Schema.date()
})

/** @type {import('../lib/api.js').Validator<SpaceBillingInstruction>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api.js').Encoder<SpaceBillingInstruction, string>} */
export const encode = message => {
  try {
    const data = {
      ...message,
      space: message.space,
      provider: message.provider,
      from: message.from.toISOString(),
      to: message.to.toISOString()
    }
    return { ok: dagJSON.stringify(data) }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding space billing instruction message: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api.js').Decoder<string, SpaceBillingInstruction>} */
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
      error: new DecodeFailure(`decoding space billing instruction message: ${err.message}`, { cause: err })
    }
  }
}
