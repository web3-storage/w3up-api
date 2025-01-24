import { randomLink } from './dag.js'
import { randomDID } from './did.js'

/**
 * @param {import('../../lib/api.js').Customer} customer
 * @returns {Promise<import('../../lib/api.js').EgressTrafficData>}
 */
export const randomEgressEvent = async (customer) => ({
  space: await randomDID(),
  customer: customer.customer,
  resource: randomLink(),
  bytes: Math.floor(Math.random() * 1000000),
  // Random timestamp within the last 3 minutes
  servedAt: new Date(Date.now() - Math.floor(Math.random() * 3 * 60 * 1000)),
  cause: randomLink()
})
