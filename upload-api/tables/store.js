import {
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { CID } from 'multiformats/cid'
import * as Link from 'multiformats/link'
import { RecordKeyConflict, RecordNotFound } from './lib.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/**
 * @typedef {import('@web3-storage/upload-api').StoreTable} StoreTable
 * @typedef {import('@web3-storage/upload-api').StoreAddInput} StoreAddInput
 * @typedef {import('@web3-storage/upload-api').StoreAddOutput} StoreAddOutput
 * @typedef {import('@storacha/upload-api').StoreListItem} StoreListItem
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @deprecated
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {StoreTable}
 */
export function createStoreTable(region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })

  return useStoreTable(dynamoDb, tableName)
}

/**
 * @deprecated
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {StoreTable}
 */
export function useStoreTable(dynamoDb, tableName) {
  return {
    /**
     * Check if the given link CID is bound to the uploader account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@storacha/upload-api').UnknownLink} link
     * @returns {ReturnType<StoreTable['exists']>}
     */
    exists: async (space, link) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          link: link.toString(),
        }),
        AttributesToGet: ['space'],
      })

      try {
        const response = await dynamoDb.send(cmd)
        return { ok: Boolean(response.Item) }
      } catch {
        return { ok: false }
      }
    },
    /**
     * Bind a link CID to an account
     *
     * @param {StoreAddInput} item
     * @returns {ReturnType<StoreTable['insert']>}
     */
    insert: async ({ space, link, origin, size, invocation }) => {
      const insertedAt = new Date().toISOString()

      const item = {
        space,
        link: link.toString(),
        size,
        origin: origin?.toString(),
        invocation: invocation.toString(),
        insertedAt,
      }

      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(#S) AND attribute_not_exists(#L)',
        ExpressionAttributeNames: { '#S': 'space', '#L': 'link' }
      })

      try {
        await dynamoDb.send(cmd)
      } catch (/** @type {any} */ err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return { error: new RecordKeyConflict() }
        }
        throw err
      }
      return { ok: { link, size, ...(origin && { origin }) } }
    },
    /**
     * Unbinds a link CID to an account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@storacha/upload-api').UnknownLink} link
     * @returns {ReturnType<StoreTable['remove']>}
     */
    remove: async (space, link) => {
      const cmd = new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          link: link.toString(),
        }),
        ConditionExpression: 'attribute_exists(#S) AND attribute_exists(#L)',
        ExpressionAttributeNames: { '#S': 'space', '#L': 'link' },
        ReturnValues: 'ALL_OLD'
      })

      try {
        const res = await dynamoDb.send(cmd)
        if (!res.Attributes) {
          throw new Error('missing return values')
        }

        const raw = unmarshall(res.Attributes)
        return { ok: { size: Number(raw.size) } }
      } catch (/** @type {any} */ err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return { error: new RecordNotFound() }
        }
        throw err
      }
    },
    /**
     * List all CARs bound to an account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@storacha/upload-api').ListOptions} [options]
     * @returns {ReturnType<StoreTable['list']>}
     */
    list: async (space, options = {}) => {
      const exclusiveStartKey = options.cursor
        ? marshall({
            space,
            link: options.cursor,
          })
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
        ScanIndexForward: !options.pre,
        ExclusiveStartKey: exclusiveStartKey,
        AttributesToGet: ['link', 'size', 'origin', 'insertedAt'],
      })
      const response = await dynamoDb.send(cmd)

      const results =
        response.Items?.map((i) => toStoreListResult(unmarshall(i))) ?? []
      const firstLinkCID = results[0] ? results[0].link.toString() : undefined
      // Get cursor of the item where list operation stopped (inclusive).
      // This value can be used to start a new operation to continue listing.
      const lastKey =
        response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const lastLinkCID = lastKey ? lastKey.link : undefined

      const before = options.pre ? lastLinkCID : firstLinkCID
      const after = options.pre ? firstLinkCID : lastLinkCID
      return {
        ok: {
          size: results.length,
          before,
          after,
          cursor: after,
          results: options.pre ? results.reverse() : results,
        }
      }
    },
    /**
     * @param {import('@storacha/upload-api').DID} space
     * @param {import('@storacha/upload-api').UnknownLink} link
     * @returns {ReturnType<StoreTable['get']>}
     */
    async get(space, link) {
      const item = {
        space,
        link: link.toString(),
      }

      const params = {
        TableName: tableName,
        Key: marshall(item),
      }

      const response = await dynamoDb.send(new GetItemCommand(params))
      if (!response.Item) {
        return { error: new RecordNotFound() }
      }

      const raw = unmarshall(response.Item)
      return {
        ok: {
          link: Link.parse(raw.link),
          size: Number(raw.size),
          ...(raw.origin ? { origin: Link.parse(origin) } : {}),
          insertedAt: raw.insertedAt,
        }
      }
    },

    /**
     * Get information about a CID.
     * 
     * @param {import('@storacha/upload-api').UnknownLink} link
     * @returns {ReturnType<StoreTable['inspect']>}
     */
    inspect: async (link) => {
      const response = await dynamoDb.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'cid',
        KeyConditionExpression: "link = :link",
        ExpressionAttributeValues: {
          ':link': { S: link.toString() }
        }
      }))
      return {
        ok: {
          spaces: response.Items ? response.Items.map(
            i => {
              const item = unmarshall(i)
              return ({
                did: item.space,
                insertedAt: item.insertedAt
              })
            }
          ) : []
        }
      }
    }
  }
}

/**
 * Upgrade from the db representation
 *
 * @param {Record<string, any>} item
 * @returns {StoreListItem}
 */
export function toStoreListResult({ link, size, origin, insertedAt }) {
  return {
    link: CID.parse(link),
    size,
    insertedAt,
    ...(origin && {
      origin: CID.parse(origin),
    }),
  }
}
