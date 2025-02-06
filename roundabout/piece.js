import { Client } from '@storacha/indexing-service-client'
import { equals } from 'multiformats/bytes'
import { PIECE_V1_CODE, PIECE_V1_MULTIHASH, PIECE_V2_MULTIHASH, RAW_CODE } from './constants.js'

/**
 * @import { Delegation, Capability, Resource, UnknownLink } from '@ucanto/interface'
 */

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
  /** @type {Map<string, import('multiformats').UnknownLink>} */
  const cids = new Map()

  const res = await indexingService.queryClaims({ hashes: [piece.multihash] })
  if (res.error) throw new Error('failed to query claims', { cause: res.error })

  for (const claim of res.ok.claims.values()) {
    if (!isEqualsClaim(claim)) {
      continue
    }
    const cap = claim.capabilities[0]
    const contentDigest = cap.nb.content.multihash ?? new Uint8Array()
    // an equivalence claim may have the pieceCid as the content cid _or_ the equals cid
    // so if content does not equal piece, we can grab the content. Otherwise equals
    const equivalentCid = equals(piece.multihash.bytes, contentDigest.bytes) ? cap.nb.equals : cap.nb.content
    cids.set(equivalentCid.toString(), equivalentCid)
  }
  return new Set(cids.values())
}

/**
 * @param {import('@ucanto/core').Delegation} claim
 * @returns {claim is Delegation<[Capability<'assert/equals', Resource, { content: UnknownLink, equals: UnknownLink }>]>}
 */
const isEqualsClaim = claim => {
  const cap = claim.capabilities[0]
  if (!cap) {
    return false
  }
  if (cap.can !== 'assert/equals') {
    return false
  }
  if (cap.nb == null || typeof cap.nb != 'object') {
    return false
  }
  if (!('content' in cap.nb) || !('equals' in cap.nb)) {
    return false
  }
  return true
}

/** @param {'prod' | string} env */
export function createIndexingServiceClient (env = process.env.SST_STAGE) {
  return new Client(env === 'prod' ? {} : { serviceURL: 'https://staging.indexer.storacha.network' })
}
