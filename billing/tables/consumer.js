import { createStoreGetterClient, createStoreListerClient } from './client.js'
import { encodeKey, decode, lister } from '../data/consumer.js'

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').ConsumerStore}
 */
export const createConsumerStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStoreListerClient(conf, { tableName, ...lister, indexName: 'consumerV2' })
})
