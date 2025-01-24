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
 * @returns {import('../types.js').MetricsStore}
 */
export function useMetricsTable (dynamoDb, tableName) {
  return {
    /**
     * Increment total values of the given metrics.
     *
     * @param {Record<string, number>} metricsToUpdate
     */
    incrementTotals: async (metricsToUpdate) => {
      const transactItems = Object.entries(metricsToUpdate)
        // no need to update items without changes
        .filter(([_, n]) => n > 0)
        .map(([name, n]) => ({
          Update: {
            TableName: tableName,
            UpdateExpression: `ADD #value :value`,
              ExpressionAttributeNames: {'#value': 'value'},
              ExpressionAttributeValues: {
                ':value': { N: String(n) },
              },
            Key: marshall({
              name
            })
          }
        }))

      if (!transactItems.length) {
        return
      }
      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    }
  }
}
