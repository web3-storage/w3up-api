import { Schema } from '../../data/lib.js'
import { randomAlphaNumerics } from './ascii.js'
import { randomDIDMailto } from './did.js'
import { randomInteger } from './math.js'

/**
 * @param {Partial<import('../../lib/api.js').Customer>} [base]
 * @returns {import('../../lib/api.js').Customer}
 */
export const randomCustomer = (base = {}) => ({
  customer: randomDIDMailto(),
  account: Schema.uri({ protocol: 'stripe:' }).from(`stripe:cus_${randomAlphaNumerics(14)}`),
  product: ['starter', 'lite', 'business'][randomInteger(0, 3)],
  insertedAt: new Date(),
  updatedAt: new Date(),
  ...base
})
