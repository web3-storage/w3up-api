import * as Signer from '@ucanto/principal/ed25519'
import * as DID from '@ipld/dag-ucan/did'
import { CAR, HTTP } from '@ucanto/transport'
import { connect } from '@ucanto/client'

/**
 * Client connection config for w3filecoin pipeline entrypoint, i.e. API Storefront relies on
 *
 * @param {URL} url 
 */
export async function getClientConfig (url) {
  // UCAN actors
  const agent = await Signer.generate()
  const storefrontService = DID.parse('did:web:staging.up.storacha.network')

  return {
    invocationConfig: {
      issuer: agent,
      with: agent.did(),
      audience: storefrontService,
    },
    connection: connect({
      id: storefrontService,
      codec: CAR.outbound,
      channel: HTTP.open({
        url,
        method: 'POST',
      }),
    })
  }
}
