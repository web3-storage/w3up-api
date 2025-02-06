import * as Link from 'multiformats/link'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').Consumer} Consumer
 * @typedef {import('../types.js').InferStoreRecord<Consumer>} ConsumerStoreRecord
 * @typedef {import('../types.js').StoreRecord} StoreRecord
 * @typedef {import('../lib/api.js').ConsumerKey} ConsumerKey
 * @typedef {import('../types.js').InferStoreRecord<ConsumerKey>} ConsumerKeyStoreRecord
 * @typedef {import('../lib/api.js').ConsumerListKey} ConsumerListKey
 * @typedef {import('../types.js').InferStoreRecord<ConsumerListKey>} ConsumerListKeyStoreRecord
 * @typedef {Pick<Consumer, 'consumer'|'provider'|'subscription'|'customer'>} ConsumerList
 */

const schema = Schema.struct({
  consumer: Schema.did(),
  provider: Schema.did({ method: 'web' }),
  subscription: Schema.text(),
  customer: Schema.did({ method: 'mailto' }),
  cause: Schema.link({ version: 1 }).optional(),
  insertedAt: Schema.date(),
  updatedAt: Schema.date().optional()
})

/** @type {import('../lib/api.js').Validator<Consumer>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api.js').Encoder<Consumer, ConsumerStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        consumer: input.consumer,
        provider: input.provider,
        subscription: input.subscription,
        customer: input.customer,
        cause: input.cause ? input.cause.toString() : undefined,
        insertedAt: input.insertedAt.toISOString(),
        updatedAt: input.updatedAt ? input.updatedAt.toISOString() : undefined
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding consumer record: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api.js').Decoder<StoreRecord, Consumer>} */
export const decode = input => {
  try { 
    return {
      ok: {
        consumer: Schema.did().from(input.consumer),
        provider: Schema.did({ method: 'web' }).from(input.provider),
        subscription: /** @type {string} */ (input.subscription),
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        cause: input.cause ? Link.parse(/** @type {string} */ (input.cause)) : undefined,
        insertedAt: new Date(input.insertedAt),
        updatedAt: input.updatedAt ? new Date(input.updatedAt) : undefined
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding consumer record: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api.js').Encoder<ConsumerKey, ConsumerKeyStoreRecord>} */
export const encodeKey = input => ({
  ok: {
    subscription: input.subscription,
    provider: input.provider
  }
})

/** Encoders/decoders for listings. */
export const lister = {
  /** @type {import('../lib/api.js').Encoder<ConsumerListKey, ConsumerListKeyStoreRecord>} */
  encodeKey: input => ({ ok: { consumer: input.consumer } }),
  /** @type {import('../lib/api.js').Decoder<StoreRecord, ConsumerList>} */
  decode: input => {
    try { 
      return {
        ok: {
          consumer: Schema.did().from(input.consumer),
          provider: Schema.did({ method: 'web' }).from(input.provider),
          subscription: String(input.subscription),
          customer: Schema.did({ method: 'mailto' }).from(input.customer)
        }
      }
    } catch (/** @type {any} */ err) {
      return {
        error: new DecodeFailure(`decoding consumer list record: ${err.message}`, { cause: err })
      }
    }
  }
}
