import { enqueueSpaceBillingInstructions } from '../../lib/customer-billing-queue.js'
import { startOfLastMonth, startOfMonth, } from '../../lib/util.js'
import { randomConsumer } from '../helpers/consumer.js'
import { randomCustomer } from '../helpers/customer.js'
import { collectQueueMessages } from '../helpers/queue.js'
import { randomSubscription } from '../helpers/subscription.js'

/** @type {import('./api.js').TestSuite<import('./api.js').CustomerBillingQueueTestContext>} */
export const test = {
  'should queue all spaces for a customer': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const provider = 'did:web:up.storacha.network'

    const consumers = await Promise.all([
      randomConsumer({ provider }),
      randomConsumer({ provider }),
      randomConsumer({ provider })
    ])

    for (const c of consumers) {
      await ctx.consumerStore.put(c)
    }

    const subscriptions = await Promise.all(consumers.map(c => {
      return randomSubscription({
        customer: customer.customer,
        subscription: c.subscription,
        provider: c.provider
      })
    }))

    for (const s of subscriptions) {
      await ctx.subscriptionStore.put(s)
    }

    const now = new Date()
    /** @type {import('../../lib/api.js').CustomerBillingInstruction} */
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: startOfLastMonth(now),
      to: startOfMonth(now)
    }

    const handled = await enqueueSpaceBillingInstructions(instruction, ctx)
    assert.ok(handled.ok)

    const collected = await collectQueueMessages(ctx.spaceBillingQueue)
    assert.ok(collected.ok)
    assert.equal(collected.ok.length, consumers.length)

    // ensure we got a space billing instruction for each consumer
    for (const c of consumers) {
      assert.ok(collected.ok.some(sbi => (
        sbi.space === c.consumer && sbi.provider === c.provider
      )))
    }
  }
}
