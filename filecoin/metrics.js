import * as CAR from '@ucanto/transport/car'
import { CBOR } from '@ucanto/core'
import * as Block from 'multiformats/block'
import { sha256 } from 'multiformats/hashes/sha2'
import { Piece } from '@web3-storage/data-segment'

import { hasOkReceipt } from '@storacha/upload-service-infra-upload-api/utils.js'
import { AGGREGATE_ACCEPT, AGGREGATE_OFFER, METRICS_NAMES } from './constants.js'
import { DecodeBlockOperationError, NotFoundWorkflowError } from './errors.js'

/**
 * @typedef {import('@storacha/capabilities/types').AggregateOffer} AggregateOffer
 * @typedef {import('@storacha/capabilities/types').AggregateAccept} AggregateAccept
 * @typedef {import('@web3-storage/data-segment').PieceLink} PieceLink
 * @typedef {{ capabilities: AggregateOffer[], invocationCid: string }} AggregateOfferInvocation
 * @typedef {{ capabilities: AggregateAccept[], invocationCid: string }} AggregateAcceptInvocation
 * @typedef {{ aggregate: PieceLink, pieces: PieceLink[] }} AggregateOfferInfo
 * @typedef {DecodeBlockOperationError | NotFoundWorkflowError} AggregateOfferGetError
 * @typedef {import('@ucanto/interface').Result<AggregateOfferInfo, AggregateOfferGetError>} AggregateOfferGet
 */

/**
 * Update total metrics for `aggregate/accept` receipts.
 * Metrics:
 * - AGGREGATE_ACCEPT_TOTAL: increment number of `aggregate/accept` success receipts
 * 
 * @param {import('@storacha/upload-service-infra-upload-api/types.js').UcanStreamInvocation[]} ucanInvocations
 * @param {import('./types.js').FilecoinMetricsCtx} ctx
 */
export async function updateAggregateAcceptTotal (ucanInvocations, ctx) {
  const aggregateAcceptInvocations = ucanInvocations
    // timestamp
    .filter(inv => !ctx.startEpochMs || inv.ts > ctx.startEpochMs)
    // invocation cap
    .filter(
      inv => inv.value.att.find(a => a.can === AGGREGATE_ACCEPT) && hasOkReceipt(inv)
    )
  if (!aggregateAcceptInvocations.length) return

  await ctx.filecoinMetricsStore.incrementTotals({
    [METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL]: aggregateAcceptInvocations.length
    // TODO: time needed in receipt https://github.com/storacha/w3up/issues/970
  })
}

/**
 * Update total metrics for `aggregate/offer` receipts.
 * Metrics:
 * - AGGREGATE_OFFER_TOTAL: increment number of `aggregate/offer` success receipts
 * - AGGREGATE_OFFER_PIECES_TOTAL: increment number of pieces included in `aggregate/offer` success receipts
 * - AGGREGATE_OFFER_PIECES_SIZE_TOTAL: increment size of pieces included of `aggregate/offer` success receipts
 *
 * @param {import('@storacha/upload-service-infra-upload-api/types.js').UcanStreamInvocation[]} ucanInvocations
 * @param {import('./types.js').FilecoinAggregateOfferMetricsCtx} ctx
 */
export async function updateAggregateOfferTotal (ucanInvocations, ctx) {
  // Get a Map of workflows that include aggregate offer receipts
  /** @type {Map<string, AggregateOfferInvocation>} */
  const workflowsWithAggregateOffers = getWorkflowsWithReceiptForCapability(ucanInvocations, AGGREGATE_OFFER, ctx)
  console.log(`${workflowsWithAggregateOffers.size} aggregate offer workflows`)
  if (!workflowsWithAggregateOffers.size) return

  // From workflows that include aggregate offer receipts, try to get the block with Pieces included in Aggregate
  const aggregateOfferGets = (await Promise.all(
    Array.from(workflowsWithAggregateOffers.entries()).map(async ([carCid, aggregateOfferInvocation]) => {
      console.log(`getting agent message for task: ${aggregateOfferInvocation.invocationCid}`)
      const agentMessage = await getAgentMessage(aggregateOfferInvocation.invocationCid, ctx)
      if (agentMessage.error) {
        console.error('failed to get agent message', agentMessage.error)
        return [{
          error: agentMessage.error,
          ok: undefined
        }]
      }

      console.log('update aggregate/offer total for worflow', carCid, aggregateOfferInvocation.invocationCid, 'with pieces', aggregateOfferInvocation.capabilities.map(aggregateOfferCap => aggregateOfferCap.nb.pieces.toString()))
      return Promise.all(aggregateOfferInvocation.capabilities.map(aggregateOfferCap => getOfferInfoBlock(aggregateOfferCap, agentMessage.ok)))
    })
  )).flat()
  const aggregateOfferGetError = aggregateOfferGets.find(get => get.error)
  if (aggregateOfferGetError) {
    throw aggregateOfferGetError.error
  }

  /** @type {AggregateOfferInfo[]} */
  // @ts-expect-error ts thinks it may be undefined
  const aggregateOffers = aggregateOfferGets.map(get => get.ok)

  // Increment metrics totals
  await ctx.filecoinMetricsStore.incrementTotals({
    [METRICS_NAMES.AGGREGATE_OFFER_TOTAL]: aggregateOffers.length,
    [METRICS_NAMES.AGGREGATE_OFFER_PIECES_TOTAL]: aggregateOffers.reduce((acc, offer) => {
      const sum = acc + offer.pieces.length
      return sum
    }, 0),
    [METRICS_NAMES.AGGREGATE_OFFER_PIECES_SIZE_TOTAL]: Number(aggregateOffers.reduce((acc, offer) => {
      return acc + offer.pieces.reduce((acc, pieceLink) => {
        return acc + Piece.fromLink(pieceLink).size
      }, 0n)
    }, 0n))
  })
}

