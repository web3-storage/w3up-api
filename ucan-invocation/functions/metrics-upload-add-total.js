import * as Sentry from '@sentry/serverless'

import { createMetricsTable } from '../tables/metrics.js'
import { parseKinesisEvent } from '../utils/parse-kinesis-event.js'
import { UPLOAD_ADD, CONTENT_TYPE } from '../constants.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
async function handler(event) {
  const ucanInvocations = parseKinesisEvent(event)

  const {
    TABLE_NAME: tableName = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
  } = process.env

  await updateUploadAddTotal(ucanInvocations, {
    metricsTable: createMetricsTable(AWS_REGION, tableName, {
      endpoint: dbEndpoint
    })
  })
}

/**
 * @param {import('../types').UcanInvocation[]} ucanInvocations
 * @param {import('../types').TotalSizeCtx} ctx
 */
export async function updateUploadAddTotal (ucanInvocations, ctx) {
  const invocationsWithUploadAdd = ucanInvocations.filter(
    inv => inv.value.att.find(a => a.can === UPLOAD_ADD) && inv.type === CONTENT_TYPE.RECEIPT
  ).flatMap(inv => inv.value.att)

  await ctx.metricsTable.incrementUploadAddTotal(invocationsWithUploadAdd)
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)