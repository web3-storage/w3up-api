import {
  Api,
  Config,
  Function,
  Queue,
  use
} from 'sst/constructs'

import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda'
import { UploadDbStack } from './upload-db-stack.js'
import { BillingDbStack } from './billing-db-stack.js'
import { BillingStack } from './billing-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { FilecoinStack } from './filecoin-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'

import { getCustomDomain, getApiPackageJson, getGitInfo, setupSentry, getEnv, getEventSourceConfig, getServiceURL } from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function UploadApiStack({ stack, app }) {
  // For loading the Storacha logo
  stack.setDefaultFunctionProps({
    nodejs: {
      esbuild: {
        loader: {
          '.svg': 'text',
        }
      }
    }
  });

  const {
    AGGREGATOR_DID,
    INDEXING_SERVICE_DID,
    INDEXING_SERVICE_URL,
  } = getEnv()

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get references to constructs created in other stacks
  const { carparkBucket } = use(CarparkStack)
  const { allocationTable, blobRegistryTable, storeTable, uploadTable, delegationBucket, delegationTable, revocationTable, adminMetricsTable, spaceMetricsTable, consumerTable, subscriptionTable, storageProviderTable, rateLimitTable, pieceTable, privateKey, indexingServiceProof } = use(UploadDbStack)
  const { agentIndexBucket, agentMessageBucket, ucanStream } = use(UcanInvocationStack)
  const { customerTable, spaceDiffTable, spaceSnapshotTable, egressTrafficTable, stripeSecretKey } = use(BillingDbStack)
  const { pieceOfferQueue, filecoinSubmitQueue } = use(FilecoinStack)
  const { egressTrafficQueue } = use(BillingStack)

  // Setup API
  const customDomains = process.env.HOSTED_ZONES?.split(',').map(zone => getCustomDomain(stack.stage, zone))
  const pkg = getApiPackageJson()
  const git = getGitInfo()
  const ucanInvocationPostbasicAuth = new Config.Secret(stack, 'UCAN_INVOCATION_POST_BASIC_AUTH')

  const apis = (customDomains ?? [undefined]).map((customDomain, idx) => {
    const hostedZone = customDomain?.hostedZone
    // the first customDomain will be web3.storage, and we don't want the apiId for that domain to have a second part, see PR of this change for context
    const apiId = [`http-gateway`, idx > 0 ? hostedZone?.replaceAll('.', '_') : '']
      .filter(Boolean)
      .join('-')
    return new Api(stack, apiId, {
      customDomain,
      defaults: {
        function: {
          timeout: '60 seconds',
          permissions: [
            allocationTable, // legacy
            blobRegistryTable,
            storeTable, // legacy
            uploadTable,
            customerTable,
            delegationTable,
            delegationBucket,
            revocationTable,
            consumerTable,
            subscriptionTable,
            rateLimitTable,
            adminMetricsTable,
            spaceMetricsTable,
            pieceTable,
            spaceDiffTable,
            spaceSnapshotTable,
            storageProviderTable,
            egressTrafficTable,
            carparkBucket,
            agentIndexBucket,
            agentMessageBucket,
            ucanStream,
            pieceOfferQueue,
            filecoinSubmitQueue,
            egressTrafficQueue,
          ],
          environment: {
            DID: process.env.UPLOAD_API_DID ?? '',
            AGGREGATOR_DID,
            ALLOCATION_TABLE_NAME: allocationTable.tableName,
            BLOB_REGISTRY_TABLE_NAME: blobRegistryTable.tableName,
            STORE_TABLE_NAME: storeTable.tableName,
            STORE_BUCKET_NAME: carparkBucket.bucketName,
            UPLOAD_TABLE_NAME: uploadTable.tableName,
            CONSUMER_TABLE_NAME: consumerTable.tableName,
            CUSTOMER_TABLE_NAME: customerTable.tableName,
            SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
            SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
            ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
            RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
            DELEGATION_TABLE_NAME: delegationTable.tableName,
            REVOCATION_TABLE_NAME: revocationTable.tableName,
            SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
            SPACE_SNAPSHOT_TABLE_NAME: spaceSnapshotTable.tableName,
            STORAGE_PROVIDER_TABLE_NAME: storageProviderTable.tableName,
            DELEGATION_BUCKET_NAME: delegationBucket.bucketName,
            AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
            AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
            UCAN_LOG_STREAM_NAME: ucanStream.streamName,
            PIECE_TABLE_NAME: pieceTable.tableName,
            PIECE_OFFER_QUEUE_URL: pieceOfferQueue.queueUrl,
            FILECOIN_SUBMIT_QUEUE_URL: filecoinSubmitQueue.queueUrl,
            EGRESS_TRAFFIC_QUEUE_URL: egressTrafficQueue.queueUrl,
            NAME: pkg.name,
            VERSION: pkg.version,
            COMMIT: git.commmit,
            STAGE: stack.stage,
            ACCESS_SERVICE_URL: getServiceURL(stack, customDomain) ?? '',
            UPLOAD_SERVICE_URL: getServiceURL(stack, customDomain) ?? '',
            POSTMARK_TOKEN: process.env.POSTMARK_TOKEN ?? '',
            PROVIDERS: process.env.PROVIDERS ?? '',
            R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
            R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
            R2_REGION: process.env.R2_REGION ?? '',
            R2_CARPARK_BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME ?? '',
            R2_DELEGATION_BUCKET_NAME: process.env.R2_DELEGATION_BUCKET_NAME ?? '',
            R2_ENDPOINT: process.env.R2_ENDPOINT ?? '',
            REQUIRE_PAYMENT_PLAN: process.env.REQUIRE_PAYMENT_PLAN ?? '',
            UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
            STRIPE_PRICING_TABLE_ID: process.env.STRIPE_PRICING_TABLE_ID ?? '',
            STRIPE_FREE_TRIAL_PRICING_TABLE_ID: process.env.STRIPE_FREE_TRIAL_PRICING_TABLE_ID ?? '',
            STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
            DEAL_TRACKER_DID: process.env.DEAL_TRACKER_DID ?? '',
            DEAL_TRACKER_URL: process.env.DEAL_TRACKER_URL ?? '',
            REFERRALS_ENDPOINT: process.env.REFERRALS_ENDPOINT ?? '',
            INDEXING_SERVICE_DID,
            INDEXING_SERVICE_URL,
            HOSTED_ZONE: hostedZone ?? '',
            PRINCIPAL_MAPPING: process.env.PRINCIPAL_MAPPING ?? ''
          },
          bind: [
            privateKey,
            ucanInvocationPostbasicAuth,
            stripeSecretKey,
            indexingServiceProof,
          ]
        }
      },
      routes: {
        'POST /':       'upload-api/functions/ucan-invocation-router.handler',
        'POST /ucan':   'upload-api/functions/ucan.handler',
        'POST /bridge': 'upload-api/functions/bridge.handler',
        'GET /':        'upload-api/functions/get.home',
        'GET /validate-email': 'upload-api/functions/validate-email.preValidateEmail',
        'POST /validate-email': 'upload-api/functions/validate-email.validateEmail',
        'GET /error':   'upload-api/functions/get.error',
        'GET /version': 'upload-api/functions/get.version',
        'GET /metrics': 'upload-api/functions/metrics.handler',
        'GET /receipt/{taskCid}': 'upload-api/functions/receipt.handler',
        'GET /storefront-cron': 'upload-api/functions/storefront-cron.handler',
        // AWS API Gateway does not know trailing slash... and Grafana Agent puts trailing slash
        'GET /metrics/{proxy+}': 'upload-api/functions/metrics.handler',
        'GET /sample': 'upload-api/functions/sample.handler',
      },
      accessLog: {
        format:'{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
      },
      cors: {
        allowHeaders: ['*'],
        allowMethods: ['ANY'],
        allowOrigins: ['*'],
        maxAge: '1 day'
      }
    });
  })

  // UCAN stream metrics for admin and space
  const uploadAdminMetricsDLQ = new Queue(stack, 'upload-admin-metrics-dlq')
  const uploadAdminMetricsConsumer = new Function(stack, 'upload-admin-metrics-consumer', {
    environment: {
      ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
      STORE_BUCKET_NAME: carparkBucket.bucketName,
      ALLOCATION_TABLE_NAME: allocationTable.tableName
    },
    permissions: [adminMetricsTable, carparkBucket, allocationTable],
    handler: 'upload-api/functions/admin-metrics.consumer',
    deadLetterQueue: uploadAdminMetricsDLQ.cdk.queue,
  })

  const uploadSpaceMetricsDLQ = new Queue(stack, 'upload-space-metrics-dlq')
  const uploadSpaceMetricsConsumer = new Function(stack, 'upload-space-metrics-consumer', {
    environment: {
      SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
      STORE_BUCKET_NAME: carparkBucket.bucketName,
      ALLOCATION_TABLE_NAME: allocationTable.tableName
    },
    permissions: [spaceMetricsTable, carparkBucket, allocationTable],
    handler: 'upload-api/functions/space-metrics.consumer',
    deadLetterQueue: uploadSpaceMetricsDLQ.cdk.queue,
  })

  ucanStream.addConsumers(stack, {
    uploadAdminMetricsConsumer: {
      function: uploadAdminMetricsConsumer,
      cdk: {
        eventSource: {
          ...(getEventSourceConfig(stack)),
          batchSize: 25,
          // Override where to begin consuming the stream to latest as we already are reading from this stream
          startingPosition: StartingPosition.LATEST,
          filters: [
            FilterCriteria.filter({
              data: {
                type: FilterRule.isEqual('receipt')
              }
            })
          ]
        }
      }
    },
    uploadSpaceMetricsConsumer: {
      function: uploadSpaceMetricsConsumer,
      cdk: {
        eventSource: {
          ...(getEventSourceConfig(stack)),
          batchSize: 25,
          // Override where to begin consuming the stream to latest as we already are reading from this stream
          startingPosition: StartingPosition.LATEST,
          filters: [
            FilterCriteria.filter({
              data: {
                type: FilterRule.isEqual('receipt')
              }
            })
          ]
        }
      }
    },
  })

  stack.addOutputs({
    ApiEndpoints: JSON.stringify(apis.map(api => api.url)),
    CustomDomains: customDomains
      ? JSON.stringify(customDomains.map(customDomain => `https://${customDomain?.domainName}`))
      : 'Set HOSTED_ZONES in env to deploy to a custom domain',
  })
}
