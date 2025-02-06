import { 
  accountIDToStripeCustomerID, 
  stripeIDToAccountID,
  handleCustomerSubscriptionCreated } from '../../utils/stripe.js'
import * as DidMailto from '@storacha/did-mailto'


/** @type {import('../lib/api.js').TestSuite<import('../lib/api.js').StripeTestContext>} */
export const test = {
  'should create a customer record': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const stripeCustomerId = 'stripe-customer-id'
    const product = 'did:web:test-product'
    const email = 'travis@example.com'
    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(email))

    const getResult = await ctx.customerStore.get({ customer })
    assert.equal(getResult.error?.name, 'RecordNotFound')

    const result = await handleCustomerSubscriptionCreated(
      {
        customers: {
          // @ts-expect-error the return value would normally have more values, but we don't use them
          retrieve: async (s) => ({
            id: stripeCustomerId,
            email: 'travis@example.com',
          })
        }
      },
      {
        data: {
          object: {
            customer: stripeCustomerId,
            items: {
              data: [
                {
                  price: {
                    lookup_key: product
                  }
                }
              ]
            }
          }
        }
      },
      ctx.customerStore
    )
    assert.ok(result.ok)
    const customerRecord = await ctx.customerStore.get({ customer })
    assert.equal(customerRecord.ok?.product, product)
  },

  'should convert an account ID to a stripe customer ID': (/** @type {import('entail').assert} */ assert) => {
    const accountID = 'stripe:cus_1234567890'
    const stripeCustomerId = accountIDToStripeCustomerID(accountID)
    assert.equal(stripeCustomerId, 'cus_1234567890')
  },

  'should convert a stripe customer ID to an account ID': (/** @type {import('entail').assert} */ assert) => {
    const stripeCustomerId = 'cus_1234567890'
    const accountID = stripeIDToAccountID(stripeCustomerId)
    assert.equal(accountID, 'stripe:cus_1234567890')
  }
}
