import { Kinesis } from '@aws-sdk/client-kinesis'
import { NoInvocationFoundForGivenReceiptError } from '../../errors.js'
import * as UTF8 from 'uint8arrays/from-string'
import * as API from '../../types.js'
import * as Store from './store.js'

export { API }

export const defaults = {
  workflow: { type: 'workflow' },
  receipt: { type: 'receipt' },
}

/**
 * @typedef {import('@aws-sdk/client-kinesis').KinesisClientConfig} Address
 * @typedef {Kinesis} Channel
 *
 * @typedef {API.Variant<{
 *   channel: Channel
 *   address: Address
 *   disable: {}
 * }>} Connection
 *
 * @typedef {object} Options
 * @property {Connection} connection
 * @property {string} name
 * @property {{type:string}} [workflow]
 * @property {{type:string}} [receipt]
 *
 * @typedef {object} Stream
 * @property {Channel|null} channel
 * @property {string} name
 * @property {{type:string}} workflow
 * @property {{type:string}} receipt
 */

/**
 * @param {Options} options
 * @returns {Stream}
 */
export const open = ({ connection, name, ...settings }) => ({
  ...settings,
  channel: connection.address
    ? new Kinesis(connection.address)
    : connection.channel ?? null,
  name,
  workflow: { ...defaults.workflow, ...settings.workflow },
  receipt: { ...defaults.receipt, ...settings.receipt },
})

/**
 *
 * @param {object} connection
 * @param {Store.Store} connection.store
 * @param {Stream} connection.stream
 * @param {API.ParsedAgentMessage} message
 * @returns {Promise<API.Result<API.Unit, Error>>}
 */
export const write = async (connection, message) => {
  const { stream } = connection

  try {
    if (stream.channel) {
      await stream.channel.putRecords({
        Records: await assert(message, connection),
        StreamName: connection.stream.name,
      })
    }
    return { ok: {} }
  } catch (cause) {
    return { error: /** @type {Error} */ (cause) }
  }
}

/**
 * Iterates over all invocations and receipts and yields corresponding kinesis
 * records.
 *
 * @param {API.ParsedAgentMessage} message
 * @param {object} connection
 * @param {Store.Store} connection.store
 * @param {Stream} connection.stream
 */
export const assert = async (message, { stream, store }) => {
  /** @param {API.UnknownLink} task */
  const findInvocation = async (task) => {
    // is the invocation in the message?
    for (const member of message.index) {
      if (member.invocation?.task.toString() === task.toString()) {
        return member.invocation.invocation
      }
    }
    // else find in store
    const result = await Store.getInvocation(store, task)
    if ('error' in result) {
      console.error(result.error)
      throw new NoInvocationFoundForGivenReceiptError(
        `missing invocation: ${task}`
      )
    }
    return result.ok
  }

  const records = []
  for (const member of message.index) {
    if (member.invocation) {
      const { task, invocation, message } = member.invocation
      const data = JSON.stringify({
        // This is bad naming but not worth a breaking change
        carCid: message.toString(),
        task: task.toString(),
        value: {
          att: invocation.capabilities,
          aud: invocation.audience.did(),
          iss: invocation.issuer.did(),
          cid: invocation.cid.toString(),
        },
        ts: Date.now(),
        type: stream.workflow.type,
      })

      records.push({
        Data: UTF8.fromString(data),
        PartitionKey: partitionKey(member),
      })
    }

    if (member.receipt) {
      const { task, receipt, message } = member.receipt
      // Prior implementation used to resolve the invocation and include it's
      // details the stream record. If invocation was not found it threw
      // exception which would result in HTTP status 500.

      // 🔬 Need to figure if there are consumers downstream that depend on
      // having invocation details in the stream record and whether we can
      // safely remove it because this additional IO which seems unnecessary.
      const invocation = await findInvocation(task)

      // log any likely JSON serialization errors in the receipt
      // big ints are handled below but worth understand what's
      // happening
      try {
        JSON.stringify(receipt.out)
      } catch (error) {
        console.warn("receipt will not serialize to JSON", "receipt", receipt.out, "error", error)
      }

      const data = JSON.stringify(
        {
          carCid: message.toString(),
          invocationCid: invocation.cid.toString(),
          task: task.toString(),
          value: {
            att: invocation.capabilities,
            aud: invocation.audience.did(),
            iss: invocation.issuer.did(),
            cid: invocation.cid.toString(),
          },
          out: receipt.out,
          ts: Date.now(),
          type: stream.receipt.type,
        },
        (_, value) => (typeof value === 'bigint' ? Number(value) : value)
      )

      records.push({
        Data: UTF8.fromString(data),
        PartitionKey: partitionKey(member),
      })
    }
  }

  return records
}

/**
 * Determines the partition key for the passed record. A partition key is used
 * to group data by shard within a stream.
 * 
 * @see https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
 *
 * If the Kinesis stream is configured with a single shard (the state of things
 * at time of writing) then this only effects stream consumers configured with
 * `parallelizationFactor` > 1 and thus allows for consumers the process the
 * entire stream sequentially as well as in parallel.
 *
 * > ...when using ParallelizationFactor more than one lambda can
 * > process records from the same shard concurrently. The order is
 * > maintained because records with the same partition key will not be
 * > processed concurrently.
 * >
 * > https://stackoverflow.com/questions/71194144/parallelization-factor-aws-kinesis-data-streams-to-lambda
 * 
 * Here we use the task CID as a partition key, which at least orders
 * invocations and receipts by a given task.
 *
 * @param {API.AgentMessageIndexRecord} record
 */
const partitionKey = record =>
  (record.invocation ? record.invocation.task : record.receipt.task).toString()
