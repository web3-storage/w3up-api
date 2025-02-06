import {
  TransactWriteItemsCommand,
  UpdateItemCommand
} from '@aws-sdk/client-dynamodb'
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
export function createFilecoinMetricsTable (region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })

  return useFilecoinMetricsTable(dynamoDb, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types.js').FilecoinMetricsStore}
 */
export function useFilecoinMetricsTable (dynamoDb, tableName) {
  return {

    /**
     * Increment total value of the metric by n.
     *
     * @param {string} metricName 
     * @param {number} n 
     */
    incrementTotal: async (metricName, n) => {
      const updateCmd = new UpdateItemCommand({
        TableName: tableName,
        UpdateExpression: `ADD #value :value`,
          ExpressionAttributeNames: {'#value': 'value'},
          ExpressionAttributeValues: {
            ':value': { N: String(n) },
          },
        Key: marshall({
          name: metricName
        })
      })

      await dynamoDb.send(updateCmd)
    },
    /**
     * Increment total values of the given metrics.
     *
     * @param {Record<string, number>} metricsToUpdate
     */
    incrementTotals: async (metricsToUpdate) => {
      const transactItems = Object.entries(metricsToUpdate).map(([name, n]) => ({
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
      
      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    }
  }
}
