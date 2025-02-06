import * as dagJSON from '@ipld/dag-json'

import { createQueueClient } from './client.js'

/**
 * @typedef {import('@storacha/filecoin-api/storefront/api').FilecoinSubmitMessage} FilecoinSubmitMessage
 * @typedef {import('./client.js').ClientEncodedMessage} ClientEncodedMessage
 */

/**
 * @param {FilecoinSubmitMessage} pieceMessage 
 * @returns {ClientEncodedMessage}
 */
const encodeMessage = (pieceMessage) => {
  return {
    MessageBody: dagJSON.stringify(pieceMessage),
  }
}

/**
 * @param {{ 'MessageBody': string }} message 
 * @returns {FilecoinSubmitMessage}
 */
export const decodeMessage = (message) => {
  return dagJSON.parse(message.MessageBody)
}

/**
 * 
 * @param {import('./types.js').QueueConnect | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {object} context
 * @param {string} context.queueUrl
 * @returns {import('@storacha/filecoin-api/storefront/api').FilecoinSubmitQueue}
 */
export function createClient (conf, context) {
  return createQueueClient(conf,
    {
      queueUrl: context.queueUrl,
      encodeMessage
    })
}
