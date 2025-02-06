import { createStoreGetterClient, createStoreListerClient } from './client.js'
import { decode, encodeKey, lister } from '../data/subscription.js'

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').SubscriptionStore}
 */
export const createSubscriptionStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStoreListerClient(conf, { tableName, ...lister, indexName: 'customer' })
})
