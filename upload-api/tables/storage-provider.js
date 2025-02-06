
import { GetItemCommand, ScanCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import * as Link from 'multiformats/link'
import { base64 } from 'multiformats/bases/base64'
import { identity } from 'multiformats/hashes/identity'
import { getDynamoClient } from '../../lib/aws/dynamo.js'
import { parse } from '@ipld/dag-ucan/did'
import { extract } from '@ucanto/core/delegation'

/** @import * as API from '../types.js' */

/**
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {API.StorageProviderTable}
 */
export const createStorageProviderTable = (region, tableName, options) => {
  const dynamo = getDynamoClient({ region, endpoint: options?.endpoint })
  return useStorageProviderTable(dynamo, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @returns {API.StorageProviderTable}
 */
export const useStorageProviderTable = (dynamo, tableName) => ({
  /** @type {API.StorageProviderTable['put']} */
  async put (input) {
    const cmd = new PutItemCommand({
      TableName: tableName,
      Item: marshall(await encode(input))
    })
    await dynamo.send(cmd)
  },

  /** @type {API.StorageProviderTable['get']} */
  async get (provider) {
    const cmd = new GetItemCommand({
      TableName: tableName,
      Key: marshall({ provider })
    })
    const res = await dynamo.send(cmd)
    return res.Item && decode(res.Item)
  },

  /** @type {API.StorageProviderTable['del']} */
  async del (provider) {
    const cmd = new DeleteItemCommand({
      TableName: tableName,
      Key: marshall({ provider })
    })
    await dynamo.send(cmd)
  },

  /** @type {API.StorageProviderTable['list']} */
  async list () {
    /** @type {{ provider: import('@ucanto/interface').DID; weight: number }[]} */
    const ids = []
    /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue>|undefined} */
    let cursor
    while (true) {
      const cmd = new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: cursor,
        AttributesToGet: ['provider', 'weight']
      })
      const res = await dynamo.send(cmd)
      for (const item of res.Items ?? []) {
        const raw = unmarshall(item)
        ids.push({
          provider: parse(raw.provider).did(),
          weight: raw.weight
        })
      }
      cursor = res.LastEvaluatedKey
      if (!cursor) break
    }
    return ids
  }
})

/**
 * @param {API.StorageProviderInput} input
 * @returns {Promise<Record<string, any>>}
 */
const encode = async input => {
  const archive = await input.proof.archive()
  if (!archive.ok) {
    throw new Error('archiving proof', { cause: archive.error })
  }
  return {
    provider: input.provider,
    endpoint: input.endpoint.toString(),
    proof: Link.create(0x0202, identity.digest(archive.ok)).toString(base64),
    weight: input.weight,
    insertedAt: new Date().toISOString(),
  }
}

/** @param {Record<string, any>} item */
const decode = async item => {
  const raw = unmarshall(item)
  const cid = Link.parse(raw.proof, base64)
  const { ok: proof, error } = await extract(cid.multihash.digest)
  if (!proof) {
    throw new Error(`failed to extract proof for provider: ${raw.provider}`, { cause: error })
  }
  return {
    provider: parse(raw.provider).did(),
    endpoint: new URL(raw.endpoint),
    proof,
    weight: raw.weight ?? 100,
    insertedAt: new Date(raw.insertedAt)
  }
}
