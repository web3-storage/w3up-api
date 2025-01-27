import { Schema } from '../../data/lib.js'
import { randomCustomer } from './customer.js'
import { randomLink } from './dag.js'
import { randomDID } from './did.js'
import { randomInteger } from './math.js'

/**
 * @param {Partial<import('../../lib/api.js').Consumer>} [base]
 * @returns {Promise<import('../../lib/api.js').Consumer>}
 */
export const randomConsumer = async (base = {}) => ({
  consumer: await randomDID(),
  provider: Schema.did({ method: 'web' }).from(['did:web:up.storacha.network', 'did:web:web3.storage', 'did:web:nft.storage'][randomInteger(0, 2)]),
  subscription: randomLink().toString(),
  customer: randomCustomer().customer,
  cause: randomLink(),
  insertedAt: new Date(),
  updatedAt: new Date(),
  ...base
})
