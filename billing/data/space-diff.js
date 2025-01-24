import * as Link from 'multiformats/link'
import { EncodeFailure, DecodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').SpaceDiff} SpaceDiff
 * @typedef {import('../types.js').InferStoreRecord<SpaceDiff> & { pk: string, sk: string }} SpaceDiffStoreRecord
 * @typedef {import('../lib/api.js').SpaceDiffListKey} SpaceDiffListKey
 * @typedef {{ pk: string, sk: string }} SpaceDiffListStoreRecord
 * @typedef {import('../types.js').StoreRecord} StoreRecord
 */

export const schema = Schema.struct({
  space: Schema.did(),
  provider: Schema.did({ method: 'web' }),
  subscription: Schema.text(),
  cause: Schema.link({ version: 1 }),
  delta: Schema.integer(),
  receiptAt: Schema.date(),
  insertedAt: Schema.date()
})

/** @type {import('../lib/api.js').Validator<SpaceDiff>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api.js').Encoder<SpaceDiff, SpaceDiffStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        pk: `${input.provider}#${input.space}`,
        sk: `${input.receiptAt.toISOString()}#${input.cause}`,
        space: input.space,
        provider: input.provider,
        subscription: input.subscription,
        cause: input.cause.toString(),
        delta: input.delta,
        receiptAt: input.receiptAt.toISOString(),
        insertedAt: new Date().toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding space diff record: ${err.message}`, { cause: err })
    }
  }
}



/** @type {import('../lib/api.js').Decoder<StoreRecord, SpaceDiff>} */
export const decode = input => {
  try {
    return {
      ok: {
        space: Schema.did().from(input.space),
        provider: Schema.did({ method: 'web' }).from(input.provider),
        subscription: /** @type {string} */ (input.subscription),
        cause: Link.parse(/** @type {string} */ (input.cause)),
        delta: /** @type {number} */ (input.delta),
        receiptAt: new Date(input.receiptAt),
        insertedAt: new Date(input.insertedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding space diff record: ${err.message}`, { cause: err })
    }
  }
}

export const lister = {
  /** @type {import('../lib/api.js').Encoder<SpaceDiffListKey, SpaceDiffListStoreRecord>} */
  encodeKey: input => ({
    ok: {
      pk: `${input.provider}#${input.space}`,
      sk: input.from.toISOString()
    }
  })
}
