import * as Link from 'multiformats/link'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api').Allocation} Allocation
 * @typedef {import('../types').InferStoreRecord<Allocation>} AllocationStoreRecord
 * @typedef {import('../lib/api').AllocationKey} AllocationKey
 * @typedef {import('../lib/api').AllocationListKey} AllocationListKey
 * @typedef {import('../types').InferStoreRecord<AllocationKey>} AllocationKeyStoreRecord
 * @typedef {{ space: string, insertedAt?: string }} AllocationListStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 */

const schema = Schema.struct({
  space: Schema.did(),
  multihash: Schema.text(),
  cause: Schema.link({ version: 1 }),
  insertedAt: Schema.date(),
  size: Schema.bigint().greaterThanEqualTo(0n),
})

/** @type {import('../lib/api').Validator<Allocation>} */
export const validate = (input) => schema.read(input)

/** @type {import('../lib/api').Encoder<AllocationKey, AllocationKeyStoreRecord>} */
export const encodeKey = (input) => ({ ok: { multihash: input.multihash } })

/** @type {import('../lib/api').Encoder<Allocation, AllocationStoreRecord>} */
export const encode = (input) => {
  try {
    return {
      ok: {
        space: input.space.toString(),
        multihash: input.multihash,
        cause: input.cause.toString(),
        insertedAt: input.insertedAt.toISOString(),
        size: input.size.toString(),
      },
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding allocation record: ${err.message}`, {
        cause: err,
      }),
    }
  }
}

/** @type {import('../lib/api').Decoder<StoreRecord, Allocation>} */
export const decode = (input) => {
  try {
    return {
      ok: {
        space: Schema.did().from(input.space),
        multihash: /** @type {string} */ (input.multihash),
        cause: Link.parse(/** @type {string} */ (input.cause)),
        insertedAt: new Date(input.insertedAt),
        size: BigInt(input.size),
      },
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding allocation record: ${err.message}`, {
        cause: err,
      }),
    }
  }
}

export const lister = {
  /** @type {import('../lib/api').Encoder<AllocationListKey, AllocationListStoreRecord>} */
  encodeKey: (input) => {
    /** @type  AllocationListStoreRecord */
    const conditions = { space: input.space.toString() }
    if (input.insertedAt) {
      conditions.insertedAt = input.insertedAt.toISOString()
    }
    return {
      ok: {
        ...conditions,
      },
    }
  },
  decode,
}