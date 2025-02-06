import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Delegation from '@ucanto/core/delegation'
import * as Link from 'multiformats/link'
import { base64 } from 'multiformats/bases/base64'
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
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 */
async function pieceCidReport (event) {
  const { indexingServiceDid, indexingServiceUrl } = getEnv()
  const { PRIVATE_KEY: privateKey, INDEXING_SERVICE_PROOF: indexingServiceProof } = Config

  const records = parseDynamoDbEvent(event)
  if (records.length > 1) {
    throw new Error('Should only receive one ferry to update')
  }

  /** @type {PieceStoreRecord} */
  // @ts-expect-error can't figure out type of new
  const storeRecord = unmarshall(records[0].new)
  const record = decodeRecord(storeRecord)

  const connection = getServiceConnection({
    did: indexingServiceDid,
    url: indexingServiceUrl
  })
  const cid = Link.parse(indexingServiceProof, base64)
  const proof = await Delegation.extract(cid.multihash.digest)
  if (!proof.ok) throw new Error('failed to extract proof', { cause: proof.error })

  const context = {
    claimsService: {
      connection,
      invocationConfig: {
        issuer: getServiceSigner({ privateKey }),
        audience: connection.id,
        with: connection.id.did(),
        proofs: [proof.ok]
      },
    },
  }

  const { ok, error } = await storefrontEvents.handlePieceInsertToEquivalencyClaim(context, record)
  if (error) {
    console.error(error)
    return {
      statusCode: 500,
      body: error.message || 'failed to handle piece insert event to content claim'
    }
  }

  return {
    statusCode: 200,
    body: ok
  }
}

export const main = Sentry.AWSLambda.wrapHandler(pieceCidReport)

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    indexingServiceDid: mustGetEnv('INDEXING_SERVICE_DID'),
    indexingServiceUrl: mustGetEnv('INDEXING_SERVICE_URL'),
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