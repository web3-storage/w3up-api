import { Client } from '@storacha/indexing-service-client'
import { PIECE_V1_CODE, PIECE_V1_MULTIHASH, PIECE_V2_MULTIHASH, RAW_CODE } from './constants.js'

/** 
 * @typedef {import('multiformats/cid').CID} CID
 * @typedef {import('@web3-storage/content-claims/client/api').Claim} Claim
 **/

/**
 * Return the cid if it is a Piece CID or undefined if not
 *
 * @param {CID} cid
 */
export function asPieceCidV2 (cid) {
  if (cid.multihash.code === PIECE_V2_MULTIHASH && cid.code === RAW_CODE) {
    return cid
  }
}

/**
 * Return the cid if it is a v1 Piece CID or undefined if not
 *
 * @param {CID} cid
 */
export function asPieceCidV1 (cid) {
  if (cid.multihash.code === PIECE_V1_MULTIHASH && cid.code === PIECE_V1_CODE) {
    return cid
  }
}

/**
 * Find the set of CIDs that are claimed to be equivalent to the Piece CID.
 * 
 * @param {CID} piece
 * @param {Client} [indexingService] - returns content claims for a cid
 */
export async function findEquivalentCids (piece, indexingService = createIndexingServiceClient()) {
  /** @type {Set<import('multiformats').UnknownLink>} */
  const cids = new Set()

  const res = await indexingService.queryClaims({ hashes: [piece.multihash] })
  if (res.error) throw new Error('failed to query claims', { cause: res.error })

  for (const claim of res.ok.claims.values()) {
    const cap = claim.capabilities[0]
    if (cap?.can !== 'assert/equals') {
      continue
    }
    // an equivalence claim may have the pieceCid as the content cid _or_ the equals cid
    // so if content does not equal piece, we can grab the content. Otherwise equals
    const equivalentCid = cap.nb?.content.equals(piece) ? cap.nb.equals : cap.nb.content
    cids.add(equivalentCid)
  }
  return cids
}

/** @param {'prod' | string} env */
export function createIndexingServiceClient (env = process.env.SST_STAGE) {
  return new Client(env === 'prod' ? {} : { serviceURL: 'https://staging.claims.web3.storage' })
}
