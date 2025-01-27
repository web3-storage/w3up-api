import { encodeStr } from '../../data/egress.js'
import { randomCustomer } from '../helpers/customer.js'
import { randomEgressEvent } from '../helpers/egress.js'
import retry from 'p-retry'
import * as DidMailto from '@storacha/did-mailto'

/** @type {import('./api.js').TestSuite<import('./api.js').EgressTrafficTestContext>} */
export const test = {
  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressTrafficTestContext} ctx
   */
  'should process all the egress traffic events from the queue': async (assert, ctx) => {
    /** @type {string | null} */
    let stripeCustomerId = null
    try {
      // 0. Create a test customer email, add it to stripe and to the customer store
      const didMailto = `did:mailto:storacha.network:egress-billing-test`
      const email = DidMailto.toEmail(/** @type {`did:mailto:${string}:${string}`} */(didMailto))
      const stripeCustomer = await ctx.stripe.customers.create({ email })
      assert.ok(stripeCustomer.id, 'Error adding customer to stripe')
      stripeCustomerId = stripeCustomer.id

      const customer = randomCustomer({
        customer: didMailto,
        /** @type {`stripe:${string}`} */
        account: `stripe:${stripeCustomerId}`
      })
      const { error } = await ctx.customerStore.put(customer)
      assert.ok(!error, 'Error adding customer')

      // 1. Add egress events to the queue to simulate egress traffic from the Freeway worker
      const maxEvents = 5
      /** @type {import('../../lib/api.js').EgressTrafficData[]} */
      const events = await Promise.all(
        Array.from(
          { length: maxEvents },
          async () => await randomEgressEvent(customer)
        )
      )

      for (const e of events) {
        console.log(`Egress traffic for ${e.customer}, bytes: ${e.bytes}, servedAt: ${e.servedAt.toISOString()}, `)
        const result = await ctx.egressTrafficQueue.add(e)
        assert.ok(!result.error, 'Error adding egress event to the queue')
      }

      // 2. Create a SQS event batch
      // @type {import('aws-lambda').SQSEvent}
      const sqsEventBatch = {
        Records: events.map(e => ({
          // @type {import('aws-lambda').SQSRecord}
          body: encodeStr(e).ok ?? '',
          messageId: Math.random().toString(),
          receiptHandle: Math.random().toString(),
          awsRegion: ctx.region,
          eventSource: 'aws:sqs',
          eventSourceARN: `arn:aws:sqs:${ctx.region}:${ctx.accountId}:${ctx.egressTrafficQueueUrl}`,
          awsAccountId: ctx.accountId,
          md5OfBody: '',
          md5OfMessageAttributes: '',
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: e.servedAt.getTime().toString(),
            SenderId: ctx.accountId,
            ApproximateFirstReceiveTimestamp: e.servedAt.getTime().toString(),
          },
          messageAttributes: {},
        }))
      }

      // 3. Process the SQS event to trigger the handler using the custom context
      const customCtx = {
        clientContext: {
          Custom: ctx,
        },
      }
      // @ts-expect-error -- Don't need to initialize the full lambda context for testing
      await ctx.egressTrafficHandler(sqsEventBatch, customCtx, (err, res) => {
        if (err) {
          assert.fail(err)
        }
        assert.ok(res)
        assert.equal(res.statusCode, 200)
        assert.equal(res.body, 'Egress events processed successfully')
      })

      // 4. Check if the aggregated meter event exists and has a value greater than 0
      let aggregatedMeterEvent
      try {
        const maxRetries = 5
        const delay = 10000 // 10 seconds
        // Convert to the start of the hour
        const startTime = Math.floor(events[0].servedAt.getTime() / 3600000) * 3600
        // Convert to the end of the next hour
        const endTime = Math.floor((Date.now() + 3600000) / 3600000) * 3600
        console.log(`Checking for aggregated meter event for customer ${stripeCustomerId}, startTime: ${startTime}, endTime: ${endTime} ...`)
        aggregatedMeterEvent = await retry(async () => {
          const result = await ctx.stripe.billing.meters.listEventSummaries(
            ctx.billingMeterId,
            {
              customer: stripeCustomerId ?? '',
              start_time: startTime,
              end_time: endTime,
              value_grouping_window: 'hour',
            }
          )
          if (result && result.data && result.data.length > 0) {
            return result
          }
          throw new Error('No aggregated meter event found yet')
        }, {
          retries: maxRetries,
          minTimeout: delay,
          factor: 3,
          shouldRetry: err => (err instanceof Error && err.message === 'No aggregated meter event found yet'),
          onFailedAttempt: err => {
            console.log(`${err.message} - Attempt ${err.attemptNumber} failed. There are ${err.retriesLeft} retries left.`);
          },
        })
      } catch {
        assert.fail('No aggregated meter event found. Stripe probably did not process the events yet.')
      }
      assert.ok(aggregatedMeterEvent, 'No aggregated meter event found')
      assert.ok(aggregatedMeterEvent.data, 'No aggregated meter event found')
      assert.equal(aggregatedMeterEvent.data.length, 1, 'Expected 1 aggregated meter event')
      // We can't verify the total bytes served because the meter events are not immediately available in stripe
      // and the test would fail intermittently
      assert.ok(aggregatedMeterEvent.data[0].aggregated_value > 0, 'Aggregated value is 0')
    } finally {
      if (stripeCustomerId) {
        // 5. Delete the test customer from stripe
        const deletedCustomer = await ctx.stripe.customers.del(stripeCustomerId)
        assert.ok(deletedCustomer.deleted, 'Error deleting customer from stripe')
      }
    }
  }
}