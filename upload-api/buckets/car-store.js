import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { base64pad } from 'multiformats/bases/base64'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Client } from '../../lib/aws/s3.js'

/**
 * Abstraction layer with Factory to perform operations on bucket storing CAR files.
 *
 * @deprecated
 * @param {string} region
 * @param {string} bucketName
 * @param {Partial<import('../../lib/aws/s3.js').Address>} [options]
 */
export function createCarStore(region, bucketName, options) {
  const s3 = getS3Client({
    region,
    ...options,
  })
  return useCarStore(s3, bucketName)
}

/**
 * @deprecated
 * @param {import('@aws-sdk/client-s3').S3Client} s3
 * @param {string} bucketName
 * @returns {import('../types.js').CarStore}
 */
export function useCarStore(s3, bucketName) {
  return {
    /**
     * @param {import('@storacha/upload-api').UnknownLink} link
     */
    has: async (link) => {
      const cmd = new HeadObjectCommand({
        Key: `${link}/${link}.car`,
        Bucket: bucketName,
      })
      try {
        await s3.send(cmd)
      } catch (cause) {
        // @ts-expect-error
        if (cause?.$metadata?.httpStatusCode === 404) {
          return false
        }
        throw new Error(`failed to check if CAR exists: ${link}`, { cause })
      }
      return true
    },

    /**
     * Create a presigned s3 url allowing the recipient to upload
     * only the CAR that matches the provided Link
     *
     * @param {import('@storacha/upload-api').UnknownLink} link
     * @param {number} size
     */
    createUploadUrl: async (link, size) => {
      const checksum = base64pad.baseEncode(link.multihash.digest)
      const cmd = new PutObjectCommand({
        Key: `${link}/${link}.car`,
        Bucket: bucketName,
        ChecksumSHA256: checksum,
        ContentLength: size,
      })
      const expiresIn = 60 * 60 * 24 // 1 day
      const url = new URL(
        await getSignedUrl(s3, cmd, {
          expiresIn,
          unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
        })
      )
      return {
        url,
        headers: {
          'x-amz-checksum-sha256': checksum,
          'content-length': String(size),
        },
      }
    },

    /**
     * @param {import('multiformats').UnknownLink} link
     */
    getSize: async (link) => {
      const cid = link.toString()
      const cmd = new HeadObjectCommand({
        Key: `${cid}/${cid}.car`,
        Bucket: bucketName,
      })
      let res
      try {
        res = await s3.send(cmd)
      } catch (cause) {
        // @ts-expect-error
        if (cause?.$metadata?.httpStatusCode === 404) {
          return 0
        }
        throw new Error('Failed to check if car-store', { cause })
      }
      return res.ContentLength || 0
    },
  }
}

/**
 * compose many car stores.
 * store#createUploadUrl is from first store.
 * store#has will check stores in order until 0-1 `true` are found.
 * 
 * @deprecated
 * @template {import('@web3-storage/upload-api').CarStoreBucket} T
 * @param {T} carStore
 * @param {T[]} moreCarStores
 */
export function composeCarStoresWithOrderedHas(carStore, ...moreCarStores) {
  return {
    ...carStore,
    has: composeSome(carStore.has, ...moreCarStores.map(s => s.has.bind(s))),
  }
}

/**
 * compose async functions that return Promise<boolean>.
 * The returned function will have the same signature,
 * but will try the composed functions in order until one (or none) returns true.
 * 
 * @template T
 * @param  {Array<(e: T) => Promise<boolean>>} hasFunctions 
 */
function composeSome(...hasFunctions) {
  /**
   * @param {T} e
   */
  return async function (e) {
    for (const has of hasFunctions) {
      if (await has(e)) return true
    }
    return false
  }
}

/**
 * car store backed by a simple map. useful for testing.
 * 
 * @param {Map<import('multiformats').UnknownLink, any>} map
 * @returns {import('@web3-storage/upload-api').CarStoreBucket}
 */
export function createMapCarStore(map=new Map) {
  return {
    async has(link) {
      return map.has(link)
    },
    createUploadUrl() {
      throw new Error('not implemented')
    }
  };
}
