import dotenv from 'dotenv'
import path from 'node:path'
import { createDynamoDB, createSQS, createQueue, createTable } from './aws.js'
import { createCustomerStore, customerTableProps } from '../../tables/customer.js'
import { encode as encodeCustomer, validate as validateCustomer } from '../../data/customer.js'
import { decode as decodeCustomerBillingInstruction } from '../../data/customer-billing-instruction.js'
import { decode as decodeSpaceBillingInstruction } from '../../data/space-billing-instruction.js'
import { encode as encodeSubscription, validate as validateSubscription } from '../../data/subscription.js'
import { encode as encodeConsumer, validate as validateConsumer } from '../../data/consumer.js'
import { decode as decodeUsage, lister as usageLister } from '../../data/usage.js'
import { decodeStr as decodeEgressTrafficEvent, validate as validateEgressTrafficEvent, encode as encodeEgressTrafficEvent } from '../../data/egress.js'
import { createCustomerBillingQueue } from '../../queues/customer.js'
import { createSpaceBillingQueue } from '../../queues/space.js'
import { consumerTableProps, subscriptionTableProps } from '../../../upload-api/tables/index.js'
import { createStoreListerClient, createStorePutterClient } from '../../tables/client.js'
import { createSubscriptionStore } from '../../tables/subscription.js'
import { createConsumerStore } from '../../tables/consumer.js'
import { createSpaceDiffStore, spaceDiffTableProps } from '../../tables/space-diff.js'
import { createSpaceSnapshotStore, spaceSnapshotTableProps } from '../../tables/space-snapshot.js'
import { createUsageStore, usageTableProps } from '../../tables/usage.js'
import { createQueueRemoverClient } from './queue.js'
import { createEgressTrafficQueue } from '../../queues/egress-traffic.js'
import { handler as createEgressTrafficHandler } from '../../functions/egress-traffic-queue.js'
import Stripe from 'stripe'
import { createEgressTrafficEventStore, egressTrafficTableProps } from '../../tables/egress-traffic.js'

dotenv.config({ path: path.resolve('../.env.local'), override: true, debug: true })

/**
 * @typedef {{
 *  dynamo: import('./aws.js').AWSService<import('@aws-sdk/client-dynamodb').DynamoDBClient>
 *  sqs: import('./aws.js').AWSService<import('@aws-sdk/client-sqs').SQSClient>
 * }} AWSServices
 */

/** @type {AWSServices} */
let awsServices
const createAWSServices = async () => {
  awsServices = awsServices ?? {
    dynamo: await createDynamoDB(),
    sqs: await createSQS()
  }
}

/**
 * @returns {{ stripe: Stripe, stripeSecretKey: string, billingMeterEventName: string, billingMeterId: string }}
 */
const createStripeService = () => {
  const stripeSecretKey = process.env.STRIPE_TEST_SECRET_KEY
  if (!stripeSecretKey) {
    throw new Error('STRIPE_TEST_SECRET_KEY environment variable is not set')
  }
  const billingMeterEventName = process.env.STRIPE_BILLING_METER_EVENT_NAME
  if (!billingMeterEventName) {
    throw new Error('STRIPE_BILLING_METER_EVENT_NAME environment variable is not set')
  }
  const billingMeterId = process.env.STRIPE_BILLING_METER_ID
  if (!billingMeterId) {
    throw new Error('STRIPE_BILLING_METER_ID environment variable is not set')
  }
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" })
  return { stripe, stripeSecretKey, billingMeterEventName, billingMeterId }
}

export const createBillingCronTestContext = async () => {
  await createAWSServices()

  const customerTableName = await createTable(awsServices.dynamo.client, customerTableProps, 'customer-')
  const customerStore = {
    ...createCustomerStore(awsServices.dynamo.client, { tableName: customerTableName }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: customerTableName,
      validate: validateCustomer, // assume test data is valid
      encode: encodeCustomer
    })
  }
  const customerBillingQueueURL = new URL(await createQueue(awsServices.sqs.client, 'customer-billing-'))
  const customerBillingQueue = {
    ...createCustomerBillingQueue(awsServices.sqs.client, { url: customerBillingQueueURL }),
    ...createQueueRemoverClient(awsServices.sqs.client, {
      url: customerBillingQueueURL,
      decode: decodeCustomerBillingInstruction
    })
  }

  return { customerStore, customerBillingQueue }
}

