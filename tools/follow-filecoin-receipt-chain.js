import * as StorefrontCaps from '@storacha/capabilities/filecoin/storefront'

import * as DID from '@ipld/dag-ucan/did'
import { Piece } from '@web3-storage/data-segment'

import { getServiceSigner } from '../filecoin/service.js'
import { createPieceTable } from '../filecoin/store/piece.js'
import { createReceiptStore as createFilecoinReceiptStore } from '../filecoin/store/receipt.js'
import { mustGetEnv } from '../lib/env.js'

export async function followFilecoinReceiptChain () {
  const {
    ENV,
    PIECE_CID,
    PRIVATE_KEY,
  } = getEnv()

  const AWS_REGION = getRegion(ENV)
  const pieceTableName = getPieceTableName(ENV)
  const agentIndexBucketName = getAgentIndexBucketName(ENV)
  const agentMessageBucketName = getAgentMessageBucketName(ENV)
  const did = getDid(ENV)

  let id = getServiceSigner({
    privateKey: PRIVATE_KEY
  })
  id = id.withDID(DID.parse(did).did())
  
  const pieceInfo = Piece.fromString(PIECE_CID)
  const receiptStore = createFilecoinReceiptStore(AWS_REGION, agentIndexBucketName, agentMessageBucketName)
  const pieceStore = createPieceTable(AWS_REGION, pieceTableName)
  
  // Get piece in store
  const getPiece = await pieceStore.get({ piece: pieceInfo.link })
  if (getPiece.error){
    console.error(getPiece.error)
    throw new Error('could not find piece')
  }
  // Check if `filecoin/submit` receipt exists to get to know aggregate where it is included on a deal
  const filecoinSubmitInvocation = await StorefrontCaps.filecoinSubmit
    .invoke({
      issuer: id,
      audience: id,
      with: id.did(),
      nb: {
        piece: pieceInfo.link,
        content: getPiece.ok.content,
      },
      expiration: Infinity,
    })
    .delegate()
  
  console.log('filecoin/submit', filecoinSubmitInvocation.link())
  
  // Get `filecoin/submit` receipt
  const filecoinSubmitReceiptGet = await receiptStore.get(filecoinSubmitInvocation.link())
  if (filecoinSubmitReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', filecoinSubmitReceiptGet.ok.out)
  
  if (!filecoinSubmitReceiptGet.ok.fx.join) throw new Error('receipt without effect')
  console.log('piece/offer', filecoinSubmitReceiptGet.ok.fx.join)
  
  // Get `piece/offer` receipt
  const pieceOfferReceiptGet = await receiptStore.get(filecoinSubmitReceiptGet.ok.fx.join.link())
  if (pieceOfferReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', pieceOfferReceiptGet.ok.out)
  
  if (!pieceOfferReceiptGet.ok.fx.join) throw new Error('receipt without effect')
  console.log('piece/accept', pieceOfferReceiptGet.ok.fx.join)
  
  // Get `piece/accept` receipt
  const pieceAcceptReceiptGet = await receiptStore.get(pieceOfferReceiptGet.ok.fx.join.link())
  if (pieceAcceptReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', pieceOfferReceiptGet.ok.out)
  
  if (!pieceAcceptReceiptGet.ok.fx.join) throw new Error('receipt without effect')
  console.log('aggregate/offer', pieceAcceptReceiptGet.ok.fx.join)
  
  // Get `aggregate/offer` receipt
  const aggregateOfferReceiptGet = await receiptStore.get(pieceAcceptReceiptGet.ok.fx.join.link())
  if (aggregateOfferReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', aggregateOfferReceiptGet.ok.out)
  
  if (!aggregateOfferReceiptGet.ok.fx.join) throw new Error('receipt without effect')
  console.log('aggregate/accept', aggregateOfferReceiptGet.ok.fx.join)
  
  // Get `aggregate/accept` receipt
  const aggregateAcceptReceiptGet = await receiptStore.get(pieceAcceptReceiptGet.ok.fx.join.link())
  if (aggregateAcceptReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', aggregateAcceptReceiptGet.ok.out)
  
  // Get `piece/accept` receipt
  const filecoinAcceptInvocation = await StorefrontCaps.filecoinAccept
    .invoke({
      issuer: id,
      audience: id,
      with: id.did(),
      nb: {
        piece: pieceInfo.link,
        content: getPiece.ok.content,
      },
      expiration: Infinity,
    })
    .delegate()
  
  console.log('filecoin/accept', filecoinAcceptInvocation.link())
  
  const filecoinAcceptReceiptGet = await receiptStore.get(filecoinAcceptInvocation.link())
  if (filecoinAcceptReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', filecoinAcceptReceiptGet.ok.out)
}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    ENV: mustGetEnv('ENV'),
    PIECE_CID: mustGetEnv('PIECE_CID'),
    PRIVATE_KEY: mustGetEnv('PRIVATE_KEY'),
  }
}

/**
 * @param {string} env
 */
function getRegion (env) {
  if (env === 'staging') {
    return 'us-east-2'
  }

  return 'us-west-2'
}

/**
 * @param {string} env
 */
function getPieceTableName (env) {
  if (env === 'staging') {
    return 'staging-w3infra-piece-v2'
  }

  return 'prod-w3infra-piece-v2'
}

/**
 * @param {string} env
 */
function getAgentIndexBucketName (env) {
  if (env === 'staging') {
    return 'invocation-store-staging-0'
  }

  return 'invocation-store-prod-0'
}

/**
 * @param {string} env
 */
function getAgentMessageBucketName (env) {
  if (env === 'staging') {
    return 'workflow-store-staging-0'
  }

  return 'workflow-store-prod-0'
}

/**
 * @param {string} env
 */
function getDid (env) {
  if (env === 'staging') {
    return 'did:web:staging.up.storacha.network'
  }

  return 'did:web:up.storacha.network'
}
