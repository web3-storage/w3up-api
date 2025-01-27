import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { convertToAttr, unmarshall } from '@aws-sdk/util-dynamodb'
import { Failure } from '@ucanto/server'
import { connectTable } from '../../tables/client.js'

/**
 * @template {object} K
 * @template V
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../../lib/api.js').Encoder<K, import('../../types.js').StoreRecord>} context.encodeKey
 * @param {import('../lib/api.js').Decoder<import('../../types.js').StoreRecord, V>} context.decode
 * @returns {import('../lib/api.js').StoreLister<K, V>}
 */
export const createStoreListerClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    list: async (key) => {
      const encoding = context.encodeKey(key)
      if (encoding.error) return encoding

      /** @type {Record<string, import('@aws-sdk/client-dynamodb').Condition>|undefined} */
      let conditions
      for (const [k, v] of Object.entries(encoding.ok)) {
        conditions = conditions ?? {}
        conditions[k] = {
          // Multiple conditions imply a sort key so must be GE in order to
          // list more than one item. Otherwise this would be a StoreGetter.
          ComparisonOperator: Object.keys(conditions).length ? 'GE' : 'EQ',
          AttributeValueList: [convertToAttr(v)]
        }
      }

      const cmd = new QueryCommand({
        TableName: context.tableName,
        Limit: 1000,
        KeyConditions: conditions
      })

      let res
      try {
        res = await client.send(cmd)
        if (res.$metadata.httpStatusCode !== 200) {
          throw new Error(`unexpected status listing table content: ${res.$metadata.httpStatusCode}`)
        }
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message, { cause: err }) }
      }
  
      const results = []
      for (const item of res.Items ?? []) {
        const decoding = context.decode(unmarshall(item))
        if (decoding.error) return decoding
        results.push(decoding.ok)
      }
  
      return { ok: { results } }
    }
  }
}

class StoreOperationFailure extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor (message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('StoreOperationFailure')
    this.detail = message
  }

  describe () {
    return `store operation failed: ${this.detail}`
  }
}
