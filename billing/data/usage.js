import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').Usage} Usage
 * @typedef {import('../types.js').InferStoreRecord<Usage> & { sk: string }} UsageStoreRecord
 * @typedef {import('../lib/api.js').UsageListKey} UsageListKey
 * @typedef {Omit<import('../types.js').InferStoreRecord<UsageListKey>, 'from'> & { sk: string }} UsageListKeyStoreRecord
 * @typedef {import('../types.js').StoreRecord} StoreRecord
 */

export const schema = Schema.struct({
  customer: Schema.did({ method: 'mailto' }),
  space: Schema.did(),
  provider: Schema.did({ method: 'web' }),
  account: Schema.uri({ protocol: 'stripe:' }),
  product: Schema.text(),
  usage: Schema.bigint().greaterThanEqualTo(0n),
  from: Schema.date(),
  to: Schema.date(),
  insertedAt: Schema.date()
})

/** @type {import('../lib/api.js').Validator<Usage>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api.js').Encoder<Usage, UsageStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        sk: `${input.from.toISOString()}#${input.provider}#${input.space}`,
        customer: input.customer,
        account: input.account,
        product: input.product,
        provider: input.provider,
        space: input.space,
        usage: input.usage.toString(),
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        insertedAt: input.insertedAt.toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding usage record: ${err.message}`, { cause: err })
    }
  }
}

export const lister = {
  /** @type {import('../lib/api.js').Encoder<UsageListKey, UsageListKeyStoreRecord>} */
  encodeKey: input => ({
    ok: {
      customer: input.customer,
      sk: input.from.toISOString()
    }
  })
}



/** @type {import('../lib/api.js').Decoder<StoreRecord, Usage>} */
export const decode = input => {
  try {
    return {
      ok: {
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        account: Schema.uri({ protocol: 'stripe:' }).from(input.account),
        product: /** @type {string} */ (input.product),
        provider: Schema.did({ method: 'web' }).from(input.provider),
        space: Schema.did().from(input.space),
        usage: BigInt(input.usage),
        from: new Date(input.from),
        to: new Date(input.to),
        insertedAt: new Date(input.insertedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding usage record: ${err.message}`, { cause: err })
    }
  }
}
