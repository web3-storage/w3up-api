import { connectTable, createStoreGetterClient, createStoreListerClient, createStorePutterClient } from './client.js'
import { validate, encode, encodeKey, decode } from '../data/customer.js'
import { UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { StoreOperationFailure } from './lib.js'

/**
 * Stores customer details.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const customerTableProps = {
  fields: {
    /** CID of the UCAN invocation that set it to the current value. */
    cause: 'string',
    /** DID of the user account e.g. `did:mailto:agent`. */
    customer: 'string',
    /**
     * Opaque identifier representing an account in the payment system.
     *
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: 'string',
    /** Unique identifier of the product a.k.a tier. */
    product: 'string',
    /** ISO timestamp record was inserted. */
    insertedAt: 'string',
    /** ISO timestamp record was updated. */
    updatedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer' },
  globalIndexes: {
    account: { partitionKey: 'account', projection: ['customer'] }
  }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').CustomerStore}
 */
export const createCustomerStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStorePutterClient(conf, { tableName, validate, encode }),
  ...createStoreListerClient(conf, {
    tableName,
    encodeKey: () => ({ ok: {} }),
    decode
  }),

  async updateProduct(customer, product) {
    const client = connectTable(conf)
    try {
      const res = await client.send(new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({ customer }),
        UpdateExpression: 'SET product = :product, updatedAt = :updatedAt',
        ExpressionAttributeValues: marshall({
          ':product': product,
          ':updatedAt': new Date().toISOString()
        })
      }))
      if (res.$metadata.httpStatusCode !== 200) {
        throw new Error(`unexpected status putting item to table: ${res.$metadata.httpStatusCode}`)
      }
      return { ok: {} }
    } catch (/** @type {any} */ err) {
      console.error(err)
      return { error: new StoreOperationFailure(err.message) }
    }
  }
})
