import { testConsumerWithBucket as test } from './helpers/context.js'
import { toString } from 'uint8arrays/to-string'
import { fromString } from 'uint8arrays/from-string'
import * as DAGJson from '@ipld/dag-json'

import { CBOR, CAR } from '@ucanto/core'
import * as Signer from '@ucanto/principal/ed25519'
import * as DealerCapabilities from '@storacha/capabilities/filecoin/dealer'
import * as StoreCapabilities from '@storacha/capabilities/store'
import { randomAggregate } from '@storacha/filecoin-api/test'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { Piece } from '@web3-storage/data-segment'

import { updateAggregateOfferTotal } from '../metrics.js'
import { METRICS_NAMES, STREAM_TYPE } from '../constants.js'

import { adminMetricsTableProps } from '@storacha/upload-service-infra-upload-api/tables/index.js'
import { createFilecoinMetricsTable } from '../store/metrics.js'
import { createWorkflowStore } from '../store/workflow.js'
import { createInvocationStore } from '../store/invocation.js'

import {
  createDynamodDb,
  createS3,
  createBucket,
} from './helpers/resources.js'
import { encodeAgentMessage, createSpace } from './helpers/ucanto.js'
import { randomCAR } from './helpers/random.js'
import { createDynamoTable, getItemFromTable} from './helpers/tables.js'

const REGION = 'us-west-2'

/**
 * @typedef {import('@web3-storage/data-segment').PieceLink} PieceLink
 * @typedef {import('@web3-storage/data-segment').AggregateView} AggregateView
 */

test.before(async t => {
  // Dynamo DB
  const {
    client: dynamo,
    endpoint: dbEndpoint
  } = await createDynamodDb({ port: 8000 })
  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo

  // S3
  const { client, clientOpts } = await createS3()
  t.context.s3Client = client
  t.context.s3Opts = clientOpts
})

test('handles a batch of single invocation with aggregate/offer', async t => {
  const { tableName, workflowBucketName, invocationBucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, workflowBucketName, t.context.s3Opts)
  const invocationStore = createInvocationStore(REGION, invocationBucketName, t.context.s3Opts)

  // Generate aggregate for test
  const { pieces, aggregate } = await randomAggregate(100, 128)
  const aggregateOffers = [{ pieces, aggregate }]
  const workflows = [aggregateOffers]

  // Get UCAN Stream Invocations
  const ucanStreamInvocations = await prepareUcanStream(workflows, {
    workflowBucketName,
    invocationBucketName,
    s3: t.context.s3Client
  })

  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    invocationStore,
    filecoinMetricsStore
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_TOTAL)
  t.is(aggregateOfferTotal?.value, aggregateOffers.length)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.truthy(aggregateOfferPiecesTotal)
  t.is(aggregateOfferPiecesTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL)
  t.is(aggregateOfferPiecesTotal?.value, pieces.length)

  const piecesSize = pieces.reduce((acc, p) => {
    return acc + Piece.fromLink(p.link).size
  }, 0n)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.truthy(aggregateOfferPiecesSizeTotal)
  t.is(aggregateOfferPiecesSizeTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL)
  t.is(aggregateOfferPiecesSizeTotal?.value, Number(piecesSize))
})

test('handles a batch of single invocation with multiple aggregate/offer attributes', async t => {
  const { tableName, workflowBucketName, invocationBucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, workflowBucketName, t.context.s3Opts)
  const invocationStore = createInvocationStore(REGION, invocationBucketName, t.context.s3Opts)

  // Generate aggregate for test
  const aggregateOffers = await Promise.all([
    randomAggregate(50, 128),
    randomAggregate(50, 128)
  ])
  const workflows = [aggregateOffers]

  // Get UCAN Stream Invocations
  const ucanStreamInvocations = await prepareUcanStream(workflows, {
    workflowBucketName,
    invocationBucketName,
    s3: t.context.s3Client
  })

  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    invocationStore,
    filecoinMetricsStore
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_TOTAL)
  t.is(aggregateOfferTotal?.value, aggregateOffers.length)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.truthy(aggregateOfferPiecesTotal)
  t.is(aggregateOfferPiecesTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL)
  t.is(aggregateOfferPiecesTotal?.value, aggregateOffers.reduce((acc, ao) => {
    return acc + ao.pieces.length
  }, 0))

  const piecesSize = aggregateOffers.reduce((acc, ao) => {
    return acc + ao.pieces.reduce((acc, p) => {
      return acc + Piece.fromLink(p.link).size
    }, 0n)
  }, 0n)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.truthy(aggregateOfferPiecesSizeTotal)
  t.is(aggregateOfferPiecesSizeTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL)
  t.is(aggregateOfferPiecesSizeTotal?.value, Number(piecesSize))
})

test('handles a batch of multiple invocations with single aggregate/offer attribute', async t => {
  const { tableName, workflowBucketName, invocationBucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, workflowBucketName, t.context.s3Opts)
  const invocationStore = createInvocationStore(REGION, invocationBucketName, t.context.s3Opts)

  // Generate aggregate for test
  const aggregateOffers = await Promise.all([
    randomAggregate(50, 128),
    randomAggregate(50, 128)
  ])
  const workflows = aggregateOffers.map(ao => [ao])

  // Get UCAN Stream Invocations
  const ucanStreamInvocations = await prepareUcanStream(workflows, {
    workflowBucketName,
    invocationBucketName,
    s3: t.context.s3Client
  })

  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    invocationStore,
    filecoinMetricsStore
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_TOTAL)
  t.is(aggregateOfferTotal?.value, aggregateOffers.length)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.truthy(aggregateOfferPiecesTotal)
  t.is(aggregateOfferPiecesTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL)
  t.is(aggregateOfferPiecesTotal?.value, aggregateOffers.reduce((acc, ao) => {
    return acc + ao.pieces.length
  }, 0))

  const piecesSize = aggregateOffers.reduce((acc, ao) => {
    return acc + ao.pieces.reduce((acc, p) => {
      return acc + Piece.fromLink(p.link).size
    }, 0n)
  }, 0n)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.truthy(aggregateOfferPiecesSizeTotal)
  t.is(aggregateOfferPiecesSizeTotal?.name, METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL)
  t.is(aggregateOfferPiecesSizeTotal?.value, Number(piecesSize))
})

