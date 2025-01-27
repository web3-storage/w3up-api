import http from 'node:http'
import { ok, error } from '@ucanto/core'
import { StorageNode } from '@storacha/upload-api/test/external-service'
import * as BlobCapabilities from '@storacha/capabilities/blob'
import { DIDResolutionError } from '@ucanto/validator'
import { delegate } from '@ucanto/core/delegation'

/** @import * as API from '../../../types.js' */

/**
 * @param {API.StorageProviderTable} storageProviderTable 
 * @param {import('@storacha/upload-api').ClaimsClientConfig} claimsService
 * @param {import('@ucanto/interface').Signer} serviceID
 */
export const create = async (storageProviderTable, claimsService, serviceID) => {
  /** @type {import('@ucanto/interface').PrincipalResolver} */
  const principalResolver = {}
  if (serviceID.did().startsWith('did:web')) {
    principalResolver.resolveDIDKey = (did) =>
      did === serviceID.did()
        ? ok(serviceID.toDIDKey())
        : error(new DIDResolutionError(did))
  }

  const node = await StorageNode.activate({
    http,
    claimsService,
    ...principalResolver
  })

  const proof = await delegate({
    issuer: node.id,
    audience: serviceID,
    capabilities: [
      { can: BlobCapabilities.allocate.can, with: node.id.did() },
      { can: BlobCapabilities.accept.can, with: node.id.did() },
    ],
    expiration: Infinity
  })

  // @ts-expect-error this is a HTTP node so connection will have a URL
  const endpoint = /** @type {URL} */ (node.connection.channel.url)

  // add the node to the rotation
  await storageProviderTable.put({
    provider: node.id.did(),
    endpoint,
    proof,
    weight: 100
  })

  return {
    async deactivate () {
      // take out of rotation on deactivate
      await storageProviderTable.del(node.id.did())
      await node.deactivate()
    }
  }
}