export const createCustomerBillingQueueTestContext = async () => {
  await createAWSServices()

  const subscriptionTableName = await createTable(awsServices.dynamo.client, subscriptionTableProps, 'subscription-')
  const subscriptionStore = {
    ...createSubscriptionStore(awsServices.dynamo.client, { tableName: subscriptionTableName }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: subscriptionTableName,
      validate: validateSubscription, // assume test data is valid
      encode: encodeSubscription
    })
  }
  const consumerTableName = await createTable(awsServices.dynamo.client, consumerTableProps, 'consumer-')
  const consumerStore = {
    ...createConsumerStore(awsServices.dynamo.client, { tableName: consumerTableName }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: consumerTableName,
      validate: validateConsumer, // assume test data is valid
      encode: encodeConsumer
    })
  }
  const spaceBillingQueueURL = new URL(await createQueue(awsServices.sqs.client, 'space-billing-'))
  const spaceBillingQueue = {
    ...createSpaceBillingQueue(awsServices.sqs.client, { url: spaceBillingQueueURL }),
    ...createQueueRemoverClient(awsServices.sqs.client, {
      url: spaceBillingQueueURL,
      decode: decodeSpaceBillingInstruction
    })
  }

  return { subscriptionStore, consumerStore, spaceBillingQueue }
}

export const createSpaceBillingQueueTestContext = async () => {
  await createAWSServices()

  const spaceDiffTableName = await createTable(awsServices.dynamo.client, spaceDiffTableProps, 'space-diff-')
  const spaceDiffStore = createSpaceDiffStore(awsServices.dynamo.client, { tableName: spaceDiffTableName })
  const spaceSnapshotTableName = await createTable(awsServices.dynamo.client, spaceSnapshotTableProps, 'space-snapshot-')
  const spaceSnapshotStore = createSpaceSnapshotStore(awsServices.dynamo.client, { tableName: spaceSnapshotTableName })
  const usageTableName = await createTable(awsServices.dynamo.client, usageTableProps, 'usage-')
  const usageStore = {
    ...createUsageStore(awsServices.dynamo.client, { tableName: usageTableName }),
    ...createStoreListerClient(awsServices.dynamo.client, {
      tableName: usageTableName,
      encodeKey: usageLister.encodeKey,
      decode: decodeUsage
    })
  }

  return { spaceDiffStore, spaceSnapshotStore, usageStore }
}

export const createStripeTestContext = async () => {
  await createAWSServices()

  const customerTableName = await createTable(awsServices.dynamo.client, customerTableProps, 'customer-')
  const customerStore = createCustomerStore(awsServices.dynamo.client, { tableName: customerTableName })

  return { customerStore }
}

/**
 * @returns {Promise<import('../lib/api.js').EgressTrafficTestContext>}
 */
export const createEgressTrafficTestContext = async () => {
  await createAWSServices()

  const egressQueueURL = new URL(await createQueue(awsServices.sqs.client, 'egress-traffic-queue-'))
  const egressTrafficQueue = {
    add: createEgressTrafficQueue(awsServices.sqs.client, { url: egressQueueURL }).add,
    remove: createQueueRemoverClient(awsServices.sqs.client, { url: egressQueueURL, decode: decodeEgressTrafficEvent }).remove,
  }

  const accountId = (await awsServices.sqs.client.config.credentials()).accountId
  const region = 'us-west-2'

  const customerTable = await createTable(awsServices.dynamo.client, customerTableProps, 'customer-')
  const customerStore = {
    ...createCustomerStore(awsServices.dynamo.client, { tableName: customerTable }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: customerTable,
      validate: validateCustomer, // assume test data is valid
      encode: encodeCustomer
    })
  }

  const egressTrafficTable = await createTable(awsServices.dynamo.client, egressTrafficTableProps, 'egress-traffic-events-')
  const egressTrafficEventStore = {
    ...createEgressTrafficEventStore(awsServices.dynamo.client, { tableName: egressTrafficTable }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: egressTrafficTable,
      validate: validateEgressTrafficEvent, // assume test data is valid
      encode: encodeEgressTrafficEvent
    })
  }

  const { stripe, stripeSecretKey, billingMeterEventName, billingMeterId } = createStripeService()

  // @ts-expect-error -- Don't need to initialize the full lambda context for testing
  return {
    egressTrafficQueue,
    egressTrafficQueueUrl: egressQueueURL.toString(),
    egressTrafficHandler: createEgressTrafficHandler,
    accountId: accountId ?? '',
    region: region ?? '',
    customerTable,
    customerStore,
    egressTrafficTable,
    egressTrafficEventStore,
    billingMeterEventName,
    billingMeterId,
    stripeSecretKey,
    stripe,
  }
}

/**
 * @template C
 * @param {import('../lib/api.js').TestSuite<C>} suite
 * @param {() => Promise<C>} createContext
 */
export const bindTestContext = (suite, createContext) => {
  /** @type {import('../lib/api.js').TestSuite<C>} */
  const test = {}
  for (const [name, impl] of Object.entries(suite)) {
    test[name] = async (assert) => impl(assert, await createContext())
  }
  return test
}
