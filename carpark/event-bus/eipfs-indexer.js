import { SendMessageCommand } from '@aws-sdk/client-sqs'
import * as Sentry from '@sentry/serverless'
import { mustGetEnv } from '../../lib/env.js'
import { getSQSClient } from '../../lib/aws/sqs.js'

// https://github.com/elastic-ipfs/indexer-lambda
const SQS_INDEXER_QUEUE_REGION = 'us-west-2'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * @param {import('./source.js').EventBridgeEvent} event 
 * @param {import('@aws-sdk/client-sqs').SQSClient} client
 * @param {string} queueUrl
 */
export async function eipfsHandler(event, client, queueUrl) {
  const message = event?.detail

  if (message.key) {
    const data = `${message.region}/${message.bucketName}/${message.key}`
    const msgCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: data
    })
    await client.send(msgCommand)
  }
}

/**
 * @param {import('./source.js').EventBridgeEvent} event 
 */
async function messageHandler (event) {
  const sqsClient = getSQSClient({
    region: SQS_INDEXER_QUEUE_REGION,
  })

  await eipfsHandler(event, sqsClient, getEnv().EIPFS_INDEXER_SQS_URL)
}

export const handler = Sentry.AWSLambda.wrapHandler(messageHandler)

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    EIPFS_INDEXER_SQS_URL: mustGetEnv('EIPFS_INDEXER_SQS_URL'),
  }
}
