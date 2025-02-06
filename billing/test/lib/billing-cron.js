import { startOfLastMonth, startOfMonth, } from '../../lib/util.js'
import { enqueueCustomerBillingInstructions } from '../../lib/billing-cron.js'
import { randomCustomer } from '../helpers/customer.js'
import { collectQueueMessages } from '../helpers/queue.js'

/** @type {import('./api.js').TestSuite<import('./api.js').BillingCronTestContext>} */
export const test = {
  'should queue all the customers': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customers = []
    for (let i = 0; i < 1100; i++) {
      const customer = randomCustomer()
      const { error } = await ctx.customerStore.put(customer)
      assert.ok(!error)
      customers.push(customer)
    }

    const now = new Date()
    const period = { from: startOfLastMonth(now), to: startOfMonth(now) }
    const handled = await enqueueCustomerBillingInstructions(period, ctx)
    assert.ok(handled.ok)

    const collected = await collectQueueMessages(ctx.customerBillingQueue)
    assert.ok(collected.ok)
    assert.equal(collected.ok.length, customers.length)

    for (const instruction of collected.ok) {
      assert.equal(instruction.from.getTime(), period.from.getTime())
      assert.equal(instruction.to.getTime(), period.to.getTime())
    }

    // ensure we got a billing instruction for each customer
    for (const c of customers) {
      assert.ok(collected.ok.some(cbi => cbi.customer === c.customer))
    }
  }
}
