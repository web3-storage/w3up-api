import { base58btc } from 'multiformats/bases/base58'
import { EncodeFailure } from './lib.js'

/**
 * @typedef {import('../lib/api.js').BlocksCarsPositionRecord} BlocksCarsPositionRecord
 * @typedef {import('../types.js').InferStoreRecord<BlocksCarsPositionRecord>} BlocksCarsPositionStoreRecord
 */

/** @type {import('../lib/api.js').Encoder<import('../lib/api.js').Location, BlocksCarsPositionStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        blockmultihash: base58btc.encode(input.digest.bytes),
        carpath: input.location.toString(),
        offset: input.range[0],
        length: input.range[1]
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding blocks CARs position record: ${err.message}`, { cause: err })
    }
  }
}
