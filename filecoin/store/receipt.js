import { StoreOperationFailed } from '@storacha/filecoin-api/errors'
import * as Store from '../../upload-api/stores/agent/store.js'
import { getS3Client } from '../../lib/aws/s3.js'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * handled receipts.
 *
 * @param {string} region
 * @param {string} agentIndexBucketName
 * @param {string} agentMessageBucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createReceiptStore(region, agentIndexBucketName, agentMessageBucketName, options = {}) {
  const s3client = getS3Client({
    region,
    ...options,
  })
  return useReceiptStore(s3client, agentIndexBucketName, agentMessageBucketName)
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} agentIndexBucketName
 * @param {string} agentMessageBucketName
 * @returns {import('@storacha/filecoin-api/storefront/api').ReceiptStore}
 */
export const useReceiptStore = (s3client, agentIndexBucketName, agentMessageBucketName) => {
  const store = Store.open({
    connection: { channel: s3client },
    region: typeof s3client.config.region === 'string' ? s3client.config.region : 'us-west-2',
    buckets: {
      index: { name: agentIndexBucketName },
      message: { name: agentMessageBucketName },
    }
  })
  
  return {
    put: async (record) => {
      return {
        error: new StoreOperationFailed('no new receipt should be put by storefront')
      }
    },
    /**
     * @param {import('@ucanto/interface').UnknownLink} taskCid
     */
    get: (taskCid) =>  
      // @ts-expect-error - need to align RecordNotFoundError
      Store.getReceipt(store, taskCid),
    has: async (record) => {
      return {
        error: new StoreOperationFailed('no receipt should checked by storefront')
      }
    }
  }
}
