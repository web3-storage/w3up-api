import { createStoreBatchPutterClient, createStoreListerClient } from './client.js'
import { validate, encode, lister, decode } from '../data/space-diff.js'

/**
 * Stores changes to total space size.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const spaceDiffTableProps = {
  fields: {
    /** Composite key with format: "provider#space" */
    pk: 'string',
    /** Composite key with format: "receiptAt#cause" */
    sk: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Storage provider for the space. */
    provider: 'string',
    /** Subscription in use when the size changed. */
    subscription: 'string',
    /** Invocation CID that changed the space size (bafy...). */
    cause: 'string',
    /** Number of bytes added to or removed from the space. */
    delta: 'number',
    /** ISO timestamp the receipt was issued. */
    receiptAt: 'string',
    /** ISO timestamp we recorded the change. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'pk', sortKey: 'sk' }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').SpaceDiffStore}
 */
export const createSpaceDiffStore = (conf, { tableName }) => ({
  ...createStoreBatchPutterClient(conf, { tableName, validate, encode }),
  ...createStoreListerClient(conf, { tableName, encodeKey: lister.encodeKey, decode })
})
