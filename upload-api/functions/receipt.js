import * as Sentry from '@sentry/serverless'
import { parseLink } from '@ucanto/server'

import * as Store from '../stores/agent/store.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})


/**
 * AWS HTTP Gateway handler for GET /receipt.
 *
 * @param {{pathParameters: {taskCid?: string}}} event
 * @param {Store.Options} options
 * 
 */
export async function receiptGet (event, options = implicitContext()) {
  const store = Store.open(options)

  if (!event.pathParameters?.taskCid) {
    return {
      statusCode: 400,
      body: Buffer.from(`no task cid received`).toString('base64'),
    }
  }
  const taskCid = parseLink(event.pathParameters.taskCid)
  const result = await Store.resolve(store, { receipt: taskCid })
  if (result.error) {
    console.log(result.error)
    return {
      statusCode: 404,
      body: Buffer.from(`No receipt for task ${taskCid} is found`).toString('base64')
    }
  }

  const messageRes = await Store.readMessage(store, result.ok.message)
  if (messageRes.error) {
    console.error('failed to read message', result.error)
    return {
      statusCode: 500,
      body: Buffer.from('Failed to read receipt').toString('base64')
    }
  }

  return {
    statusCode: 200,
    body: Buffer.from(messageRes.ok).toString('base64')
  }
}

/**
 * 
 * @returns {Store.Options}
 */
export function implicitContext () {
  const region = process.env.AWS_REGION || 'us-west-2'
  return {
    connection: { address: { region } },
    region,
    buckets: {
      index: { name: mustGetEnv('INVOCATION_BUCKET_NAME') },
      message: { name: mustGetEnv('WORKFLOW_BUCKET_NAME') },
    }
  }
}

export const handler = Sentry.AWSLambda.wrapHandler((event) => receiptGet(event))
