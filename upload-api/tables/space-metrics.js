import { getDynamoClient } from '../../lib/aws/dynamo.js'


/**
 * Abstraction layer to handle operations on space metrics Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createSpaceMetricsTable(region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint
  })

  return useSpaceMetricsTable(dynamoDb, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types.js').SpaceMetricsTable}
 */
export function useSpaceMetricsTable(dynamoDb, tableName) {
  return {
    /**
     * Return the total amount of of storage a space has used.
     * 
     * @param {import('@ucanto/interface').DIDKey} consumer the space whose current allocation we should return
     */
    getAllocated: async (consumer) => {
      // FIXME: this broke when we transitioned to the blob protocol. Arguably
      // it was broken before since it does not take into account removals.
      //
      // AFAIK the value is unused - we use `usage/report` capability for this
      // information instead.
      //
      // const response = await dynamoDb.send(new GetItemCommand({
      //   TableName: tableName,
      //   Key: marshall({
      //     space: consumer,
      //     name:  METRICS_NAMES.STORE_ADD_SIZE_TOTAL
      //   })
      // }))
      // return response.Item ? unmarshall(response.Item).value : 0
      return 0
    }
  }
}
