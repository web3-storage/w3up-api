import { useCarStore } from '../../../buckets/car-store.js'

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3
 * @param {string} bucketName
 * @returns {Promise<import('@storacha/upload-api').UcantoServerTestContext['carStoreBucket']>}
 */
export const useTestCarStore = async (s3, bucketName) =>
  Object.assign(useCarStore(s3, bucketName), { deactivate: async () => {} })
