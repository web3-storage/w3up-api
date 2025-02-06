import { ConflictError as ConsumerConflictError } from '../tables/consumer.js'
import { ConflictError as SubscriptionConflictError } from '../tables/subscription.js'
import { CBOR, Failure } from '@ucanto/server'

/**
 * Create a subscription ID for a given provision. Currently 
 * uses a CID generated from `consumer` which ensures a space
 * can be provisioned at most once.
 * 
 * @param {import('@storacha/upload-api').Provision} item 
 * @returns string
 */
export const createProvisionSubscriptionId = async ({ customer, consumer }) =>
  (await CBOR.write({ consumer })).cid.toString()

/**
 * @param {import('../types.js').SubscriptionTable} subscriptionTable
 * @param {import('../types.js').ConsumerTable} consumerTable
 * @param {import('../types.js').SpaceMetricsTable} spaceMetricsTable
 * @param {import('@ucanto/interface').DID<'web'>[]} services
 * @returns {import('@storacha/upload-api').ProvisionsStorage}
 */
export function useProvisionStore (subscriptionTable, consumerTable, spaceMetricsTable, services) {
  return {
    services,
    hasStorageProvider: async (consumer) => (
      { ok: await consumerTable.hasStorageProvider(consumer) }
    ),

    getStorageProviders: async (consumer) => (
      { ok: await consumerTable.getStorageProviders(consumer) }
    ),

    put: async (item) => {
      const { cause, consumer, customer, provider } = item
      const subscription = await createProvisionSubscriptionId(item)

      try {
        await subscriptionTable.add({
          cause: cause.cid,
          provider,
          customer,
          subscription
        })
      } catch (error) {
        // if we got a conflict error, ignore - it means the subscription already exists and
        // can be used to create a consumer/provider relationship below
        if (!(error instanceof SubscriptionConflictError)) {
          return {
            error: new Failure('Unknown error adding subscription', {
              cause: error
            })
          }
        }
      }

      try {
        await consumerTable.add({
          cause: cause.cid,
          provider,
          consumer,
          customer,
          subscription
        })
        return { ok: { id: subscription } }
      } catch (error) {
        return (error instanceof ConsumerConflictError) ? (
          {
            error
          }
        ) : (
          {
            error: new Failure('Unknown error adding consumer', {
              cause: error
            })
          }
        )
      }
    },

    /**
     * get number of stored items
     */
    count: async () => {
      return consumerTable.count()
    },

    getCustomer: async (provider, customer) => {
      const subscriptions = await subscriptionTable.findProviderSubscriptionsForCustomer(customer, provider)
      // if we don't have any subscriptions for a customer
      if (subscriptions.length === 0) {
        return { error: { name: 'CustomerNotFound', message: `could not find ${customer}` } }
      }
      return {
        ok: {
          did: customer,
          subscriptions: subscriptions.map(s => s.subscription)
        }
      }
    },

    getConsumer: async (provider, consumer) => {
      const [consumerRecord, allocated] = await Promise.all([
        consumerTable.get(provider, consumer),
        spaceMetricsTable.getAllocated(consumer)
      ])
      return consumerRecord ? ({
        ok: {
          did: consumer,
          allocated,
          limit: 1_000_000_000, // set to an arbitrarily high number because we currently don't enforce any limits
          subscription: consumerRecord.subscription,
          customer: consumerRecord.customer
        }
      }) : (
        { error: { name: 'ConsumerNotFound', message: `could not find ${consumer}` } }
      )
    },

    getSubscription: async (provider, subscription) => {
      const [subscriptionRecord, consumerRecord] = await Promise.all([
        subscriptionTable.get(provider, subscription),
        consumerTable.getBySubscription(provider, subscription)
      ])
      if (subscriptionRecord) {
        /** @type {import('@storacha/upload-api').Subscription} */
        const result = {
          customer: /** @type {import('@storacha/upload-api').AccountDID} */(subscriptionRecord.customer)
        }
        if (consumerRecord) {
          result.consumer = /** @type {import('@ucanto/interface').DIDKey} */(consumerRecord.consumer)
        }
        return { ok: result }

      } else {
        return { error: { name: 'SubscriptionNotFound', message: 'unimplemented' } }
      }
    }
  }
}
