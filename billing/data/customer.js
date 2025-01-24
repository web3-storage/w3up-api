import { EncodeFailure, DecodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').Customer} Customer
 * @typedef {import('../types.js').InferStoreRecord<Customer>} CustomerStoreRecord
 * @typedef {import('../types.js').StoreRecord} StoreRecord
 * @typedef {import('../lib/api.js').CustomerKey} CustomerKey
 * @typedef {import('../types.js').InferStoreRecord<CustomerKey>} CustomerKeyStoreRecord
 */

const schema = Schema.struct({
  customer: Schema.did({ method: 'mailto' }),
  account: Schema.uri({ protocol: 'stripe:' }),
  product: Schema.text(),
  insertedAt: Schema.date(),
  updatedAt: Schema.date().optional()
})

/** @type {import('../lib/api.js').Validator<Customer>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api.js').Encoder<Customer, CustomerStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        customer: input.customer,
        account: input.account,
        product: input.product,
        insertedAt: input.insertedAt.toISOString(),
        updatedAt: input.updatedAt ? input.updatedAt.toISOString() : undefined
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding customer record: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api.js').Encoder<CustomerKey, CustomerKeyStoreRecord>} */
export const encodeKey = input => ({ ok: { customer: input.customer } })

/** @type {import('../lib/api.js').Decoder<StoreRecord, Customer>} */
export const decode = input => {
  try { 
    return {
      ok: {
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        account: Schema.uri({ protocol: 'stripe:' }).from(input.account),
        product: /** @type {string} */ (input.product),
        insertedAt: new Date(input.insertedAt),
        updatedAt: input.updatedAt ? new Date(input.updatedAt) : undefined
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding customer record: ${err.message}`, { cause: err })
    }
  }
}
