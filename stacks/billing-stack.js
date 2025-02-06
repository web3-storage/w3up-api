import { use, Cron, Queue, Function, Config, Api } from 'sst/constructs'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { Duration } from 'aws-cdk-lib'
import { BillingDbStack } from './billing-db-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { setupSentry, getCustomDomain } from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function BillingStack ({ stack, app }) {
  setupSentry(app, stack)

  const {
    customerTable,
    spaceSnapshotTable,
    spaceDiffTable,
    usageTable,
    egressTrafficTable,
    stripeSecretKey
  } = use(BillingDbStack)
  const { subscriptionTable, consumerTable } = use(UploadDbStack)

  // Lambda that does a billing run for a given space and customer
  const spaceBillingQueueHandler = new Function(stack, 'space-billing-queue-handler', {
    permissions: [spaceSnapshotTable, spaceDiffTable, usageTable],
    handler: 'billing/functions/space-billing-queue.handler',
    timeout: '15 minutes',
    environment: {
      SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
      SPACE_SNAPSHOT_TABLE_NAME: spaceSnapshotTable.tableName,
      USAGE_TABLE_NAME: usageTable.tableName
    }
  })

  // Queue of spaces and customers that need billing
  const spaceBillingDLQ = new Queue(stack, 'space-billing-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  const spaceBillingQueue = new Queue(stack, 'space-billing-queue', {
    consumer: {
      function: spaceBillingQueueHandler,
      deadLetterQueue: spaceBillingDLQ.cdk.queue,
      cdk: { eventSource: { batchSize: 1 } }
    },
    cdk: { queue: { visibilityTimeout: Duration.minutes(15) } }
  })

  // Lambda that does a billing run for a given customer
  const customerBillingQueueHandler = new Function(stack, 'customer-billing-queue-handler', {
    permissions: [subscriptionTable, consumerTable, spaceBillingQueue],
    handler: 'billing/functions/customer-billing-queue.handler',
    timeout: '15 minutes',
    environment: {
      SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
      CONSUMER_TABLE_NAME: consumerTable.tableName,
      SPACE_BILLING_QUEUE_URL: spaceBillingQueue.queueUrl
    }
  })

  // Queue of accounts that need billing
  const customerBillingDLQ = new Queue(stack, 'customer-billing-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  const customerBillingQueue = new Queue(stack, 'customer-billing-queue', {
    consumer: {
      function: customerBillingQueueHandler,
      deadLetterQueue: customerBillingDLQ.cdk.queue,
      cdk: { eventSource: { batchSize: 1 } }
    },
    cdk: { queue: { visibilityTimeout: Duration.minutes(15) } }
  })

  // Lambda that queues account DIDs to be billed
  const billingCronHandler = new Function(stack, 'billing-cron-handler', {
    permissions: [customerTable, customerBillingQueue],
    handler: 'billing/functions/billing-cron.handler',
    timeout: '15 minutes',
    environment: {
      CUSTOMER_TABLE_NAME: customerTable.tableName,
      CUSTOMER_BILLING_QUEUE_URL: customerBillingQueue.queueUrl
    },
    url: true
  })
  const billingCronHandlerURL = billingCronHandler.url ?? ''

  // Cron job to kick off a billing run
  const billingCron = new Cron(stack, 'billing-cron', {
    job: billingCronHandler,
    schedule: 'cron(0 0 28 * ? *)' // https://crontab.guru/#0_0_1_*_*
  })

  // Lambda that sends usage table records to Stripe for invoicing.
  const usageTableHandler = new Function(stack, 'usage-table-handler', {
    permissions: [spaceSnapshotTable, spaceDiffTable],
    handler: 'billing/functions/usage-table.handler',
    timeout: '15 minutes',
    bind: [stripeSecretKey]
  })

  const usageTableDLQ = new Queue(stack, 'usage-table-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  usageTable.addConsumers(stack, {
    usageTableHandler: {
      function: usageTableHandler,
      cdk: {
        eventSource: {
          batchSize: 1,
          startingPosition: StartingPosition.LATEST,
          retryAttempts: 10
        }
      },
      filters: [{ eventName: ['INSERT'] }],
      deadLetterQueue: usageTableDLQ.cdk.queue
    }
  })

  stack.addOutputs({ billingCronHandlerURL })

  // Setup API
  const customDomain = getCustomDomain(stack.stage, process.env.BILLING_HOSTED_ZONE)
  const stripeEndpointSecret = new Config.Secret(stack, 'STRIPE_ENDPOINT_SECRET')

  const api = new Api(stack, 'billing-http-gateway', {
    customDomain,
    defaults: {
      function: {
        permissions: [customerTable],
        bind: [stripeSecretKey, stripeEndpointSecret],
        environment: {
          CUSTOMER_TABLE_NAME: customerTable.tableName
        }
      },
    },
    routes: {
      'POST /stripe': 'billing/functions/stripe.webhook',
    },
    accessLog: {
      format: '{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
    },
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain: customDomain ? `https://${customDomain.domainName}` : 'Set BILLING_HOSTED_ZONE in env to deploy to a custom domain'
  })

  // Lambda that handles egress traffic tracking
  const egressTrafficQueueHandler = new Function(stack, 'egress-traffic-queue-handler', {
    permissions: [customerTable, egressTrafficTable],
    handler: 'billing/functions/egress-traffic-queue.handler',
    timeout: '15 minutes',
    bind: [stripeSecretKey],
    environment: {
      CUSTOMER_TABLE_NAME: customerTable.tableName,
      EGRESS_TRAFFIC_TABLE_NAME: egressTrafficTable.tableName,
      // Billing Meter Event Name for Stripe Test and Production APIs
      STRIPE_BILLING_METER_EVENT_NAME: 'gateway-egress-traffic'
    }
  })

  // Queue for egress traffic tracking
  const egressTrafficDLQ = new Queue(stack, 'egress-traffic-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  const egressTrafficQueue = new Queue(stack, 'egress-traffic-queue', {
    consumer: {
      function: egressTrafficQueueHandler,
      deadLetterQueue: egressTrafficDLQ.cdk.queue,
      cdk: { eventSource: { batchSize: 10 } }
    },
    cdk: { queue: { visibilityTimeout: Duration.minutes(15) } }
  })

  stack.addOutputs({
    EgressTrafficQueueURL: egressTrafficQueue.queueUrl
  })

  return { billingCron, egressTrafficQueue }
}
