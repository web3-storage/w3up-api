import * as DidMailto from '@storacha/did-mailto'

/**
 * @typedef {import('../lib/api.js').AccountID} AccountID
 * @typedef {import('stripe').Stripe} Stripe
 * @typedef {import('stripe').Stripe.CustomerSubscriptionCreatedEvent} CustomerSubscriptionCreatedEvent
 */

/**
 * Converts a Stripe customer ID to an Account ID.
 * e.g:
 *   cus_1234567890 -> stripe:cus_1234567890
 * 
 * @param {string} stripeID 
 * @returns {AccountID}
 */
export function stripeIDToAccountID(stripeID) {
  return /** @type {AccountID} */(`stripe:${stripeID}`)
}

/**
 * Converts an Account ID to a Stripe customer ID.
 * e.g:
 *   stripe:cus_1234567890 -> cus_1234567890
 * 
 * @param {AccountID} accountID 
 * @returns {string}
 */
export const accountIDToStripeCustomerID = (accountID) => accountID.slice('stripe:'.length)


/**
 *
 * @param {Stripe} stripe
 * @param {CustomerSubscriptionCreatedEvent} event
 * @param {import('../lib/api.js').CustomerStore} customerStore
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
 */
export async function handleCustomerSubscriptionCreated(stripe, event, customerStore) {
  // per https://stripe.com/docs/expand#with-webhooks these attributes will always be a string in a webhook, so these typecasts are safe
  const customerId = String(event.data.object.customer)
  const product = String(event.data.object.items.data[0].price.lookup_key)
  if (!product.startsWith('did:web:')) {
    return { error: new Error(`Invalid product: ${product}`) }
  }

  const account = stripeIDToAccountID(customerId)
  const stripeCustomer = await stripe.customers.retrieve(customerId)
  if (stripeCustomer.deleted) {
    return {
      error: new Error(`Could not update subscription information - user appears to have been deleted`)
    }
  } else {
    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(
      stripeCustomer.email
    ))

    return customerStore.put({
      customer,
      account,
      product,
      insertedAt: new Date(),
      updatedAt: new Date()
    })
  }
}

/**
 * Records an egress traffic event in the Stripe Billing Meter API for the given customer account.
 * 
 * @param {import('stripe').Stripe} stripe
 * @param {string} billingMeterEventName
 * @param {import('../lib/api.js').EgressTrafficData} egressData
 * @param {AccountID} customerAccount
 */
export async function recordBillingMeterEvent(stripe, billingMeterEventName, egressData, customerAccount) {
  const stripeCustomerId = accountIDToStripeCustomerID(customerAccount)
  /** @type {import('stripe').Stripe.Customer | import('stripe').Stripe.DeletedCustomer} */
  const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId)
  if (stripeCustomer.deleted) {
    return {
      error: {
        name: 'StripeCustomerNotFound',
        message: `Customer ${stripeCustomerId} has been deleted from Stripe`,
      }
    }
  }

  /** @type {import('stripe').Stripe.Billing.MeterEvent} */
  const meterEvent = await stripe.billing.meterEvents.create({
    event_name: billingMeterEventName,
    payload: {
      stripe_customer_id: stripeCustomerId,
      // Stripe expects the value to be a string
      value: egressData.bytes.toString(),
    },
    // Stripe expects the timestamp to be in seconds
    timestamp: Math.floor(egressData.servedAt.getTime() / 1000),
  },
    {
      idempotencyKey: `${egressData.servedAt.toISOString()}-${egressData.space}-${egressData.customer}-${egressData.resource}-${egressData.cause}`
    }
  )

  // Identifier is only set if the event was successfully created
  if (meterEvent.identifier) {
    console.log(`Meter event created: ${meterEvent.identifier}`)
    return { ok: { meterEvent } }
  }
  return {
    error: {
      name: 'StripeBillingMeterEventCreationFailed',
      message: `Error creating meter event for egress traffic in Stripe for customer ${egressData.customer} @ ${egressData.servedAt.toISOString()}`,
    }
  }
}