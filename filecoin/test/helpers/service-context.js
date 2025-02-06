import * as CAR from '@ucanto/transport/car'
import pRetry from 'p-retry'
import { PutObjectCommand } from '@aws-sdk/client-s3'

import { createBucket } from './resources.js'
import { createDynamoTable } from './tables.js'
import { encodeAgentMessage } from './ucan.js'

// table props
import { pieceTableProps } from '../../store/index.js'

// store clients
import { usePieceTable as createPieceStoreClient } from '../../store/piece.js'
import { useTaskStore as createTaskStoreClient } from '../../store/task.js'
import { useReceiptStore as createReceiptStoreClient } from '../../store/receipt.js'
import { TestContentStore } from './content-store.js'

// queue clients
import { createClient as createPieceOfferQueueClient } from '../../queue/piece-offer-queue.js'
import { createClient as createFilecoinSubmitQueueClient } from '../../queue/filecoin-submit-queue.js'

/**
 * @param {import('./context.js').DynamoContext & import('./context.js').S3Context} ctx
 */
export async function getStores (ctx) {
  const { dynamoClient, s3Client } = ctx
  const pieceStore = await createDynamoTable(dynamoClient, pieceTableProps)
  const [ invocationBucketName, workflowBucketName ] = await Promise.all([
    createBucket(s3Client),
    createBucket(s3Client),
  ])
  const testContentStore = await TestContentStore.activate()

  return {
    pieceStore: createPieceStoreClient(dynamoClient, pieceStore),
    taskStore: getTaskStoreClient(s3Client, invocationBucketName, workflowBucketName),
    receiptStore: getReceiptStoreClient(s3Client, invocationBucketName, workflowBucketName),
    contentStore: testContentStore.contentStore,
    testContentStore
  }
}

/**
 * @param {import('./context.js').MultipleQueueContext} ctx
 */
export function getQueues (ctx) {
  return {
    filecoinSubmitQueue: createFilecoinSubmitQueueClient(ctx.sqsClient,
      { queueUrl: ctx.queues.filecoinSubmitQueue.queueUrl }
    ),
    pieceOfferQueue: createPieceOfferQueueClient(ctx.sqsClient,
      { queueUrl: ctx.queues.pieceOfferQueue.queueUrl }
    ),
  }
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @returns {import('@storacha/filecoin-api/storefront/api').TaskStore}
 */
function getTaskStoreClient (s3client, invocationBucketName, workflowBucketName) {
  const taskStore = createTaskStoreClient(s3client, invocationBucketName, workflowBucketName)

  return {
    ...taskStore,
    // Custom put for testing
    put: async (record) => {
      const invocations = [record]
      // Compute and store workflow
      const request = await encodeAgentMessage({ invocations })
      const carBytes = new Uint8Array(request.body.buffer)
      const decodedCar = CAR.codec.decode(carBytes)
      const agentMessageCarCid = decodedCar.roots[0].cid.toString()

      const putWorkflowCmd = new PutObjectCommand({
        Bucket: workflowBucketName,
        Key: `${agentMessageCarCid}/${agentMessageCarCid}`,
        Body: carBytes,
      })
      await pRetry(() => s3client.send(putWorkflowCmd))

      // store symlink of invocation
      const putInvocationCmd = new PutObjectCommand({
        Bucket: invocationBucketName,
        Key: `${record.cid.toString()}/${agentMessageCarCid}.in`,
      })
      await pRetry(() => s3client.send(putInvocationCmd))

      return {
        ok: {}
      }
    },
  }
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @returns {import('@storacha/filecoin-api/storefront/api').ReceiptStore}
 */
function getReceiptStoreClient (s3client, invocationBucketName, workflowBucketName) {
  const receiptStore = createReceiptStoreClient(s3client, invocationBucketName, workflowBucketName)

  return {
    ...receiptStore,
    // Custom put for testing
    put: async (record) => {
      const receipts = [record]
      // Compute and store workflow
      const request = await encodeAgentMessage({ receipts })
      const carBytes = new Uint8Array(request.body.buffer)
      const decodedCar = CAR.codec.decode(carBytes)
      const agentMessageCarCid = decodedCar.roots[0].cid.toString()

      const putWorkflowCmd = new PutObjectCommand({
        Bucket: workflowBucketName,
        Key: `${agentMessageCarCid}/${agentMessageCarCid}`,
        Body: carBytes,
      })
      await pRetry(() => s3client.send(putWorkflowCmd))

      // store symlink of receipt
      const putInvocationCmd = new PutObjectCommand({
        Bucket: invocationBucketName,
        Key: `${record.ran.toString()}/${agentMessageCarCid}.out`,
      })
      await pRetry(() => s3client.send(putInvocationCmd))

      return {
        ok: {}
      }
    },
  }
}