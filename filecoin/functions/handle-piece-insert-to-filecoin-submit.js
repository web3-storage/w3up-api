import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Delegation from '@ucanto/core/delegation'
import { fromString } from 'uint8arrays/from-string'
import * as DID from '@ipld/dag-ucan/did'

import * as storefrontEvents from '@storacha/filecoin-api/storefront/events'

import { decodeRecord } from '../store/piece.js'
import { getServiceConnection, getServiceSigner } from '../service.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * @typedef {import('../types.js').PieceStoreRecord} PieceStoreRecord
 */

/**
 * Get EventRecord from the DynamoDB Stream Event triggering the handler.
 *
 * On piece inserted into store, invoke submit to queue piece to be offered for aggregate.
 *
 * @param {import('aws-lambda').DynamoDBStreamEvent} event 
 */
async function handlePieceInsertToFilecoinSubmit (event) {
  // Parse records
  const eventRawRecords = parseDynamoDbEvent(event)
  // if one we should put back in queue
  if (eventRawRecords.length !== 1) {
    return {
      statusCode: 400,
      body: `Expected 1 DynamoDBStreamEvent per invocation but received ${eventRawRecords.length}`
    }
  }

  /** @type {PieceStoreRecord} */
  // @ts-expect-error can't figure out type of new
  const storeRecord = unmarshall(eventRawRecords[0].new)
  const record = decodeRecord(storeRecord)

  // Create context
  const { PRIVATE_KEY: privateKey } = Config
  const { storefrontDid, storefrontUrl, did, storefrontProof } = getEnv()
  let storefrontSigner = getServiceSigner({
    privateKey
  })
  const connection = getServiceConnection({
    did: storefrontDid,
    url: storefrontUrl
  })
  const storefrontServiceProofs = []
  if (storefrontProof) {
    const proof = await Delegation.extract(fromString(storefrontProof, 'base64pad'))
    if (!proof.ok) throw new Error('failed to extract proof', { cause: proof.error })
    storefrontServiceProofs.push(proof.ok)
  } else {
    // if no proofs, we must be using the service private key to sign
    storefrontSigner = storefrontSigner.withDID(DID.parse(did).did())
  }
  const context = {
    storefrontService: {
      connection,
      invocationConfig: {
        issuer: storefrontSigner,
        with: storefrontSigner.did(),
        audience: storefrontSigner,
        proofs: storefrontServiceProofs
      },
    },
  }

  const { ok, error } = await storefrontEvents.handlePieceInsert(context, record)
  if (error) {
    console.error(error)
    return {
      statusCode: 500,
      body: error.message || 'failed to handle piece insert event to filecoin submit'
    }
  }

  return {
    statusCode: 200,
    body: ok
  }
}

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    did: mustGetEnv('DID'),
    storefrontDid: mustGetEnv('STOREFRONT_DID'),
    storefrontUrl: mustGetEnv('STOREFRONT_URL'),
    storefrontProof: process.env.PROOF,
  }
}

/**
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 */
function parseDynamoDbEvent (event) {
  return event.Records.map(r => ({
    new: r.dynamodb?.NewImage,
    old: r.dynamodb?.OldImage
  }))
}

export const main = Sentry.AWSLambda.wrapHandler(handlePieceInsertToFilecoinSubmit)
