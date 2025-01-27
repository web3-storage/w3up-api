import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import retry from 'p-retry'
import { webcrypto } from '@storacha/one-webcrypto'
import { QueueOperationFailure } from './lib.js'
import { getSQSClient } from '../../lib/aws/sqs.js'

/** The maximum size an SQS batch can be. */
export const MAX_BATCH_SIZE = 10

/** @param {{ region: string } | SQSClient} target */
export const connectQueue = target =>
  target instanceof SQSClient
    ? target
    : getSQSClient(target)

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {object} context
 * @param {URL} context.url
 * @param {import('../lib/api.js').Encoder<T, string>} context.encode
 * @returns {import('../lib/api.js').QueueBatchAdder<T>}
 */
export function createQueueBatchAdderClient (conf, context) {
  const client = connectQueue(conf)
  return {
    async batchAdd (messages) {
      /** @type {import('@aws-sdk/client-sqs').SendMessageBatchRequestEntry[]} */
      let entries = []
      for (const message of messages) {
        const encoding = context.encode(message)
        if (encoding.error) return encoding
        entries.push(({ Id: webcrypto.randomUUID(), MessageBody: encoding.ok }))
      }

      try {
        await retry(async () => {
          const cmd = new SendMessageBatchCommand({
            QueueUrl: context.url.toString(),
            Entries: entries
          })
          const res = await client.send(cmd)
          const failures = res.Failed
          if (failures?.length) {
            failures.forEach(f => console.warn(f))
            entries = entries.filter(e => failures.some(f => f.Id === e.Id))
            throw new Error('failures in response')
          }
          return res
        }, { onFailedAttempt: console.warn })
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new QueueOperationFailure(err.message, { cause: err }) }
      }

      return { ok: {} }
    }
  }
}
