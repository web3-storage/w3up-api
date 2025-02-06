import { createStorePutterClient } from './client.js'
import { validate, encode } from '../data/usage.js'

/**
 * Stores per space usage across billing periods.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const usageTableProps = {
  fields: {
    /** Composite key with format: "from#provider#space" */
    sk: 'string',
    /** Customer DID (did:mailto:...). */
    customer: 'string',
    /**
     * Opaque identifier representing an account in the payment system.
     * 
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: 'string',
    /** Unique identifier of the product a.k.a tier. */
    product: 'string',
    /** Storage provider DID (did:web:...). */
    provider: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Usage in GB/month */
    usage: 'number',
    /** ISO timestamp the usage period spans from (inclusive). */
    from: 'string',
    /** ISO timestamp the usage period spans to (exclusive). */
    to: 'string',
    /** ISO timestamp we created the invoice. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer', sortKey: 'sk' }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').UsageStore}
 */
export const createUsageStore = (conf, { tableName }) =>
  createStorePutterClient(conf, { tableName, validate, encode })
