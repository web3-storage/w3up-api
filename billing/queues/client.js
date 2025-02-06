import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import retry from 'p-retry'
import { QueueOperationFailure } from './lib.js'
import { getSQSClient } from '../../lib/aws/sqs.js'

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
 * @param {import('../lib/api.js').Validator<T>} context.validate
 * @param {import('../lib/api.js').Encoder<T, string>} context.encode
 * @returns {import('../lib/api.js').QueueAdder<T>}
 */
export function createQueueAdderClient (conf, context) {
  const client = connectQueue(conf)
  return {
    async add (message) {
      const validation = context.validate(message)
      if (validation.error) return validation

      const encoding = context.encode(message)
      if (encoding.error) return encoding

      const cmd = new SendMessageCommand({
        QueueUrl: context.url.toString(),
        MessageBody: encoding.ok
      })

      try {
        await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status sending message to queue: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new QueueOperationFailure(err.message, { cause: err }) }
      }

      return { ok: {} }
    }
  }
}
