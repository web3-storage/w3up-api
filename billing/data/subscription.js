import * as Link from 'multiformats/link'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').Subscription} Subscription
 * @typedef {import('../types.js').InferStoreRecord<Subscription>} SubscriptionStoreRecord
 * @typedef {import('../lib/api.js').SubscriptionKey} SubscriptionKey
 * @typedef {import('../types.js').InferStoreRecord<SubscriptionKey>} SubscriptionKeyStoreRecord
 * @typedef {import('../types.js').StoreRecord} StoreRecord
 * @typedef {import('../lib/api.js').SubscriptionListKey} SubscriptionListKey
 * @typedef {import('../types.js').InferStoreRecord<SubscriptionListKey>} SubscriptionListKeyStoreRecord
 * @typedef {Pick<Subscription, 'customer'|'provider'|'subscription'|'cause'>} SubscriptionList
 */

const schema = Schema.struct({
  customer: Schema.did({ method: 'mailto' }),
  provider: Schema.did({ method: 'web' }),
  subscription: Schema.text(),
  cause: Schema.link({ version: 1 }).optional(),
  insertedAt: Schema.date(),
  updatedAt: Schema.date().optional()
})

/** @type {import('../lib/api.js').Validator<Subscription>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api.js').Encoder<Subscription, SubscriptionStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        customer: input.customer,
        provider: input.provider,
        subscription: input.subscription,
        cause: input.cause ? input.cause.toString() : undefined,
        insertedAt: input.insertedAt.toISOString(),
        updatedAt: input.updatedAt ? input.updatedAt.toISOString() : undefined
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding subscription record: ${err.message}`)
    }
  }
}

/** @type {import('../lib/api.js').Encoder<SubscriptionKey, SubscriptionKeyStoreRecord>} */
export const encodeKey = input => ({
  ok: {
    provider: input.provider,
    subscription: input.subscription
  }
})

/** @type {import('../lib/api.js').Decoder<StoreRecord, Subscription>} */
export const decode = input => {
  try {
    return {
      ok: {
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        provider: Schema.did({ method: 'web' }).from(input.provider),
        subscription: /** @type {string} */ (input.subscription),
        cause: input.cause ? Link.parse(/** @type {string} */ (input.cause)) : undefined,
        insertedAt: new Date(input.insertedAt),
        updatedAt: input.updatedAt ? new Date(input.updatedAt) : undefined
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding subscription record: ${err.message}`, { cause: err })
    }
  }
}

/** Encoders/decoders for listings. */
export const lister = {
  /** @type {import('../lib/api.js').Encoder<SubscriptionListKey, SubscriptionListKeyStoreRecord>} */
  encodeKey: input => ({ ok: { customer: input.customer } }),
  /** @type {import('../lib/api.js').Decoder<StoreRecord, SubscriptionList>} */
  decode: input => {
    try {
      return {
        ok: {
          customer: Schema.did({ method: 'mailto' }).from(input.customer),
          provider: Schema.did({ method: 'web' }).from(input.provider),
          subscription: String(input.subscription),
          cause: input.cause ? Link.parse(String(input.cause)) : undefined
        }
      }
    } catch (/** @type {any} */ err) {
      return {
        error: new DecodeFailure(`decoding subscription record: ${err.message}`, { cause: err })
      }
    }
  }
}
