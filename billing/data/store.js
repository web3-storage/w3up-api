import * as Link from 'multiformats/link'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').StoreTable} StoreTable
 * @typedef {import('../lib/api.js').StoreTableSpaceInsertedAtIndex} StoreTableSpaceInsertedAtIndex
 * @typedef {import('../types.js').InferStoreRecord<StoreTable>} StoreTableStoreRecord
 * @typedef {import('../lib/api.js').StoreTableKey} StoreTableKey
 * @typedef {import('../lib/api.js').StoreTableListKey} StoreTableListKey
 * @typedef {import('../types.js').InferStoreRecord<StoreTableKey>} StoreTableKeyStoreRecord
 * @typedef {{ space: string, insertedAt?: string}} StoreTableListStoreRecord
 * @typedef {import('../types.js').StoreRecord} StoreRecord
 */

const schema = Schema.struct({
  space: Schema.did(),
  link: Schema.link({ version: 1 }),
  invocation: Schema.link({ version: 1 }),
  insertedAt: Schema.date(),
  size: Schema.bigint().greaterThanEqualTo(0n),
  issuer: Schema.did().optional(),
})

/** @type {import('../lib/api.js').Validator<StoreTable>} */
export const validate = (input) => schema.read(input)

/** @type {import('../lib/api.js').Encoder<StoreTableKey, StoreTableKeyStoreRecord>} */
export const encodeKey = (input) => ({ ok: { link: input.link } })

/** @type {import('../lib/api.js').Encoder<StoreTable, StoreTableStoreRecord>} */
export const encode = (input) => {
  try {
    return {
      ok: {
        space: input.space.toString(),
        link: input.link.toString(),
        invocation: input.invocation.toString(),
        insertedAt: input.insertedAt.toISOString(),
        size: input.size.toString(),
        issuer: input.issuer?.toString(),
      },
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding store record: ${err.message}`, {
        cause: err,
      }),
    }
  }
}

/** @type {import('../lib/api.js').Decoder<StoreRecord, StoreTable>} */
export const decode = (input) => {
  try {
    return {
      ok: {
        space: Schema.did().from(input.space),
        link: Link.parse(/** @type {string} */ (input.link)),
        invocation: Link.parse(/** @type {string} */ (input.invocation)),
        insertedAt: new Date(input.insertedAt),
        size: BigInt(input.size),
        issuer: Schema.did().from(input.issuer),
      },
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding store record: ${err.message}`, {
        cause: err,
      }),
    }
  }
}

export const lister = {
  /** @type {import('../lib/api.js').Encoder<StoreTableListKey, StoreTableListStoreRecord>} */
  encodeKey: (input) => {
    /** @type  StoreTableListStoreRecord */
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
  /** @type {import('../lib/api.js').Decoder<StoreRecord, StoreTableSpaceInsertedAtIndex>} */
  decode: (input) => {
    try {
      return {
        ok: {
          space: Schema.did().from(input.space),
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
  },
}
