import {
  PutItemCommand,
  DescribeTableCommand,
  QueryCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb'
import { parseLink } from '@ucanto/core'
import { Failure } from '@ucanto/server'
import { Schema } from '@ucanto/validator'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/**
 * @typedef {import('../types.js').ConsumerTable} ConsumerTable
 * @typedef {import('../types.js').ConsumerInput} ConsumerInput
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createConsumerTable (region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })

  return useConsumerTable(dynamoDb, tableName)
}


export class ConflictError extends Failure {
  /**
   * @param {object} input
   * @param {string} input.message
   */
  constructor({ message }) {
    super(message)
    this.name = 'ConflictError'
  }
}

/**
 * 
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName 
 * @param {import('@ucanto/interface').DID} consumer 
 * @returns {Promise<import('@storacha/upload-api').ProviderDID[]>}
 */
async function getStorageProviders (dynamoDb, tableName, consumer) {
  const cmd = new QueryCommand({
    TableName: tableName,
    IndexName: 'consumer',
    KeyConditions: {
      consumer: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [{ S: consumer }]
      }
    },
    AttributesToGet: ['provider']
  })
  const response = await dynamoDb.send(cmd)
  // TODO: handle pulling the entire list. currently we only support 2 providers so
  // this list should not be longer than the default page size so this is not terribly urgent.
  return response.Items ? response.Items.map(item => {
    const row = unmarshall(item)
    return /** @type {import('@storacha/upload-api').ProviderDID} */ (row.provider)
  }) : []
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {ConsumerTable}
 */
export function useConsumerTable (dynamoDb, tableName) {
  return {
    /**
     * Get a consumer record.
     * 
     * @param {import('@storacha/upload-api').ProviderDID} provider the provider whose records we should query
     * @param {import('@ucanto/interface').DIDKey} consumer the consumer whose record we should return
     */
    get: async (provider, consumer) => {
      const response = await dynamoDb.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'consumerV2',
        KeyConditionExpression: "consumer = :consumer",
        ExpressionAttributeValues: {
          ':consumer': { S: consumer },
        },
        ProjectionExpression: 'provider, subscription, customer'
      }))
      // we may need to worry about pagination in the future if we end up supporting many many subscriptions for a single
      // provider/consumer pair, but I suspect we'll never get there
      const record = response.Items?.map(i => unmarshall(i)).find(i => i.provider === provider)
      return record ? {
        subscription: record.subscription,
        customer: record.customer
      } : null
    },

    /**
     * Get the consumer attached to a given subscription.
     * 
     * @param {import('@storacha/upload-api').ProviderDID} provider 
     * @param {string} subscription 
     * @returns 
     */
    getBySubscription: async (provider, subscription) => {
      const response = await dynamoDb.send(new GetItemCommand({
        TableName: tableName,
        Key: marshall({ provider, subscription })
      }))
      return response.Item ? (
        {
          consumer: unmarshall(response.Item).consumer
        }
      ) : null
    },

    /**
     * Record the fact that a consumer is consuming a provider via a subscription
     *
     * @param {ConsumerInput} item
     * @returns {Promise<{}>}
     */
    add: async ({ consumer, customer, provider, subscription, cause }) => {
      const insertedAt = new Date().toISOString()

      const row = {
        consumer,
        customer,
        provider,
        subscription,
        cause: cause.toString(),
        insertedAt,
      }

      try {
        await dynamoDb.send(new PutItemCommand({
          TableName: tableName,
          Item: marshall(row),
          ConditionExpression: `(attribute_not_exists(subscription) AND attribute_not_exists(provider)) OR ((cause = :cause) AND (consumer = :consumer) AND (provider = :provider) AND (subscription = :subscription))`,
          ExpressionAttributeValues: {
            ':cause': { 'S': row.cause },
            ':consumer': { 'S': row.consumer },
            ':provider': { 'S': row.provider },
            ':subscription': { 'S': row.subscription }
          }
        }))
        return {}
      } catch (error) {
        const error_ = error instanceof Error && error.message === 'The conditional request failed' ? new ConflictError({
          message: `Space ${row.consumer} cannot be provisioned with ${row.subscription} and ${row.provider}: that subscription is already in use`
        }) : error;
        throw error_;
      }
    },

    getStorageProviders: async (consumer) => {
      return getStorageProviders(dynamoDb, tableName, consumer)
    },

    hasStorageProvider: async (consumer) => {
      const providers = await getStorageProviders(dynamoDb, tableName, consumer)
      return providers.length > 0
    },

    /**
     * get number of stored items
     */
    count: async () => {
      const result = await dynamoDb.send(new DescribeTableCommand({
        TableName: tableName
      }))

      return BigInt(result.Table?.ItemCount ?? -1)
    },

    listByCustomer: async customer => {
      const results = []
      /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue>|undefined} */
      let exclusiveStartKey

      while (true) {
        const res = await dynamoDb.send(new QueryCommand({
          TableName: tableName,
          Limit: 1000,
          KeyConditions: {
            customer: {
              ComparisonOperator: 'EQ',
              AttributeValueList: [{ S: customer }],
            },
          },
          IndexName: 'customer',
          ExclusiveStartKey: exclusiveStartKey,
        }))

        results.push(...(res.Items ?? []).map(item => {
          return toConsumerListRecord(unmarshall(item))
        }))

        if (!res.LastEvaluatedKey) break
        exclusiveStartKey = res.LastEvaluatedKey
      }

      return { results }
    },
  }
}

/**
 * @param {Record<string, any>} raw
 * @returns {import('../types.js').ConsumerListRecord}
 */
function toConsumerListRecord ({ consumer, provider, subscription, cause }) {
  return {
    consumer: Schema.did({ method: 'key' }).from(consumer),
    provider: Schema.did({ method: 'web' }).from(provider),
    subscription,
    cause: cause ? parseLink(cause) : undefined
  }
}
