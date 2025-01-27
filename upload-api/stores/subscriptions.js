/**
 * @param {object} conf
 * @param {import('../types.js').ConsumerTable} conf.consumerTable
 * @returns {import('@storacha/upload-api').SubscriptionsStorage}
 */
export function useSubscriptionsStore({ consumerTable }) {
  return {
    list: async (customer) => {
      const { results: consumers } = await consumerTable.listByCustomer(customer)

      /** @type {Record<string, import('../types.js').ConsumerListRecord[]>} */
      const subs = {}
      for (const consumer of consumers) {
        subs[consumer.subscription] = subs[consumer.subscription] || []
        subs[consumer.subscription].push(consumer)
      }

      /** @type {import('@storacha/upload-api').SubscriptionListItem[]} */
      const subscriptions = []
      for (const [subscription, consumers] of Object.entries(subs)) {
        subscriptions.push({
          subscription,
          provider: consumers[0].provider,
          consumers: consumers.map(c => c.consumer)
        })
      }

      return { ok: { results: subscriptions } }
    },
  }
}