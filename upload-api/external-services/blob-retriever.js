import { ok, error } from '@ucanto/core'
import { BlobNotFound } from '@storacha/upload-api/blob'
import * as Digest from 'multiformats/hashes/digest'
import { equals } from 'multiformats/bytes'

/**
 * @import * as API from '@storacha/upload-api'
 * @typedef {API.Link | { digest: Uint8Array }} LinkOrDigest
 * @typedef {{
 *   content: LinkOrDigest
 *   location: string[]
 *   range?: { offset: number, length?: number }
 * }} LocationCaveats
 */

/**
 * @param {import('@storacha/indexing-service-client/api').IndexingServiceClient} client
 * @returns {API.BlobRetriever}
 */
export const create = (client) => {
  return {
    /** @type {API.BlobRetriever['stream']} */
    async stream(digest) {
      const result = await client.queryClaims({ hashes: [digest] })
      if (result.error) {
        // @ts-expect-error need to align blob retriever error types
        return result
      }

      for (const claim of result.ok.claims.values()) {
        const cap = claim.capabilities[0]
        if (cap.can === 'assert/location') {
          const caveats = /** @type {LocationCaveats} */ (cap.nb)
          const contentDigest = toDigest(caveats.content)
          if (equals(contentDigest.bytes, digest.bytes)) {
            const headers = new Headers()
            if (caveats.range) {
              headers.set('Range', `bytes=${caveats.range.offset}-${caveats.range.length || ''}`)
            }
            const res = await fetch(caveats.location[0], { headers })
            if (!res.body) throw new Error('missing response body')
            return ok(res.body)
          }
        }
      }
      return error(new BlobNotFound(digest))
    },
  }
}

/** @param {LinkOrDigest} input */
const toDigest = input =>
  'digest' in input ? Digest.decode(input.digest) : input.multihash
