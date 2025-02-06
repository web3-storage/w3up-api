import * as ed25519 from '@ucanto/principal/ed25519'
import * as DID from '@ipld/dag-ucan/did'
import { CAR, HTTP } from '@ucanto/transport'
import { connect } from '@ucanto/client'

/**
 * Given a config, return a ucanto Signer object representing the service
 *
 * @param {object} config
 * @param {string} config.privateKey - multiformats private key of primary signing key
 * @param {string} [config.did] - public DID for the upload service (did:key:... derived from PRIVATE_KEY if not set)
 * @returns {import('@ucanto/principal/ed25519').Signer.Signer}
 */
export function getServiceSigner(config) {
  const signer = ed25519.parse(config.privateKey)
  if (config.did) {
    const did = DID.parse(config.did).did()
    return signer.withDID(did)
  }
  return signer
}

/**
 * Given a string, parse into provider ServiceDIDs. 
 * 
 * @param {string} serviceDids a comma-separated string of ServiceDIDs
 * @returns {import('@storacha/upload-api').ServiceDID[]}
 */
export function parseServiceDids(serviceDids) {
  return /** @type {import('@storacha/upload-api').ServiceDID[]} */(
    serviceDids.split(',').map(s => {
      const did = DID.parse(s.trim()).did()
      if (!did.startsWith('did:web:')) {
        throw new Error(`Invalid ServiceDID - ServiceDID must be a did:web: ${did}`)
      }
      return did
    })
  )
}

/**
 * 
 * @param {{ did: string, url: string }} config 
 * @returns 
 */
export function getServiceConnection (config) {
  const servicePrincipal = DID.parse(config.did) // 'did:web:up.storacha.network'
  const serviceURL = new URL(config.url) // 'https://up.storacha.network'

  const serviceConnection = connect({
    id: servicePrincipal,
    codec: CAR.outbound,
    channel: HTTP.open({
      url: serviceURL,
      method: 'POST',
    }),
  })

  return serviceConnection
}
