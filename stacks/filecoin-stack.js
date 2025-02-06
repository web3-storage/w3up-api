import {
  Cron,
  Function,
  Queue,
  use,
} from 'sst/constructs'
import { Duration, aws_events as awsEvents } from 'aws-cdk-lib'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'

import { BusStack } from './bus-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'
import { RoundaboutStack } from './roundabout-stack.js'
import { setupSentry, getEnv, getCdkNames, getCustomDomain, getEventSourceConfig } from './config.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'
import { Status } from '../filecoin/store/piece.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function FilecoinStack({ stack, app }) {
  const {
    AGGREGATOR_DID,
    AGGREGATOR_URL,
    INDEXING_SERVICE_DID,
    INDEXING_SERVICE_URL,
    DISABLE_PIECE_CID_COMPUTE,
    UPLOAD_API_DID,
    STOREFRONT_PROOF,
    START_FILECOIN_METRICS_EPOCH_MS
  } = getEnv()
  const storefrontCustomDomain = getCustomDomain(stack.stage, process.env.HOSTED_ZONES?.split(",")[0])

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get carpark reference
  const { carparkBucket } = use(CarparkStack)
  // Get eventBus reference
  const { eventBus } = use(BusStack)
  // Get store table reference
  const { pieceTable, privateKey, adminMetricsTable, indexingServiceProof } = use(UploadDbStack)
  // Get UCAN store references
  const { agentMessageBucket, agentIndexBucket, ucanStream } = use(UcanInvocationStack)
  const { roundaboutApiUrl } = use(RoundaboutStack)

  /**
   * 1st processor queue - filecoin submit
   * On filecoin submit queue messages, validate piece for given content and store it in store.
   */
  const filecoinSubmitQueueName = getCdkNames('filecoin-submit-queue', stack.stage)
  const filecoinSubmitQueueDLQ = new Queue(stack, `${filecoinSubmitQueueName}-dlq`, {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
   })
  const filecoinSubmitQueue = new Queue(stack, filecoinSubmitQueueName, {
    cdk: {
      queue: {
        visibilityTimeout: Duration.seconds(15 * 60)
      }
    }
  })
  filecoinSubmitQueue.addConsumer(stack, {
    function: {
      handler: 'filecoin/functions/handle-filecoin-submit-message.main',
      environment : {
        PIECE_TABLE_NAME: pieceTable.tableName,
        CONTENT_STORE_HTTP_ENDPOINT: roundaboutApiUrl
      },
      permissions: [pieceTable],
      // piece is computed in this lambda
      timeout: 15 * 60,
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
      handler: 'filecoin/functions/handle-piece-offer-message.main',
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
    schedule: 'rate(6 minutes)',
    job: {
      function: {
        handler: 'filecoin/functions/handle-cron-tick.main',
        environment : {
          DID: UPLOAD_API_DID,
          PIECE_TABLE_NAME: pieceTable.tableName,
          AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
          AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
          AGGREGATOR_DID,
          PROOF: STOREFRONT_PROOF,
        },
        timeout: '6 minutes',
        bind: [privateKey],
        permissions: [pieceTable, agentMessageBucket, agentIndexBucket],
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
        handler: 'filecoin/functions/handle-piece-insert-to-content-claim.main',
        environment: {
          INDEXING_SERVICE_DID,
          INDEXING_SERVICE_URL,
        },
        timeout: 3 * 60,
        bind: [
          privateKey,
          indexingServiceProof
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
        handler: 'filecoin/functions/handle-piece-insert-to-filecoin-submit.main',
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
        handler: 'filecoin/functions/handle-piece-status-update.main',
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
  // Shortcut from system that offers piece anyway on bucket event
  const pieceCidComputeHandler = new Function(
    stack,
    'piece-cid-compute-handler',
    {
      environment : {
        DISABLE_PIECE_CID_COMPUTE,
        DID: UPLOAD_API_DID,
        STOREFRONT_DID: UPLOAD_API_DID,
        STOREFRONT_URL: storefrontCustomDomain?.domainName ? `https://${storefrontCustomDomain?.domainName}` : '',
      },
      bind: [
        privateKey
      ],
      permissions: [pieceTable, carparkBucket],
      timeout: '5 minutes',
      handler: 'filecoin/functions/piece-cid-compute.handler',
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

  /** @type {import('sst/constructs').EventBusQueueTargetProps} */
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
  const metricsAggregateTotalDLQ = new Queue(stack, 'metrics-aggregate-total-dlq')
  const metricsAggregateTotalConsumer = new Function(stack, 'metrics-aggregate-total-consumer', {
    environment: {
      METRICS_TABLE_NAME: adminMetricsTable.tableName,
      AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
      AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
      START_FILECOIN_METRICS_EPOCH_MS
    },
    permissions: [adminMetricsTable, agentMessageBucket, agentIndexBucket],
    handler: 'filecoin/functions/metrics-aggregate-offer-and-accept-total.consumer',
    deadLetterQueue: metricsAggregateTotalDLQ.cdk.queue,
    timeout: 3 * 60,
  })

  ucanStream.addConsumers(stack, {
    metricsAggregateTotalConsumer: {
      function: metricsAggregateTotalConsumer,
      cdk: {
        eventSource: {
          ...(getEventSourceConfig(stack))
        }
      }
    }
  })

  return {
    filecoinSubmitQueue,
    pieceOfferQueue
  }
}
