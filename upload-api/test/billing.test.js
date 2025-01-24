import { createStripeBillingProvider } from '../billing.js'
import { test } from './helpers/context.js'
import { toEmail } from '@storacha/did-mailto'
import dotenv from 'dotenv'

import Stripe from 'stripe'
import { fileURLToPath } from 'node:url'
import { createCustomerStore, customerTableProps } from '@storacha/upload-service-infra-billing/tables/customer.js'
import { createTable } from './helpers/resources.js'
import { createDynamoDB } from '@storacha/upload-service-infra-billing/test/helpers/aws.js'
import { stripeIDToAccountID } from '@storacha/upload-service-infra-billing/utils/stripe.js'

dotenv.config({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) })

/**
 * @typedef {object} BillingContext
 * @property {import('@storacha/upload-service-infra-billing/lib/api.js').CustomerStore} BillingContext.customerStore
 * @property {Stripe} BillingContext.stripe
 * @property {import('../types.js').BillingProvider} BillingContext.billingProvider
 */

const customerDID = /** @type {import('@storacha/did-mailto').DidMailto} */(
  `did:mailto:example.com:w3up-billing-test-${Date.now()}`
)
const email = toEmail(customerDID)
const initialPlan = 'did:web:starter.web3.storage'

/**
 * 
 * @param {Stripe} stripe 
 * @param {string} email 
 * @returns {Promise<string | null | undefined>}
 */
async function getCustomerPlanByEmail(stripe, email) {
  const customers = await stripe.customers.list({ email, expand: ['data.subscriptions'] })
  if (customers.data.length > 1) throw new Error(`found more than one customer with email ${email}`)
  const customer = customers.data[0]
  if (customer) {
    return customer.subscriptions?.data[0].items.data[0].price.lookup_key
  }
}

/**
 * 
 * @param {Stripe} stripe 
 * @param {string} email 
 * @param {import('@storacha/upload-service-infra-billing/lib/api.js').CustomerStore} customerStore
 * @returns {Promise<Stripe.Customer>}
 */
async function setupCustomer(stripe, email, customerStore) {
  const customer = await stripe.customers.create({ email })
  const customerCreation = await customerStore.put({
    customer: customerDID,
    account: stripeIDToAccountID(customer.id),
    product: initialPlan,
    insertedAt: new Date()
  })
  if (!customerCreation.ok){
    throw customerCreation.error
  }

  // set up a payment method - otherwise we won't be able to update the plan later
  let setupIntent = await stripe.setupIntents.create({
    customer: customer.id,
    payment_method_types: ['card'],
  });
  setupIntent = await stripe.setupIntents.confirm(
    setupIntent.id,
    {
      payment_method: 'pm_card_visa',
    }
  )
  const paymentMethod = /** @type {string} */(setupIntent.payment_method)
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethod } })
  // create a subscription to initialPlan
  const prices = await stripe.prices.list({ lookup_keys: [initialPlan] })
  const initialPriceID = prices.data.find(price => price.lookup_key === initialPlan)?.id
  if (!initialPriceID) {
    throw new Error(`could not find priceID ${initialPlan} in Stripe`)
  }
  await stripe.subscriptions.create({ customer: customer.id, items: [{ price: initialPriceID }] })
  return customer
}

/**
 * 
 * @param {BillingContext} context 
 * @param {(c: BillingContext) => Promise<void>} testFn 
 */
async function withCustomer(context, testFn) {
  const { stripe, customerStore } = context
  let customer
  try {
    // create a new customer and set up its subscription with "initialPlan"
    customer = await setupCustomer(stripe, email, customerStore)
    await testFn(context)
  } finally {
    if (customer) {
      // clean up the user we created
      await stripe.customers.del(customer.id)
    }
  }
}

test.before(async t => {
  const stripeSecretKey = process.env.STRIPE_TEST_SECRET_KEY

  if (!stripeSecretKey) {
    throw new Error('STRIPE_TEST_SECRET_KEY environment variable is not set')
  }
  const { client: dynamo } = await createDynamoDB()

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })

  const customerStore = createCustomerStore(dynamo, { tableName: await createTable(dynamo, customerTableProps) })
  const billingProvider = createStripeBillingProvider(stripe, customerStore)

  Object.assign(t.context, {
    dynamo,
    customerStore,
    stripe,
    billingProvider
  })
})

test('stripe plan can be updated', async (t) => {
  const context = /** @type {typeof t.context & BillingContext } */(t.context)
  const { stripe, billingProvider } = context

  await withCustomer(context, async () => {
    // use the stripe API to verify plan has been initialized correctly
    const initialStripePlan = await getCustomerPlanByEmail(stripe, email)
    t.deepEqual(initialPlan, initialStripePlan)

    // this is the actual code under test!
    const updatedPlan = 'did:web:lite.web3.storage'
    await billingProvider.setPlan(customerDID, updatedPlan)

    // use the stripe API to verify plan has been updated
    const updatedStripePlan = await getCustomerPlanByEmail(stripe, email)
    t.deepEqual(updatedPlan, updatedStripePlan)
  })
})

test('stripe billing session can be generated', async (t) => {
  const context = /** @type {typeof t.context & BillingContext } */(t.context)
  const { billingProvider } = context

  await withCustomer(context, async () => {
    const response = await billingProvider.createAdminSession(customerDID, 'https://example.com/return-url')
    t.assert(response.ok)
    t.assert(response.ok?.url)
  })
})
