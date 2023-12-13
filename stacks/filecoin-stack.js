import {
  Cron,
  Function,
  Queue,
  use,
} from '@serverless-stack/resources'
import { Duration, aws_events as awsEvents } from 'aws-cdk-lib'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'

import { BusStack } from './bus-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'
import { setupSentry, getEnv, getCdkNames, getCustomDomain, getKinesisEventSourceConfig } from './config.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'
import { Status } from '../filecoin/store/piece.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function FilecoinStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'filecoin'
  })

  const {
    AGGREGATOR_DID,
    AGGREGATOR_URL,
    CONTENT_CLAIMS_DID,
    CONTENT_CLAIMS_URL,
    CONTENT_CLAIMS_PROOF,
    DISABLE_PIECE_CID_COMPUTE,
    UPLOAD_API_DID,
    STOREFRONT_PROOF
  } = getEnv()
  const storefrontCustomDomain = getCustomDomain(stack.stage, process.env.HOSTED_ZONE)

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get carpark reference
  const { carparkBucket } = use(CarparkStack)
  // Get eventBus reference
  const { eventBus } = use(BusStack)
  // Get store table reference
  const { pieceTable, privateKey, contentClaimsPrivateKey, adminMetricsTable } = use(UploadDbStack)
  // Get UCAN store references
  const { workflowBucket, invocationBucket, ucanStream } = use(UcanInvocationStack)

  /**
   * 1st processor queue - filecoin submit
   * On filecoin submit queue messages, validate piece for given content and store it in store.
   */
  // TODO: This will ONLY run when we validate pieces provided by user
  const filecoinSubmitQueueName = getCdkNames('filecoin-submit-queue', stack.stage)
  const filecoinSubmitQueueDLQ = new Queue(stack, `${filecoinSubmitQueueName}-dlq`, {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
   })
  const filecoinSubmitQueue = new Queue(stack, filecoinSubmitQueueName)
  filecoinSubmitQueue.addConsumer(stack, {
    function: {
      handler: 'functions/handle-filecoin-submit-message.main',
      environment : {
        PIECE_TABLE_NAME: pieceTable.tableName,
      },
      permissions: [pieceTable],
    },
    deadLetterQueue: filecoinSubmitQueueDLQ.cdk.queue,
    cdk: {
      eventSource: {
        batchSize: 1
      },
    },
  })

  /**
   * 2nd processor queue - piece offer invocation
   * On piece offer queue message, offer piece for aggregation.
   */
  const pieceOfferQueueName = getCdkNames('piece-offer-queue', stack.stage)
  const pieceOfferQueueDLQ = new Queue(stack, `${pieceOfferQueueName}-dlq`, {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
   })
  const pieceOfferQueue = new Queue(stack, pieceOfferQueueName)
  pieceOfferQueue.addConsumer(stack, {
    function: {
      handler: 'functions/handle-piece-offer-message.main',
      environment: {
        DID: UPLOAD_API_DID,
        AGGREGATOR_DID,
        AGGREGATOR_URL,
        PROOF: STOREFRONT_PROOF,
      },
      bind: [
        privateKey
      ]
    },
    deadLetterQueue: pieceOfferQueueDLQ.cdk.queue,
    cdk: {
      eventSource: {
        batchSize: 1
      },
    },
  })

  /**
   * CRON to track deals pending resolution.
   * On cron tick event, issue `filecoin/accept` receipts for pieces that have a deal.
   */
  const dealTrackCronName = getCdkNames('deal-track-cron', stack.stage)
  new Cron(stack, dealTrackCronName, {
    schedule: 'rate(10 minutes)',
    job: {
      function: {
        handler: 'functions/handle-cron-tick.main',
        environment : {
          DID: UPLOAD_API_DID,
          PIECE_TABLE_NAME: pieceTable.tableName,
          WORKFLOW_BUCKET_NAME: workflowBucket.bucketName,
          INVOCATION_BUCKET_NAME: invocationBucket.bucketName,
          AGGREGATOR_DID,
          PROOF: STOREFRONT_PROOF,
        },
        timeout: '9 minutes',
        bind: [privateKey],
        permissions: [pieceTable, workflowBucket, invocationBucket],
      }
    }
  })

  const pieceTableHandleInserToClaimtDLQ = new Queue(stack, `piece-table-handle-insert-to-claim-dlq`, {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  const pieceTableHandleInserToFilecoinSubmitDLQ = new Queue(stack, `piece-table-handle-insert-to-filecoin-submit-dlq`, {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  const pieceTableHandleStatusUpdateDLQ = new Queue(stack, `piece-table-handle-status-update-dlq`, {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  // piece-cid reporting
  pieceTable.addConsumers(stack, {
    handlePieceInsertToContentClaim: {
      function: {
        handler: 'functions/handle-piece-insert-to-content-claim.main',
        environment: {
          CONTENT_CLAIMS_DID,
          CONTENT_CLAIMS_URL,
          CONTENT_CLAIMS_PROOF,
        },
        timeout: 3 * 60,
        bind: [
          privateKey,
          contentClaimsPrivateKey
        ]
      },
      deadLetterQueue: pieceTableHandleInserToClaimtDLQ.cdk.queue,
      cdk: {
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#filters
        eventSource: {
          batchSize: 1,
          // Start reading at the last untrimmed record in the shard in the system.
          startingPosition: StartingPosition.TRIM_HORIZON,
        },
      },
      filters: [
        {
          eventName: ['INSERT']
        }
      ]
    },
    handlePieceInsertToFilecoinSubmit: {
      function: {
        handler: 'functions/handle-piece-insert-to-filecoin-submit.main',
        environment: {
          DID: UPLOAD_API_DID,
          STOREFRONT_DID: UPLOAD_API_DID,
          STOREFRONT_URL: storefrontCustomDomain?.domainName ? `https://${storefrontCustomDomain?.domainName}` : '',
        },
        timeout: 3 * 60,
        bind: [
          privateKey,
        ]
      },
      deadLetterQueue: pieceTableHandleInserToFilecoinSubmitDLQ.cdk.queue,
      cdk: {
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#filters
        eventSource: {
          batchSize: 1,
          // Start reading at the last untrimmed record in the shard in the system.
          startingPosition: StartingPosition.TRIM_HORIZON,
        },
      },
      filters: [
        {
          eventName: ['INSERT']
        }
      ]
    },
    handlePieceStatusUpdate: {
      function: {
        handler: 'functions/handle-piece-status-update.main',
        environment: {
          DID: UPLOAD_API_DID,
          STOREFRONT_DID: UPLOAD_API_DID,
          STOREFRONT_URL: storefrontCustomDomain?.domainName ? `https://${storefrontCustomDomain?.domainName}` : '',
        },
        timeout: 3 * 60,
        bind: [
          privateKey,
        ]
      },
      deadLetterQueue: pieceTableHandleStatusUpdateDLQ.cdk.queue,
      cdk: {
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#filters
        eventSource: {
          batchSize: 1,
          // Start reading at the last untrimmed record in the shard in the system.
          startingPosition: StartingPosition.TRIM_HORIZON,
        },
      },
      filters: [
        {
          dynamodb: {
            NewImage: {
              stat: {
                N: [`${Status.ACCEPTED}`, `${Status.INVALID}`]
              }
            }
          }
        }
      ]
    }
  })

  // piece-cid compute
  // Shortcut from system that goes directly into submitted status
  const pieceCidComputeHandler = new Function(
    stack,
    'piece-cid-compute-handler',
    {
      environment : {
        PIECE_TABLE_NAME: pieceTable.tableName,
        DID: UPLOAD_API_DID,
        DISABLE_PIECE_CID_COMPUTE
      },
      permissions: [pieceTable, carparkBucket],
      handler: 'functions/piece-cid-compute.handler',
      timeout: 15 * 60,
    },
  )

  const pieceCidComputeQueueDLQ = new Queue(stack, `piece-cid-compute-queue-dlq`, {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
   })
  const pieceCidComputeQueue = new Queue(stack, 'piece-cid-compute-queue', {
    consumer: {
      function: pieceCidComputeHandler,
      deadLetterQueue: pieceCidComputeQueueDLQ.cdk.queue,
      cdk: {
        eventSource: {
          batchSize: 1,
        },
      }
    },
    cdk: {
      queue: {
        // Needs to be set as less or equal than consumer function
        visibilityTimeout: Duration.seconds(15 * 60),
      },
    },
  })

  /** @type {import('@serverless-stack/resources').EventBusQueueTargetProps} */
  const targetPieceCidComputeQueue = {
    type: 'queue',
    queue: pieceCidComputeQueue,
    cdk: {
      target: {
        message: awsEvents.RuleTargetInput.fromObject({
          bucketRegion: awsEvents.EventField.fromPath('$.detail.region'),
          bucketName: awsEvents.EventField.fromPath('$.detail.bucketName'),
          key: awsEvents.EventField.fromPath('$.detail.key')
        }),
      },
    }
  }

  eventBus.addRules(stack, {
    newCarToComputePiece: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT],
      },
      targets: {
        targetPieceCidComputeQueue
      }
    }
  })

  // `aggregate/offer` + `aggregate-accept` metrics
  const metricsAggregateOfferAcceptTotalDLQ = new Queue(stack, 'metrics-aggregate-offer-accept-total-dlq')
  const metricsAggregateOfferAcceptTotalConsumer = new Function(stack, 'metrics-aggregate-offer-accept-total-consumer', {
    environment: {
      METRICS_TABLE_NAME: adminMetricsTable.tableName,
      WORKFLOW_BUCKET_NAME: workflowBucket.bucketName,
      INVOCATION_BUCKET_NAME: invocationBucket.bucketName,
    },
    permissions: [adminMetricsTable, workflowBucket, invocationBucket],
    handler: 'functions/metrics-aggregate-offer-and-accept-total.consumer',
    deadLetterQueue: metricsAggregateOfferAcceptTotalDLQ.cdk.queue,
  })

  ucanStream.addConsumers(stack, {
    metricsAggregateOfferAcceptTotalConsumer: {
      function: metricsAggregateOfferAcceptTotalConsumer,
      cdk: {
        eventSource: {
          ...(getKinesisEventSourceConfig(stack))
        }
      }
    }
  })

  return {
    filecoinSubmitQueue,
    pieceOfferQueue
  }
}
