import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { QueueOperationFailed, EncodeRecordFailed } from '@storacha/filecoin-api/errors'

import { connectQueue } from './index.js'

/**
 * @typedef {Pick<import('@aws-sdk/client-sqs').SendMessageCommandInput, 'MessageBody'|'MessageGroupId'>} ClientEncodedMessage
 */

/**
 * @template Data
 *
 * @param {import('./types.js').QueueConnect | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {object} context
 * @param {string} context.queueUrl
 * @param {(item: Data) => ClientEncodedMessage} context.encodeMessage
 * @returns {import('@storacha/filecoin-api/types').Queue<Data>}
 */
export function createQueueClient (conf, context) {
  const queueClient = connectQueue(conf)
  return {
    add: async (record, options = {}) => {
      /** @type {ClientEncodedMessage} */
      let encodedRecord
      try {
        encodedRecord = context.encodeMessage(record)
      } catch (/** @type {any} */ error) {
        return {
          error: new EncodeRecordFailed(error.message)
        }
      }

      const cmd = new SendMessageCommand({
        QueueUrl: context.queueUrl,
        ...encodedRecord
      })

      let r
      try {
        r = await queueClient.send(cmd)
        if (r.$metadata.httpStatusCode !== 200) {
          throw new Error(`failed sending message to queue with code ${r.$metadata.httpStatusCode}`)
        }
      } catch (/** @type {any} */ error) {
        return {
          error: new QueueOperationFailed(error.message)
        }
      }

      return {
        ok: {}
      }
    }
  }
}