/**
 * Get a map of workflows that include given capability.
 *
 * @param {import('@storacha/upload-service-infra-upload-api/types.js').UcanStreamInvocation[]} ucanInvocations
 * @param {string} capability
 * @param {import('./types.js').FilecoinAggregateOfferMetricsCtx} ctx
 */
function getWorkflowsWithReceiptForCapability (ucanInvocations, capability, ctx) {
  return ucanInvocations
  .reduce(
    (acc, workflowInvocations) => {
      // if not in the range of time provided skip it
      if (ctx.startEpochMs && ctx.startEpochMs > workflowInvocations.ts) {
        return acc
      }
      const aggregateOfferReceipts = workflowInvocations.value.att.filter(a => a.can === capability)

      // If no `aggregate/offer` as receipts we can stop
      if (!aggregateOfferReceipts.length || !hasOkReceipt(workflowInvocations)) {
        return acc
      }
      // Annotate `aggregate/offer` invocations in workflow
      const workflowCid = workflowInvocations.carCid
      const invocationCid = workflowInvocations.invocationCid
      acc.set(workflowCid, {
        capabilities: aggregateOfferReceipts,
        invocationCid
      })

      return acc
    },
    (new Map())
  )
}

/**
 * @param {string} taskCid
 * @param {import('./types.js').FilecoinAggregateOfferMetricsCtx} ctx
 */
async function getAgentMessage (taskCid, ctx) {
  // TODO: When we distinct between TaskCid and InvocationCid, we also need to see this mapping.
  const invocationCid = taskCid

  const workflowCid = await ctx.invocationStore.getInLink(invocationCid)
  if (!workflowCid) {
    return {
      error: new NotFoundWorkflowError(`not invocation cid ${workflowCid} for workflow`)
    }
  }
  console.log(`found task: ${taskCid} workflow: ${workflowCid}`)

  const agentMessageBytes = await ctx.workflowStore.get(workflowCid)
  if (!agentMessageBytes) {
    return {
      error: new NotFoundWorkflowError(`not found workflow with CID ${workflowCid}`)
    }
  }

  const agentMessage = await CAR.request.decode({
    body: agentMessageBytes,
    headers: {},
  })

  return {
    ok: agentMessage
  }
}

/**
 * @param {AggregateOffer} aggregateOfferCap
 * @param {import('@ucanto/interface').AgentMessage<any>} agentMessage
 */
async function getOfferInfoBlock (aggregateOfferCap, agentMessage) {
  const blockGet = await findCBORBlock(
    aggregateOfferCap.nb.pieces,
    agentMessage.iterateIPLDBlocks()
  )

  if (blockGet.error) {
    return {
      error: blockGet.error,
      ok: undefined
    }
  }

  return {
    ok: {
      aggregate: aggregateOfferCap.nb.aggregate,
      pieces: blockGet.ok.value
    }
  }
}

/**
 * @param {import('multiformats').Link} cid
 * @param {IterableIterator<import('@ucanto/server').API.Transport.Block<unknown, number, number, 1>>} blocks
 * @returns {Promise<import('@ucanto/server').Result<import('multiformats').BlockView, DecodeBlockOperationError>>}
 */
const findCBORBlock = async (cid, blocks) => {
  let bytes
  for (const b of blocks) {
    if (b.cid.equals(cid)) {
      bytes = b.bytes
    }
  }
  if (!bytes) {
    return {
      error: new DecodeBlockOperationError(`missing block: ${cid.toString()}`),
    }
  }
  return {
    ok: await Block.create({ cid, bytes, codec: CBOR, hasher: sha256 }),
  }
}
