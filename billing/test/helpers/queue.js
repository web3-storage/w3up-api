import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import retry from 'p-retry'
import { QueueOperationFailure } from '../../queues/lib.js'
import { Failure } from '@ucanto/server'

/**
 * @template T
 * @param {import('../lib/api.js').QueueRemover<T>} q
 */
export const collectQueueMessages = async q => {
  /** @type {T[]} */
  const messages = []
  while (true) {
    const res = await q.remove()
    if (res.error) {
      if (res.error.name === 'EndOfQueue') break
      return res
    }
    messages.push(res.ok)
  }
  return { ok: messages }
}

/** @param {{ region: string } | SQSClient} target */
export const connectQueue = target =>
  target instanceof SQSClient
    ? target
    : new SQSClient(target)

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {object} context
 * @param {URL} context.url
 * @param {import('../../lib/api.js').Decoder<string, T>} context.decode
 * @returns {import('../lib/api.js').QueueRemover<T>}
 */
export function createQueueRemoverClient (conf, context) {
  const client = connectQueue(conf)
  return {
    async remove () {
      let res
      try {
        const cmd = new ReceiveMessageCommand({
          QueueUrl: context.url.toString(),
          MaxNumberOfMessages: 1
        })

        res = await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status receiving message from queue: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })

        if (!res.Messages || !res.Messages.length) {
          return { error: new EndOfQueue() }
        }
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new QueueOperationFailure(err.message) }
      }

      const message = res.Messages[0]
      const decoded = context.decode(message.Body || '')
      if (decoded.error) return decoded

      try {
        await retry(async () => {
          const cmd = new DeleteMessageCommand({
            QueueUrl: context.url.toString(),
            ReceiptHandle: message.ReceiptHandle
          })
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status deleting message from queue: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new QueueOperationFailure(err.message) }
      }

      return { ok: decoded.ok }
    }
  }
}

export class EndOfQueue extends Failure {
  constructor () {
    super()
    this.name = /** @type {const} */ ('EndOfQueue')
  }

  describe () {
    return 'end of queue'
  }
}
