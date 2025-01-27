import {
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { parseLink } from '@ucanto/server'

import { StoreOperationFailed, RecordNotFound } from '@storacha/filecoin-api/errors'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/**
 * @typedef {'submitted' | 'accepted' | 'invalid'} PieceStatus
 * @typedef {import('@storacha/filecoin-api/storefront/api').PieceRecord} PieceRecord
 * @typedef {import('@storacha/filecoin-api/storefront/api').PieceRecordKey} PieceRecordKey
 * @typedef {{ status: PieceStatus }} PieceRecordQuery
 * @typedef {import('../types.js').PieceStoreRecord} PieceStoreRecord
 * @typedef {import('../types.js').PieceStoreRecordKey} PieceStoreRecordKey
 * @typedef {import('../types.js').PieceStoreRecordStatus} PieceStoreRecordStatus
 */

/**
 * @param {PieceRecord} record 
 * @returns {PieceStoreRecord} 
 */
const encodeRecord = (record) => {
  return {
    piece: record.piece.toString(),
    content: record.content.toString(),
    group: record.group.toString(),
    stat: encodeStatus(record.status),
    insertedAt: record.insertedAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * @param {Partial<PieceRecord>} record 
 * @returns {Partial<PieceStoreRecord>} 
 */
const encodePartialRecord = (record) => {
  return {
    ...(record.status && { stat: encodeStatus(record.status) }),
  }
}

/**
 * @param {PieceRecordKey} recordKey 
 * @returns {PieceStoreRecordKey} 
 */
const encodeKey = (recordKey) => {
  return {
    piece: recordKey.piece.toString(),
  }
}


/**
 * @param {PieceStatus} status 
 */
const encodeStatus = (status) => {
  switch (status) {
    case 'submitted': {
      return Status.SUBMITTED
    }
    case 'accepted': {
      return Status.ACCEPTED
    }
    case 'invalid': {
      return Status.INVALID
    }
    default: {
      throw new Error('invalid status received for encoding')
    }
  }
}

/**
 * @param {PieceStoreRecord} encodedRecord 
 * @returns {PieceRecord}
 */
export const decodeRecord = (encodedRecord) => {
  return {
    piece: parseLink(encodedRecord.piece),
    content: parseLink(encodedRecord.content),
    status: decodeStatus(encodedRecord.stat),
    group: encodedRecord.group,
    insertedAt: encodedRecord.insertedAt,
    updatedAt: encodedRecord.updatedAt
  }
}

/**
 * @param {PieceStoreRecordStatus} status 
 * @returns {PieceStatus}
 */
const decodeStatus = (status) => {
  switch (status) {
    case Status.SUBMITTED: {
      return 'submitted'
    }
    case Status.ACCEPTED: {
      return 'accepted'
    }
    case Status.INVALID: {
      return 'invalid'
    }
    default: {
      throw new Error('invalid status received for decoding')
    }
  }
}

/**
 * @param {PieceRecordQuery} recordKey 
 */
const encodeQueryProps = (recordKey) => {
  return {
    IndexName: 'stat',
    KeyConditions: {
      stat: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [{ N: `${encodeStatus(recordKey.status)}` }]
      }
    }
  }
}


/**
 * Abstraction layer to handle operations on Piece Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('@storacha/filecoin-api/storefront/api').PieceStore}
 */
export function createPieceTable (region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint
  })

  return usePieceTable(dynamoDb, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('@storacha/filecoin-api/storefront/api').PieceStore}
 */
export function usePieceTable(dynamoDb, tableName) {
  return {
    put: async (record) => {
      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(encodeRecord(record), {
          removeUndefinedValues: true
        }),

      })

      try {
        await dynamoDb.send(cmd)
      } catch (/** @type {any} */ error) {
        return {
          error: new StoreOperationFailed(`failed put to dynamo piece table, content: ${record.content}, piece: ${record.piece}`, { cause: error })
        }
      }

      return {
        ok: {}
      }
    },
    get: async (key) => {
      const getCmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall(encodeKey(key)),
      })
      let res
      try {
        res = await dynamoDb.send(getCmd)
      } catch (/** @type {any} */ error) {
        if (error?.$metadata?.httpStatusCode === 404) {
          return {
            error: new RecordNotFound('item not found in store')
          }
        }
        return {
          error: new StoreOperationFailed(error.message)
        }
      }

      // not found error
      if (!res.Item) {
        return {
          error: new RecordNotFound('item not found in store')
        }
      }

      return {
        ok: decodeRecord(
          /** @type {PieceStoreRecord} */ (unmarshall(res.Item))
        )
      }
    },
    has: async (key) => {
      const getCmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall(encodeKey(key)),
      })
      let res
      try {
        res = await dynamoDb.send(getCmd)
      } catch (/** @type {any} */ error) {
        console.error(error)
        if (error?.$metadata?.httpStatusCode === 404) {
          return {
            ok: false
          }
        }
        return {
          error: new StoreOperationFailed(error.message)
        }
      }

      // not found
      if (!res.Item) {
        return {
          ok: false
        }
      }

      return {
        ok: true
      }
    },
    update: async (key, record) => {
      const encodedRecord = encodePartialRecord(record)
      const ExpressionAttributeValues = {
        ':ua': { S: encodedRecord.updatedAt || (new Date()).toISOString() },
        ...(encodedRecord.stat && {':st': { N: `${encodedRecord.stat}` }})
      }
      const stateUpdateExpression = encodedRecord.stat ? ', stat = :st' : ''
      const UpdateExpression = `SET updatedAt = :ua ${stateUpdateExpression}`

      const updateCmd = new UpdateItemCommand({
        TableName: tableName,
        Key: marshall(encodeKey(key)),
        UpdateExpression,
        ExpressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })

      let res
      try {
        res = await dynamoDb.send(updateCmd)
      } catch (/** @type {any} */ error) {
        return {
          error: new StoreOperationFailed(error.message)
        }
      }

      if (!res.Attributes) {
        return {
          error: new StoreOperationFailed('Missing `Attributes` property on DyanmoDB response')
        }
      }

      return {
        ok: decodeRecord(
          /** @type {PieceStoreRecord} */ (unmarshall(res.Attributes))
        )
      }
    },
    query: async (search, options) => {
      const queryProps = encodeQueryProps(search)
      if (!queryProps) {
        return {
          error: new StoreOperationFailed('no valid search parameters provided')
        }
      }

      // @ts-ignore query props partial
      const queryCmd = new QueryCommand({
        TableName: tableName,
        ...queryProps,
        ExclusiveStartKey: options?.cursor ? JSON.parse(options.cursor) : undefined,
        Limit: options?.size
      })

      let res
      try {
        res = await dynamoDb.send(queryCmd)
      } catch (/** @type {any} */ error) {
        console.error(error)
        return { error: new StoreOperationFailed(error.message) }
      }

      return {
        ok: {
          results: (res.Items ?? []).map(item => decodeRecord(
            /** @type {PieceStoreRecord} */ (unmarshall(item))
          )),
          ...(res.LastEvaluatedKey ? { cursor: JSON.stringify(res.LastEvaluatedKey) } : {})
        }
      }
    }
  }
}

export const Status = {
  SUBMITTED: 0,
  ACCEPTED: 1,
  INVALID: 2
}
