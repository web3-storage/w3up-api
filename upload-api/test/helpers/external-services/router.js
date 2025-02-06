import { base58btc } from 'multiformats/bases/base58'
import * as RoutingService from '../../../external-services/router.js'

/**
 * @import * as API from '../../../types.js'
 * @import { BlobAPI } from '@storacha/upload-api/types'
 */

/** @type {Map<string, import('@ipld/dag-ucan').Principal>} */
const stickySelect = new Map()

/**
 * @param {API.StorageProviderTable} storageProviderTable
 * @param {import('@ucanto/interface').Signer} serviceID
 * @returns {BlobAPI.RoutingService}
 */
export const create = (storageProviderTable, serviceID) => {
  const router = RoutingService.create(storageProviderTable, serviceID)
  return ({
    selectStorageProvider: async (digest, size) => {
      // ensure we pick the same provider for a given digest within a test
      const key = base58btc.encode(digest.bytes)

      let provider = stickySelect.get(key)
      if (provider) {
        const exists = await storageProviderTable.get(provider.did())
        if (exists) {
          return { ok: provider }
        }
        provider = undefined
      }

      const result = await router.selectStorageProvider(digest, size)
      if (!result.ok) return result

      stickySelect.set(key, result.ok)
      return result
    },
    configureInvocation: (provider, capability, options) =>
      router.configureInvocation(provider, capability, options)
  })
}