test('handles a batch of single invocation without aggregate/offer', async t => {
  const { tableName, workflowBucketName, invocationBucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, workflowBucketName, t.context.s3Opts)
  const invocationStore = createInvocationStore(REGION, invocationBucketName, t.context.s3Opts)

  // Get unrelated invocation
  const uploadService = await Signer.generate()
  const car = await randomCAR(128)
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const ucanStreamInvocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          StoreCapabilities.add.create({
            with: spaceDid,
            nb: {
              link: car.cid,
              size: car.size
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error not expecting type with just `aggregate/offer`
  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    invocationStore,
    filecoinMetricsStore
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.falsy(aggregateOfferTotal)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.falsy(aggregateOfferPiecesTotal)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.falsy(aggregateOfferPiecesSizeTotal)
})

test('skips invocation with aggregate/offer if before start epoch ms', async t => {
  const { tableName, workflowBucketName, invocationBucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, workflowBucketName, t.context.s3Opts)
  const invocationStore = createInvocationStore(REGION, invocationBucketName, t.context.s3Opts)

  // Generate aggregate for test
  const { pieces, aggregate } = await randomAggregate(100, 128)
  const aggregateOffers = [{ pieces, aggregate }]
  const workflows = [aggregateOffers]

  // Get UCAN Stream Invocations
  const ucanStreamInvocations = await prepareUcanStream(workflows, {
    workflowBucketName,
    invocationBucketName,
    s3: t.context.s3Client
  })

  await updateAggregateOfferTotal(ucanStreamInvocations, {
    workflowStore,
    invocationStore,
    filecoinMetricsStore,
    startEpochMs: Date.now() + 100
  })

  // Validate metrics
  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_TOTAL
  })
  t.falsy(aggregateOfferTotal)

  const aggregateOfferPiecesTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL
  })
  t.falsy(aggregateOfferPiecesTotal)

  const aggregateOfferPiecesSizeTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL
  })
  t.falsy(aggregateOfferPiecesSizeTotal)
})

/**
 * @param {{pieces: { link: PieceLink }[], aggregate: AggregateView }[][]} workflows
 * @param {{ workflowBucketName: string, invocationBucketName: string, s3: import('@aws-sdk/client-s3').S3Client }} ctx
 */
async function prepareUcanStream (workflows, ctx) {
  const storageService = await Signer.generate()

  return Promise.all(workflows.map(async aggregateOffers => {
    const invocationsToExecute = await Promise.all(aggregateOffers.map(async agg => {
      const offer = agg.pieces.map((p) => p.link)
      const piecesBlock = await CBOR.write(offer)

      // Create UCAN invocation workflow
      const invocationParameters = {
        aggregate: agg.aggregate.link,
        pieces: piecesBlock.cid,
      }
      const invocation = await DealerCapabilities.aggregateOffer.delegate({
        issuer: storageService,
        audience: storageService,
        with: storageService.did(),
        nb: invocationParameters
      })
      invocation.attach(piecesBlock)

      return {
        invocation,
        params: invocationParameters
      }
    }))

    const request = await encodeAgentMessage({ invocations: invocationsToExecute.map(ie => ie.invocation) })
    const body = new Uint8Array(request.body.buffer)
    // Decode request to get CAR CID
    const decodedCar = CAR.decode(body)
    const agentMessageCarCid = decodedCar.roots[0].cid.toString()

    // Store UCAN invocation workflow
    const putObjectCmd = new PutObjectCommand({
      Key: `${agentMessageCarCid}/${agentMessageCarCid}`,
      Bucket: ctx.workflowBucketName,
      Body: body
    })
    await ctx.s3.send(putObjectCmd)

    // Store UCAN invocations link
    await Promise.all(invocationsToExecute.map(async ie => {
      const putObjectCmd = new PutObjectCommand({
        Key: `${ie.invocation.cid.toString()}/${agentMessageCarCid}.in`,
        Bucket: ctx.invocationBucketName,
        Body: body
      })
      await ctx.s3.send(putObjectCmd)
    }))

    // Create UCAN Stream Invocation
    const streamData = fromString(JSON.stringify({
      carCid: agentMessageCarCid,
      value: {
          att: invocationsToExecute.map(ie => DealerCapabilities.aggregateOffer.create({
            with: storageService.did(),
            nb: ie.params
          })),
          aud: storageService.did(),
          iss: storageService.did()
      },
      invocationCid: invocationsToExecute[0].invocation.cid.toString(),
      type: STREAM_TYPE.RECEIPT,
      out: {
        ok: true
      },
      ts: Date.now()
    }))

    const decoder = new TextDecoder('utf8')
    const b64encoded = btoa(decoder.decode(streamData))
    const b64decoded = fromString(b64encoded, 'base64')
    return DAGJson.parse(toString(b64decoded, 'utf8'))
  }))
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 */
async function prepareResources (dynamoClient, s3Client) {
  const [ tableName, workflowBucketName, invocationBucketName ] = await Promise.all([
    createDynamoTable(dynamoClient, adminMetricsTableProps),
    createBucket(s3Client),
    createBucket(s3Client),
  ])

  return {
    workflowBucketName,
    invocationBucketName,
    tableName
  }
}
