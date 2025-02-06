import { parseLink } from '@ucanto/core'
import * as Store from '../../upload-api/stores/agent/store.js'
import { getS3Client } from '../../lib/aws/s3.js'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * invocation receipts and indexes.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {Partial<import('../../lib/aws/s3.js').Address>} [options]
 */
export function createInvocationStore(region, bucketName, options = {}) {
  const s3client = getS3Client({
    region,
    ...options,
  })
  return useInvocationStore(s3client, bucketName)
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} bucketName
 * @returns {import('../types.js').InvocationBucket}
 */
export const useInvocationStore = (s3client, bucketName) => {
  const store = Store.open({
    connection: { channel: s3client },
    region: typeof s3client.config.region === 'string' ? s3client.config.region : 'us-west-2',
    buckets: {
      index: { name: bucketName },
      message: { name: bucketName },
    }
  })

  return {
    /**
     * Get the agent message file CID for an invocation.
     *
     * @param {string} invocationCid 
     */
    getInLink: async (invocationCid) => {
      const result = await Store.resolve(store, { invocation: parseLink(invocationCid) })
      if (result.ok) {
        return result.ok.message.toString()
      }
    },
  }
}
