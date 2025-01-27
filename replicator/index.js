import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { toString } from 'uint8arrays/to-string'
import { fromString } from 'uint8arrays/from-string'

/**
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 */

/**
 * Replicate object from event target to destination bucket.
 *
 * @param {object} props
 * @param {import('./utils/parse-sqs-event.js').EventRecord} props.record
 * @param {S3Client} props.destinationBucket
 * @param {S3Client} props.originBucket
 * @param {string} props.destinationBucketName
 */
 export const replicate = async ({
  record,
  destinationBucket,
  destinationBucketName,
  originBucket,
}) => {
  const key = record.key

  // Verify if event file already exist in destination bucket
  try {
    await destinationBucket.send(
      new HeadObjectCommand({
        Bucket: destinationBucketName,
        Key: key,
      })
    )
  } catch (/** @type {any} */ err) {
    if (err?.$metadata.httpStatusCode !== 404) {
      throw err
    }

    // Not in destinationBucket, so read from origin bucket and write to destination bucket
    const getCmd = new GetObjectCommand({
      Bucket: record.bucketName,
      Key: key,
    })

    const res = await originBucket.send(getCmd)
    if (!res.Body) {
      throw new Error('invalid CAR file retrieved')
    }

    const base16Md5 = res.ETag?.replaceAll('"', '') || ''
    const rawMd5 = fromString(base16Md5, 'base16')
    const base64Md5 = toString(rawMd5, 'base64pad')

    // @ts-expect-error aws types body does not include pipe...
    await writeToBucket(key, res.Body, destinationBucketName, destinationBucket, {
      contentLength: res.ContentLength,
      metadata: res.Metadata,
      md5: base64Md5
    })
  }
}

/**
 * @param {string} key
 * @param {import('stream').Readable} body
 * @param {string} bucketName
 * @param {S3Client} client
 * @param {object} [options]
 * @param {string} [options.md5]
 * @param {number} [options.contentLength]
 * @param {Record<string, string> | undefined} [options.metadata]
 */
export async function writeToBucket(key, body, bucketName, client, options = {}) {
  try {
    const putCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentMD5: options.md5,
      ContentLength: options.contentLength,
      Metadata: options.metadata
    })

    await client.send(putCmd)
  } catch (error) {
    throw new Error('error saving car to R2:' + error)
  }
}
