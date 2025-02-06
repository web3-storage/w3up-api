import { BatchWriteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall, convertToAttr } from '@aws-sdk/util-dynamodb'
import retry from 'p-retry'
import { InsufficientRecords, RecordNotFound, StoreOperationFailure } from './lib.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/** @param {{ region: string } | DynamoDBClient} target */
export const connectTable = target =>
  target instanceof DynamoDBClient
    ? target
    : getDynamoClient(target)

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../lib/api.js').Validator<T>} context.validate
 * @param {import('../lib/api.js').Encoder<T, import('../types.js').StoreRecord>} context.encode
 * @returns {import('../lib/api.js').StorePutter<T>}
 */
export const createStorePutterClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    put: async (record) => {
      const validation = context.validate(record)
      if (validation.error) return validation

      const encoding = context.encode(validation.ok)
      if (encoding.error) return encoding

      const cmd = new PutItemCommand({
        TableName: context.tableName,
        Item: marshall(encoding.ok, { removeUndefinedValues: true })
      })

      try {
        await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status putting item to table: ${res.$metadata.httpStatusCode}`)
          }
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
        return { ok: {} }
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message, { cause: err }) }
      }
    }
  }
}

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../lib/api.js').Validator<T>} context.validate
 * @param {import('../lib/api.js').Encoder<T, import('../types.js').StoreRecord>} context.encode
 * @returns {import('../lib/api.js').StoreBatchPutter<T>}
 */
export const createStoreBatchPutterClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    batchPut: async (records) => {
      /** @type {import('@aws-sdk/client-dynamodb').WriteRequest[]} */
      const writeRequests = []
      for (const record of records) {
        const validation = context.validate(record)
        if (validation.error) return validation

        const encoding = context.encode(record)
        if (encoding.error) return encoding
        writeRequests.push(({ PutRequest: { Item: marshall(encoding.ok, { removeUndefinedValues: true }) } }))
      }

      if (!writeRequests.length) {
        return { error: new InsufficientRecords('records must have length greater than or equal to 1') }
      }

      try {
        let requestItems = { [context.tableName]: writeRequests }
        await retry(async () => {
          const cmd = new BatchWriteItemCommand({ RequestItems: requestItems })
          const res = await client.send(cmd)
          if (res.UnprocessedItems && Object.keys(res.UnprocessedItems).length) {
            requestItems = res.UnprocessedItems
            throw new Error('unprocessed items')
          }
        }, { onFailedAttempt: console.warn })
        return { ok: {} }
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message, { cause: err }) }
      }
    }
  }
}

/**
 * @template {object} K
 * @template V
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../lib/api.js').Encoder<K, import('../types.js').StoreRecord>} context.encodeKey
 * @param {import('../lib/api.js').Decoder<import('../types.js').StoreRecord, V>} context.decode
 * @returns {import('../lib/api.js').StoreGetter<K, V>}
 */
export const createStoreGetterClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    get: async (key) => {
      const encoding = context.encodeKey(key)
      if (encoding.error) return encoding

      const cmd = new GetItemCommand({
        TableName: context.tableName,
        Key: marshall(encoding.ok)
      })

      let res
      try {
        res = await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status getting item from table: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message, { cause: err }) }
      }

      if (!res.Item) {
        return { error: new RecordNotFound(key) }
      }

      return context.decode(unmarshall(res.Item))
    }
  }
}

/**
 * @template {object} K
 * @template V
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {import('../lib/api.js').CreateStoreListerContext<K,V>} context
 * @returns {import('../lib/api.js').StoreLister<K, V>}
 */
export const createStoreListerClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    list: async (key, options) => {
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

      const cmd = conditions
        ? new QueryCommand({
          TableName: context.tableName,
          IndexName: context.indexName,
          Limit: options?.size ?? 100,
          KeyConditions: conditions,
          ExclusiveStartKey: options?.cursor
            ? marshall(JSON.parse(options.cursor))
            : undefined
        })
        : new ScanCommand({
          TableName: context.tableName,
          Limit: options?.size ?? 100,
          ExclusiveStartKey: options?.cursor
            ? marshall(JSON.parse(options.cursor))
            : undefined
        })

      let res
      try {
        res = await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status listing table content: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
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
      const lastKey = res.LastEvaluatedKey && unmarshall(res.LastEvaluatedKey)
      const cursor = lastKey && JSON.stringify(lastKey)
  
      return { ok: { cursor, results } }
    }
  }
}
