import {
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb'
import { ok, error } from '@ucanto/core'
import * as Link from 'multiformats/link'
import * as Digest from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { EntryNotFound, EntryExists } from '@storacha/upload-api/blob'
import { createConsumerStore } from '@storacha/upload-service-infra-billing/tables/consumer.js'

import { getDynamoClient } from '../../lib/aws/dynamo.js'
import { METRICS_NAMES, SPACE_METRICS_NAMES } from '../constants.js'

/** @import { BlobAPI } from '@storacha/upload-api/types' */

/**
 * @param {string} region
 * @param {string} blobRegistryTableName
 * @param {string} spaceDiffTableName
 * @param {string} consumerTableName
 * @param {{
 *   space: import('../types.js').SpaceMetricsStore
 *   admin: import('../types.js').MetricsStore
 * }} metrics
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {BlobAPI.Registry}
 */
export const createBlobRegistry = (
  region,
  blobRegistryTableName,
  spaceDiffTableName,
  consumerTableName,
  metrics,
  options = {}
) => {
  const dynamoDb = getDynamoClient({ region, endpoint: options.endpoint })
  return useBlobRegistry(
    dynamoDb,
    blobRegistryTableName,
    spaceDiffTableName,
    consumerTableName,
    metrics
  )
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} blobRegistryTableName
 * @param {string} spaceDiffTableName
 * @param {string} consumerTableName
 * @param {{
 *   space: import('../types.js').SpaceMetricsStore
 *   admin: import('../types.js').MetricsStore
 * }} metrics
 * @returns {BlobAPI.Registry}
 */
export const useBlobRegistry = (
  dynamoDb,
  blobRegistryTableName,
  spaceDiffTableName,
  consumerTableName,
  metrics
) => {
  /**
   * @typedef {object} DeltaInfo
   * @property {import('@storacha/upload-api').DID} space - The space DID that changed size
   * @property {string} cause - UCAN invocation that caused the size change.
   * @property {number} delta - The size of the blob.
   * @property {string} receiptAt - The ISO 8601 timestamp indicating when the receipt was created.
   * @property {string} insertedAt - The ISO 8601 timestamp indicating when the entry was inserted.
   */

  const buildSpaceDiffs = async (/** @type DeltaInfo */ deltaInfo) => {
    const consumerStore = createConsumerStore(
      dynamoDb,
      { tableName: consumerTableName }
    )
    const consumerList = await consumerStore.list({ consumer: deltaInfo.space })
    if (consumerList.error) {
      console.error(
        `Error listing consumers for ${deltaInfo.space}: ${consumerList.error}`
      )
      return consumerList
    }

    const diffs = []
    // There should only be one subscription per provider, but in theory you
    // could have multiple providers for the same consumer (space).
    const consumers = /** @type Record<string, any>[] */ (consumerList.ok?.results)
    console.log(`Found ${consumers.length} consumers for space ${deltaInfo.space}`)
    for (const consumer of consumers) {
      diffs.push({
        pk:`${consumer.provider}#${deltaInfo.space}`, 
        sk:`${deltaInfo.receiptAt}#${deltaInfo.cause}`,
        provider: consumer.provider,
        subscription: consumer.subscription,
        ...deltaInfo
      })
    }
    console.log(
      `Total diffs found for space ${deltaInfo.space}: ${diffs.length}`
    )
    return { ok: diffs, error: undefined }
  }

  return {
    /** @type {BlobAPI.Registry['find']} */
    async find(space, digest) {
      const key = getKey(space, digest)
      const cmd = new GetItemCommand({
        TableName: blobRegistryTableName,
        Key: key,
      })

      const response = await dynamoDb.send(cmd)
      if (!response.Item) {
        return error(new EntryNotFound())
      }

      const raw = unmarshall(response.Item)
      return ok({
        blob: {
          digest: Digest.decode(base58btc.decode(raw.digest)),
          size: raw.size,
        },
        cause: Link.parse(raw.cause).toV1(),
        insertedAt: new Date(raw.insertedAt),
      })
    },

    /** @type {BlobAPI.Registry['register']} */
    register: async ({ space, blob, cause }) => {
      /** @type {import('@aws-sdk/client-dynamodb').TransactWriteItem[]} */
      const transactWriteItems = []
      const dateNow = new Date().toISOString()

      const blobItem = {
        space,
        digest: base58btc.encode(blob.digest.bytes),
        size: blob.size,
        cause: cause.toString(),
        insertedAt: dateNow
      }

      transactWriteItems.push({
        Put: {
          TableName: blobRegistryTableName,
          Item: marshall(blobItem, { removeUndefinedValues: true }),
          ConditionExpression:
            'attribute_not_exists(#S) AND attribute_not_exists(#D)',
          ExpressionAttributeNames: { '#S': 'space', '#D': 'digest' }
        }
      })

      console.log(`Processing delta for space ${space}`)

      const spaceDiffResults = await buildSpaceDiffs({
        space,
        cause: cause.toString(),
        delta: blob.size,
        receiptAt: dateNow, // TODO: What exactly is the receipt timestamp? Previously, it was generated when the receipt was sent to the stream.
        insertedAt: dateNow
      })

      try {
        if (spaceDiffResults.error) {
          throw new Error(
            `Error while processing space diffs: ${spaceDiffResults.error}`
          )
        }

        for (const diffItem of spaceDiffResults.ok ?? []) {
          transactWriteItems.push({
            Put: {
              TableName: spaceDiffTableName,
              Item: marshall(diffItem, { removeUndefinedValues: true })
            }
          })
        }

        const transactWriteCommand = new TransactWriteItemsCommand({
          TransactItems: transactWriteItems,
        })

        await dynamoDb.send(transactWriteCommand)
        await Promise.all([
          metrics.space.incrementTotals({
            [SPACE_METRICS_NAMES.BLOB_ADD_TOTAL]: [{ space, value: 1 }],
            [SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL]: [{ space, value: blob.size }]
          }),
          metrics.admin.incrementTotals({
            [METRICS_NAMES.BLOB_ADD_TOTAL]: 1,
            [METRICS_NAMES.BLOB_ADD_SIZE_TOTAL]: blob.size
          })
        ])
      } catch (/** @type {any} */ err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return error(new EntryExists())
        }
        return error(err)
      }
      return ok({})
    },

    /** @type {BlobAPI.Registry['deregister']} */
    async deregister({space, digest, cause}) {
      try {
        /** @type {import('@aws-sdk/client-dynamodb').TransactWriteItem[]} */
        const transactWriteItems = []
        const key = getKey(space, digest)

        const getItemCmd = new GetItemCommand({
          TableName: blobRegistryTableName,
          Key: key
        })

        const itemToDelete = await dynamoDb.send(getItemCmd)

        if (!itemToDelete.Item) {
          throw new Error('Item does not exist!')
        }

        const blob = unmarshall(itemToDelete.Item)
        const blobSize = Number(blob.size)

        transactWriteItems.push({
          Delete: {
            TableName: blobRegistryTableName,
            Key: key,
            ConditionExpression:
              'attribute_exists(#S) AND attribute_exists(#D)',
            ExpressionAttributeNames: { '#S': 'space', '#D': 'digest' }
          }
        })

        console.log(`Processing delta for space ${space}`)

        const dateNow = new Date().toISOString()
        const spaceDiffResults = await buildSpaceDiffs({
          space,
          cause: cause.toString(),
          delta: blobSize,
          receiptAt: dateNow,
          insertedAt: dateNow
        })

        if (spaceDiffResults.error) {
          throw new Error(`Error while processing space diffs: ${spaceDiffResults.error}`)
        }

        for (const diffItem of spaceDiffResults.ok ?? []) {
          transactWriteItems.push({
            Put: {
              TableName: spaceDiffTableName,
              Item: marshall(diffItem, { removeUndefinedValues: true }),
            },
          })
        }

        const transactWriteCommand = new TransactWriteItemsCommand({
          TransactItems: transactWriteItems,
        })

        await dynamoDb.send(transactWriteCommand)
        await Promise.all([
          metrics.space.incrementTotals({
            [SPACE_METRICS_NAMES.BLOB_REMOVE_TOTAL]: [{ space, value: 1 }],
            [SPACE_METRICS_NAMES.BLOB_REMOVE_SIZE_TOTAL]: [{ space, value: blobSize }]
          }),
          metrics.admin.incrementTotals({
            [METRICS_NAMES.BLOB_REMOVE_TOTAL]: 1,
            [METRICS_NAMES.BLOB_REMOVE_SIZE_TOTAL]: blobSize
          })
        ])
        return ok({})
      } catch (/** @type {any} */ err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return error(new EntryNotFound())
        }
        return error(err)
      }
    },

    /** @type {BlobAPI.Registry['entries']} */
    entries: async (space, options = {}) => {
      const exclusiveStartKey = options.cursor
        ? marshall({ space, digest: options.cursor })
        : undefined

      const cmd = new QueryCommand({
        TableName: blobRegistryTableName,
        Limit: options.size || 20,
        KeyConditions: {
          space: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: space }],
          },
        },
        ExclusiveStartKey: exclusiveStartKey,
        AttributesToGet: ['digest', 'size', 'cause', 'insertedAt'],
      })
      const response = await dynamoDb.send(cmd)

      const results =
        response.Items?.map((i) => toEntry(unmarshall(i))) ?? []
      const firstDigest = results[0] ? base58btc.encode(results[0].blob.digest.bytes) : undefined
      // Get cursor of the item where list operation stopped (inclusive).
      // This value can be used to start a new operation to continue listing.
      const lastKey =
        response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const lastDigest = lastKey ? lastKey.digest : undefined

      const before = firstDigest
      const after = lastDigest

      return {
        ok: {
          size: results.length,
          before,
          after,
          cursor: after,
          results,
        }
      }
    },
  }
}

