/**
 * Discovers spaces that should be billed for a given customer and enqueues
 * a space billing instruction for each.
 * 
 * @param {import('./api.js').CustomerBillingInstruction} instruction 
 * @param {{
 *   subscriptionStore: import('./api.js').SubscriptionStore
 *   consumerStore: import('./api.js').ConsumerStore
 *   spaceBillingQueue: import('./api.js').SpaceBillingQueue
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit>>}
 */
export const enqueueSpaceBillingInstructions = async (instruction, ctx) => {
  console.log(`Processing customer billing instruction for: ${instruction.customer}`)
  console.log(`Period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  /** @type {string|undefined} */
  let cursor
  while (true) {
    const subsList = await ctx.subscriptionStore.list({ customer: instruction.customer }, { cursor })
    if (subsList.error) return subsList

    // TODO: this is going to be inefficient for any client with many spaces
    // and may eventually cause billing to fail.
    for (const s of subsList.ok.results) {
      const consumerGet = await ctx.consumerStore.get({
        subscription: s.subscription,
        provider: s.provider
      })
      if (consumerGet.error) return consumerGet

      console.log(`Adding space billing instruction for: ${consumerGet.ok.consumer}`)
      const queueAdd = await ctx.spaceBillingQueue.add({
        ...instruction,
        provider: s.provider,
        space: consumerGet.ok.consumer
      })
      if (queueAdd.error) return queueAdd
    }

    if (!subsList.ok.cursor) break
    cursor = subsList.ok.cursor
  }

  return { ok: {} }
}
