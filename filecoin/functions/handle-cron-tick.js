import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import * as storefrontEvents from '@storacha/filecoin-api/storefront/events'
import * as DID from '@ipld/dag-ucan/did'
import * as Delegation from '@ucanto/core/delegation'
import { fromString } from 'uint8arrays/from-string'

import { createPieceTable } from '../store/piece.js'
import { createTaskStore } from '../store/task.js'
import { createReceiptStore } from '../store/receipt.js'
import { getServiceSigner } from '../service.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

export async function handleCronTick () {
  const { did, pieceTableName, agentMessageBucketName, agentIndexBucketName, aggregatorDid, storefrontProof } = getEnv()
  const { PRIVATE_KEY: privateKey } = Config

  // create context
  let id = getServiceSigner({
    privateKey
  })
  const storefrontServiceProofs = []
  if (storefrontProof) {
    const proof = await Delegation.extract(fromString(storefrontProof, 'base64pad'))
    if (!proof.ok) throw new Error('failed to extract proof', { cause: proof.error })
    storefrontServiceProofs.push(proof.ok)
  } else {
    // if no proofs, we must be using the service private key to sign
    id = id.withDID(DID.parse(did).did())
  }

  const context = {
    id,
    pieceStore: createPieceTable(AWS_REGION, pieceTableName),
    taskStore: createTaskStore(AWS_REGION, agentIndexBucketName, agentMessageBucketName),
    receiptStore: createReceiptStore(AWS_REGION, agentIndexBucketName, agentMessageBucketName),
    aggregatorId: DID.parse(aggregatorDid),
  }

  const { ok, error } = await storefrontEvents.handleCronTick(context)
  if (error) {
    return {
      statusCode: 500,
      body: error.message || 'failed to handle cron tick'
    }
  }

  console.log(`updated: ${ok?.updatedCount}, pending: ${ok?.pendingCount}`)
  return { statusCode: 200 }
}

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    did: mustGetEnv('DID'),
    pieceTableName: mustGetEnv('PIECE_TABLE_NAME'),
    agentMessageBucketName: mustGetEnv('AGENT_MESSAGE_BUCKET_NAME'),
    agentIndexBucketName: mustGetEnv('AGENT_INDEX_BUCKET_NAME'),
    aggregatorDid: mustGetEnv('AGGREGATOR_DID'),
    storefrontProof: process.env.PROOF,
  }
}

export const main = Sentry.AWSLambda.wrapHandler(handleCronTick)