/**
 * Upgrade from the db representation
 *
 * @param {Record<string, any>} item
 * @returns {BlobAPI.Entry}
 */
export const toEntry = ({ digest, size, cause, insertedAt }) => ({
  blob: { digest: Digest.decode(base58btc.decode(digest)), size },
  cause: Link.parse(cause).toV1(),
  insertedAt: new Date(insertedAt),
})

/**
 * @param {import('@storacha/upload-api').DID} space
 * @param {import('@storacha/upload-api').MultihashDigest} digest
 */
const getKey = (space, digest) =>
  marshall({ space, digest: base58btc.encode(digest.bytes) })

/**
 * Wraps a blob registry with one that talks to the legacy allocations table.
 *
 * @deprecated
 * @param {BlobAPI.Registry} registry
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {BlobAPI.Registry}
 */
export const createAllocationTableBlobRegistry = (registry, region, tableName, options = {}) => {
  const dynamoDb = getDynamoClient({ region, endpoint: options.endpoint })
  return useAllocationTableBlobRegistry(registry, dynamoDb, tableName)
}

/**
 * @deprecated
 * @param {BlobAPI.Registry} registry
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {BlobAPI.Registry}
 */
export const useAllocationTableBlobRegistry = (registry, dynamoDb, tableName) => ({
  /** @type {BlobAPI.Registry['find']} */
  async find (space, digest) {
    const key = getAllocationTableKey(space, digest)
    const cmd = new GetItemCommand({
      TableName: tableName,
      Key: key,
    })

    const response = await dynamoDb.send(cmd)
    if (!response.Item) {
      return error(new EntryNotFound())
    }

    const raw = unmarshall(response.Item)
    return ok({
      blob: {
        digest: Digest.decode(base58btc.decode(raw.multihash)),
        size: raw.size
      },
      cause: Link.parse(raw.invocation).toV1(),
      insertedAt: new Date(raw.insertedAt)
    })
  },

  /** @type {BlobAPI.Registry['register']} */
  register: async ({ space, blob, cause }) => {
    const item = {
      space,
      multihash: base58btc.encode(blob.digest.bytes),
      size: blob.size,
      invocation: cause.toString(),
      insertedAt: new Date().toISOString(),
    }
    const cmd = new PutItemCommand({
      TableName: tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(#S) AND attribute_not_exists(#M)',
      ExpressionAttributeNames: { '#S': 'space', '#M': 'multihash' }
    })

    try {
      await dynamoDb.send(cmd)
      return registry.register({ space, blob, cause })
    } catch (/** @type {any} */ err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return error(new EntryExists())
      }
      return error(err)
    }
  },

  /** @type {BlobAPI.Registry['deregister']} */
  async deregister({space, digest, cause}) {
    const key = getAllocationTableKey(space, digest)
    const cmd = new DeleteItemCommand({
      TableName: tableName,
      Key: key,
      ConditionExpression: 'attribute_exists(#S) AND attribute_exists(#M)',
      ExpressionAttributeNames: { '#S': 'space', '#M': 'multihash' },
      ReturnValues: 'ALL_OLD'
    })

    try {
      const res = await dynamoDb.send(cmd)
      if (!res.Attributes) {
        throw new Error('missing return values')
      }
      return registry.deregister({space, digest, cause})
    } catch (/** @type {any} */ err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return error(new EntryNotFound())
      }
      return error(err)
    }
  },

  /** @type {BlobAPI.Registry['entries']} */
  entries: async (space, options = {}) => {
    const exclusiveStartKey = options.cursor
      ? marshall({ space, multihash: options.cursor })
      : undefined

    const cmd = new QueryCommand({
      TableName: tableName,
      Limit: options.size || 20,
      KeyConditions: {
        space: {
          ComparisonOperator: 'EQ',
          AttributeValueList: [{ S: space }],
        },
      },
      ExclusiveStartKey: exclusiveStartKey,
      AttributesToGet: ['multihash', 'size', 'invocation', 'insertedAt'],
    })
    const response = await dynamoDb.send(cmd)

    const results =
      response.Items?.map((i) => allocationToEntry(unmarshall(i))) ?? []
    const firstDigest = results[0] ? base58btc.encode(results[0].blob.digest.bytes) : undefined
    // Get cursor of the item where list operation stopped (inclusive).
    // This value can be used to start a new operation to continue listing.
    const lastKey =
      response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
    const lastDigest = lastKey ? lastKey.multihash : undefined

    const before = firstDigest
    const after = lastDigest

    return {
      ok: {
        size: results.length,
        before,
        after,
        cursor: after,
        results,
      }
    }
  },
})

/**
 * Upgrade from the db representation
 *
 * @param {Record<string, any>} item
 * @returns {BlobAPI.Entry}
 */
export const allocationToEntry = ({ multihash, invocation, size, insertedAt }) => ({
  blob: { digest: Digest.decode(base58btc.decode(multihash)), size },
  cause: invocation ? Link.parse(invocation).toV1() : Link.parse('bafkqaaa'),
  insertedAt: new Date(insertedAt),
})

/**
 * @param {import('@storacha/upload-api').DID} space
 * @param {import('@storacha/upload-api').MultihashDigest} digest
 */
const getAllocationTableKey = (space, digest) =>
  marshall({ space, multihash: base58btc.encode(digest.bytes) })
