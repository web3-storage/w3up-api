import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/**
 * Abstraction layer to handle operations on metrics table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createMetricsTable (region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })

  return useMetricsTable(dynamoDb, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types.js').SpaceMetricsStore}
 */
export function useMetricsTable (dynamoDb, tableName) {
  return {
    /**
     * Increment total values of the given metrics.
     *
     * @param {Record<string, import('../types.js').SpaceMetricsItem[]>} metricsToUpdate
     */
    incrementTotals: async (metricsToUpdate) => {
      const transactItems = Object.entries(metricsToUpdate).map(([name, items]) => items.map((item) => ({
        Update: {
          TableName: tableName,
          UpdateExpression: `ADD #value :value`,
            ExpressionAttributeNames: {'#value': 'value'},
            ExpressionAttributeValues: {
              ':value': { N: String(item.value) },
            },
          Key: marshall({
            name,
            space: item.space
          })
        }
      }))).flat()

      if (!transactItems.length) {
        return
      }

      // Fail if we try more items into the transaction than dynamoDB supports.
      // Is unlikely given each workflow will typically have one invocation, and our kinesis consumers
      // are configured for a batch of 10, while max transact write items is 100.
      // In the unlikely case of failure, Kinesis consumer is configured with `bisectBatchOnError`, which
      // will break the batch into smaller units and retries.
      if (transactItems.length >= MAX_TRANSACT_WRITE_ITEMS) {
        throw new Error(`attempted ${transactItems.length} transactions for a hard limit of ${MAX_TRANSACT_WRITE_ITEMS}`)
      }
      
      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    }
  }
}

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/classes/transactwriteitemscommand.html
export const MAX_TRANSACT_WRITE_ITEMS = 100
