import { Schema } from '../../data/lib.js'
import { randomLink } from './dag.js'
import { randomDIDMailto } from './did.js'
import { randomInteger } from './math.js'

/**
 * @param {Partial<import('../../lib/api.js').Subscription>} [base]
 * @returns {Promise<import('../../lib/api.js').Subscription>}
 */
export const randomSubscription = async (base = {}) => ({
  customer: randomDIDMailto(),
  provider: Schema.did({ method: 'web' }).from(['did:web:up.storacha.network', 'did:web:web3.storage', 'did:web:nft.storage'][randomInteger(0, 2)]),
  subscription: randomLink().toString(),
  cause: randomLink(),
  insertedAt: new Date(),
  updatedAt: new Date(),
  ...base
})
