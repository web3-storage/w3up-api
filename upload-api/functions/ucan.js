import { Config } from 'sst/node/config'
import * as Sentry from '@sentry/serverless'
import { processUcanLogRequest } from '../ucan-invocation.js'
import * as AgentStore from '../stores/agent.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
async function handlerFn(request) {
  const {
    AGENT_INDEX_BUCKET_NAME: agentIndexBucketName = '',
    AGENT_MESSAGE_BUCKET_NAME: agentMessageBucketName = '',
    UCAN_LOG_STREAM_NAME: streamName = '',
  } = process.env

  const { UCAN_INVOCATION_POST_BASIC_AUTH } = Config

  const agentStore = AgentStore.open({
    store: {
      connection: {
        address: {
          region: AWS_REGION
        },
      },
      region: AWS_REGION,
      buckets: {
        message: { name: agentMessageBucketName },
        index: { name: agentIndexBucketName },
      },
    },
    stream: {
      connection: { address: {} },
      name: streamName,
    },
  })

  try {
    await processUcanLogRequest(request, {
      basicAuth: UCAN_INVOCATION_POST_BASIC_AUTH,
      agentStore
    })
  } catch (/** @type {any} */ error) {
    return {
      statusCode: error.status ?? 500,
      body: Buffer.from(error.message).toString('base64'),
      isBase64Encoded: true,
    }
  }

  return {
    statusCode: 200
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(handlerFn)
