import * as Sentry from '@sentry/serverless'
import { toString } from 'uint8arrays/to-string'
import { fromString } from 'uint8arrays/from-string'
import * as DAGJson from '@ipld/dag-json'

import { updateSpaceMetrics } from '../metrics.js'
import { createMetricsTable } from '../stores/space-metrics.js'
import { createCarStore } from '../buckets/car-store.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
async function handler(event) {
  const ucanInvocations = parseKinesisEvent(event)
  const {
    metricsTableName,
    storeBucketName,
  } = getLambdaEnv()

  await updateSpaceMetrics(ucanInvocations, {
    metricsStore: createMetricsTable(AWS_REGION, metricsTableName),
    carStore: createCarStore(AWS_REGION, storeBucketName),
  })
}

function getLambdaEnv () {
  return {
    storeBucketName: mustGetEnv('STORE_BUCKET_NAME'),
    metricsTableName: mustGetEnv('SPACE_METRICS_TABLE_NAME'),
  }
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
function parseKinesisEvent (event) {
  const batch = event.Records.map(r => fromString(r.kinesis.data, 'base64'))
  return batch.map(b => DAGJson.parse(toString(b, 'utf8')))
}
