import * as Sentry from '@sentry/serverless'
import { parseLink } from '@ucanto/server'

import * as Store from '../stores/agent/store.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
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
  const url = Store.toMessageURL(store, result.ok.message)

  // redirect to bucket
  return {
    statusCode: 302,
    headers: {
      Location: url.href
    }
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
      index: { name: mustGetEnv('AGENT_INDEX_BUCKET_NAME') },
      message: { name: mustGetEnv('AGENT_MESSAGE_BUCKET_NAME') },
    }
  }
}

export const handler = Sentry.AWSLambda.wrapHandler((event) => receiptGet(event))
