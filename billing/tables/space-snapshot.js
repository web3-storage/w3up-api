import { createStoreGetterClient, createStorePutterClient } from './client.js'
import { validate, encode, decode, encodeKey } from '../data/space-snapshot.js'

/**
 * Stores snapshots of total space size at a given time.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const spaceSnapshotTableProps = {
  fields: {
    /** Composite key with format: "provider#space" */
    pk: 'string',
    /**
     * CSV Space DID and Provider DID.
     *
     * e.g. did:key:z6Mksjp3Mbe7TnQbYK43NECF7TRuDGZu9xdzeLg379Dw66mF,did:web:web3.storage
     */
    space: 'string',
    /** Space storage provider DID. */
    provider: 'string',
    /** Total allocated size in bytes. */
    size: 'number',
    /** ISO timestamp allocation was snapshotted. */
    recordedAt: 'string',
    /** ISO timestamp record was inserted. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'pk', sortKey: 'recordedAt' }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').SpaceSnapshotStore}
 */
export const createSpaceSnapshotStore = (conf, { tableName }) => ({
  ...createStorePutterClient(conf, { tableName, validate, encode }),
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode })
})
