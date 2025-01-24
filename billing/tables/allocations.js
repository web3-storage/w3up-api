import retry from 'p-retry'
import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, convertToAttr, unmarshall } from '@aws-sdk/util-dynamodb'

import {
  connectTable,
  createStoreGetterClient,
  createStoreListerClient,
} from './client.js'
import { lister, decode, encodeKey } from '../data/allocations.js'
import { StoreOperationFailure } from './lib.js'

/**
 * @type {import('sst/constructs').TableProps}
 */
export const allocationsTableProps = {
  fields: {
    /** Space DID (did:key:...). */
    space: 'string',
    /** Storage provider DID (did:web:...). */
    /** Represents a multihash digest which carries information about the hashing algorithm and an actual hash digest. */
    multihash: 'string',
    cause: 'string',
    /** ISO timestamp we created the invoice. */
    insertedAt: 'string',
    /** Number of bytes that were added to the space. */
    size: 'number',
  },
  primaryIndex: { partitionKey: 'space', sortKey: 'multihash' },
  globalIndexes: {
    'space-insertedAt-index': {
      partitionKey: 'space',
      sortKey: 'insertedAt',
      projection: ['size'],
    },
  },
}

const indexName = 'space-insertedAt-index'

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').AllocationStore}
 */
export const createAllocationStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStoreListerClient(conf, {
    tableName,
    indexName,
    ...lister,
  }),
  listBetween: (space, from, to, options) =>
    listBetweenWithConfig(
      { conf, tableName, indexName, decode: lister.decode },
      { space, from, to, options }
    ),
})

/**
 * Enhancing the 'list' method to support more powerful queries was considered
 * but discarded for now. Such a change would create an implicit dependency
 * between the encoded key output and the context, and also it would be harder to identify and debug
 * potential breaking changes in the future.
 *
 * This method was introduced to address a specific need without impacting the existing
 * functionality of `list`.
 *
 * Additionally, it is used by the 'store' table, which is why it has been exported.
 *
 * @template { object } V
 * @param {{
 * conf: { region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient,
 * tableName: string,
 * indexName: string,
 * decode: import('../lib/api.js').Decoder<import('../types.js').StoreRecord, V> }} listBetweenConfig
 * @param {{
 * space: import('../lib/api.js').ConsumerDID,
 * from: Date,
 * to: Date,
 * options?: import('../lib/api.js').Pageable }} listBetweenParams
 */
export async function listBetweenWithConfig(
  listBetweenConfig,
  listBetweenParams
) {
  const { conf, tableName, indexName, decode } = listBetweenConfig
  const { space, from, to, options } = listBetweenParams
  const client = connectTable(conf)

  /** @type {Record<string, import('@aws-sdk/client-dynamodb').Condition>} */
  const conditions = {
    space: {
      ComparisonOperator: 'EQ',
      AttributeValueList: [convertToAttr(space.toString())],
    },
    insertedAt: {
      ComparisonOperator: 'BETWEEN',
      AttributeValueList: [
        convertToAttr(from.toISOString()),
        convertToAttr(to.toISOString()),
      ],
    },
  }
  const cmd = new QueryCommand({
    TableName: tableName,
    IndexName: indexName,
    Limit: options?.size ?? 100,
    KeyConditions: conditions,
    ExclusiveStartKey: options?.cursor
      ? marshall(JSON.parse(options.cursor))
      : undefined,
  })
  let res
  try {
    res = await retry(
      async () => {
        const res = await client.send(cmd)
        if (res.$metadata.httpStatusCode !== 200) {
          throw new Error(
            `unexpected status listing table content: ${res.$metadata.httpStatusCode}`
          )
        }
        return res
      },
      {
        retries: 3,
        minTimeout: 100,
        onFailedAttempt: console.warn,
      }
    )
  } catch (/** @type {any} */ err) {
    console.error(err)
    return { error: new StoreOperationFailure(err.message, { cause: err }) }
  }

  const results = []
  for (const item of res.Items ?? []) {
    const decoding = decode(unmarshall(item))
    if (decoding.error) return decoding
    results.push(decoding.ok)
  }
  const lastKey = res.LastEvaluatedKey && unmarshall(res.LastEvaluatedKey)
  const cursor = lastKey && JSON.stringify(lastKey)

  return { ok: { cursor, results } }
}
