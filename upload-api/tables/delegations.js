import { base32 } from 'multiformats/bases/base32'
import {
  QueryCommand,
  BatchWriteItemCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
// eslint-disable-next-line no-unused-vars
import { CID } from 'multiformats/cid'
import {
  bytesToDelegations,
  delegationsToBytes
} from '@storacha/access/encoding'
// eslint-disable-next-line no-unused-vars
import * as Ucanto from '@ucanto/interface'
import { Failure } from '@ucanto/server'
import { parseLink } from '@ucanto/core'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

// Feature flag for looking up delegations in the invocations in which
// they were originally embeded.
// As of 6/6/2023 not all delegations have corresponding invocations
// because our access/confirm provider creates delegations.
// Once we change this, we can re-enable this optimization.
// This work is being tracked in https://github.com/web3-storage/w3infra/issues/210
const FIND_DELEGATIONS_IN_INVOCATIONS = false
const DELEGATIONS_FIND_DEFAULT_LIMIT = 1000

/**
 * @typedef {Ucanto.Delegation} Delegation
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} deps
 * @param {import('../types.js').DelegationsBucket} deps.bucket
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createDelegationsTable (region, tableName, { bucket }, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })

  return useDelegationsTable(dynamoDb, tableName, { bucket })
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @param {object} deps
 * @param {import('../types.js').DelegationsBucket} deps.bucket
 * @returns {import('@storacha/upload-api').DelegationsStorage}
 */
export function useDelegationsTable (dynamoDb, tableName, { bucket }) {
  return {
    putMany: async (delegations, options = {}) => {
      if (delegations.length === 0) {
        return {
          ok: {}
        }
      }
      await writeDelegations(bucket, delegations)
      const batchWriteResult = await dynamoDb.send(new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: delegations.map(d => ({
            PutRequest: {
              Item: marshall(
                createDelegationItem(d, options.cause),
                { removeUndefinedValues: true })
            }
          })
          )
        }
      }))
      const unprocessedItemCount = batchWriteResult?.UnprocessedItems?.[tableName]?.length || 0
      return (unprocessedItemCount > 0) ?
        (
          {
            error: new Failure(`failed to index ${unprocessedItemCount} delegations - please try again`)
          }
        ) : (
          {
            ok: {}
          }
        )

    },

    count: async () => {
      const result = await dynamoDb.send(new DescribeTableCommand({
        TableName: tableName
      }))

      return BigInt(result.Table?.ItemCount ?? -1)
    },

    find: async (query) => {
      const cmd = new QueryCommand({
        TableName: tableName,
        IndexName: 'audience',
        Limit: DELEGATIONS_FIND_DEFAULT_LIMIT, // TODO this should probably be configurable using an `options` hash
        KeyConditionExpression: 'audience = :audience',
        ExpressionAttributeValues: marshall({
          ':audience': query.audience,
        }),
        ProjectionExpression: 'link'
      })
      const response = await dynamoDb.send(cmd)

      const items = response.Items ?? []
      /**
       * @type {import('@ucanto/interface').Result<Delegation, Failure>[]}
       */
      const delegationResults = await Promise.all(items.map(async item => {
        const { cause, link } = unmarshall(item)
        const delegationCid = /** @type {Ucanto.Link} */ (parseLink(link))
        if (FIND_DELEGATIONS_IN_INVOCATIONS && cause) {
          // if this row has a cause, it is the CID of the invocation that contained these delegations
          // and we can pull them from there
          return { error: new Failure('not implemented') }
        } else {
          // otherwise, we'll try to find the delegation in the R2 bucket we used to stash them in
          const result = await cidToDelegation(bucket, delegationCid)
          return result.ok ? result : (
            {
              error: new Failure(`failed to get delegation ${delegationCid} from legacy delegations bucket`, {
                cause: result.error
              })
            }
          )
        }
      }))
      /**
       * @type {Delegation[]}
       */
      const delegations = []
      for (const result of delegationResults) {
        if (result.ok) {
          delegations.push(result.ok)
        } else {
          return result
        }
      }
      return {
        ok: delegations
      }
    },
  }
}

/**
 * 
 * @param {import('../types.js').DelegationsBucket} bucket
 * @param {Ucanto.Delegation<Ucanto.Tuple<Ucanto.Capability>>[]} delegations
 */
async function writeDelegations (bucket, delegations) {
  return writeEntries(
    bucket,
    [...delegations].map((delegation) => {
      const carBytes = delegationsToBytes([delegation])
      const value = carBytes
      return /** @type {[key: CID, value: Uint8Array]} */ ([delegation.cid, value])
    })
  )
}

/**
 * 
 * @param {import('../types.js').DelegationsBucket} bucket
 * @param {Iterable<readonly [key: CID, value: Uint8Array ]>} entries
 */
async function writeEntries (bucket, entries) {
  await Promise.all([...entries].map(([key, value]) => bucket.put(key, value)))
}

/**
 * @param {Delegation} d
 * @param {Ucanto.Link | undefined} cause
 * @returns {{cause?: string, link: string, audience: string, issuer: string, expiration: number | null}}}
 */
function createDelegationItem (d, cause) {
  return {
    cause: cause?.toString(),
    link: d.cid.toString(),
    audience: d.audience.did(),
    issuer: d.issuer.did(),
    expiration: (d.expiration === Infinity ? null : d.expiration)
  }
}

/** 
 * @param {import('../types.js').DelegationsBucket} bucket
 * @param {Ucanto.Link} cid
 * @returns {Promise<Ucanto.Result<Ucanto.Delegation, Ucanto.Failure>>}
 */
async function cidToDelegation (bucket, cid) {
  const delegationCarBytes = await bucket.get(/** @type {import('multiformats/cid').CID} */(cid))
  if (!delegationCarBytes) {
    return { error: new Failure(`failed to read car bytes for cid ${cid.toString(base32)}`) }
  }
  const delegations = bytesToDelegations(delegationCarBytes)
  const delegation = delegations.find((d) => d.cid.equals(cid))
  if (!delegation) {
    return { error: new Failure(`failed to parse delegation with expected cid ${cid.toString(base32)}`) }
  }
  return { ok: delegation }
}
