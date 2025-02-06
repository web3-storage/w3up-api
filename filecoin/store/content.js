import { StoreOperationFailed, RecordNotFound } from '@storacha/filecoin-api/errors'
import pRetry from 'p-retry'

/**
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 * @typedef {import('@storacha/filecoin-api/storefront/api').ContentStore<UnknownLink, Uint8Array>} ContentStore
 */

/**
 * @param {URL} storeHttpEndpoint
 * @returns {ContentStore}
 */
export const useContentStore = (storeHttpEndpoint) => {
  return {
    /**
     * Stream Blob bytes for a given CID.
     *
     * @param {import('@ucanto/interface').UnknownLink} cid 
     */
    stream: async (cid) => {
      // create URL for the link to be fetched
      const getUrl = new URL(`/${cid.toString()}`, storeHttpEndpoint)

      // Retry a few times as it looks like R2 sometimes takes a bit to make it available
      let res
      try {
        res = await pRetry((async () => {
          const fetchRes = await fetch(getUrl, {
            // Follow potential redirects
            redirect: 'follow',
          })
          if (fetchRes.status === 404) {
            throw new RecordNotFound(`blob ${cid.toString()} not found in store`)
          } else if (!fetchRes.ok || !fetchRes.body) {
              throw new StoreOperationFailed(fetchRes.statusText)
          }
          return fetchRes.body
        }), { retries: 5 })
      } catch (err) {
        /** @type {RecordNotFound | StoreOperationFailed} */
        // @ts-ignore
        const error = err
        return {
          error
        }
      }

      return {
        ok: res
      }
    }
  }
}
