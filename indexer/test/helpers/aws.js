import { GenericContainer as Container } from 'testcontainers'
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import { webcrypto } from '@storacha/one-webcrypto'

/**
 * @template T
 * @typedef {{ client: T, endpoint: string }} AWSService
 */

/** @param {{ port?: number, region?: string }} [opts] */
export const createDynamoDB = async (opts = {}) => {
  console.log('Creating local DynamoDB...')
  const port = opts.port || 8000
  const region = opts.region || 'us-west-2'
  const container = await new Container('amazon/dynamodb-local:latest')
    .withExposedPorts(port)
    .start()
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(8000)}`
  return { client: new DynamoDBClient({ region, endpoint }), endpoint }
}

/**
 * Convert SST TableProps to DynamoDB `CreateTableCommandInput` config.
 * 
 * @typedef {import('@aws-sdk/client-dynamodb').CreateTableCommandInput} CreateTableCommandInput
 * @typedef {import('sst/constructs').TableProps} TableProps
 * @param {TableProps} props
 * @returns {Pick<CreateTableCommandInput, 'AttributeDefinitions' | 'KeySchema' | 'GlobalSecondaryIndexes'>}
 */
export const dynamoDBTableConfig = ({ fields, primaryIndex, globalIndexes = {} }) => {
  if (!primaryIndex || !fields) throw new Error('Expected primaryIndex and fields on TableProps')
  const globalIndexValues = Object.values(globalIndexes)
  const attributes = [
    ...Object.values(primaryIndex),
    ...globalIndexValues.map((value) => value.partitionKey),
    ...globalIndexValues.map((value) => value.sortKey)
  ]

  const AttributeDefinitions = Object.entries(fields)
    .filter(([k]) => attributes.includes(k)) // 'The number of attributes in key schema must match the number of attributes defined in attribute definitions'
    .map(([k, v]) => ({
      AttributeName: k,
      AttributeType: /** @type {import('@aws-sdk/client-dynamodb').ScalarAttributeType} */ (v[0].toUpperCase())
    }))
  const KeySchema = toKeySchema(primaryIndex)
  const GlobalSecondaryIndexes = Object.entries(globalIndexes)
    .map(([IndexName, val]) => /** @type {import('@aws-sdk/client-dynamodb').GlobalSecondaryIndex} */ ({
      IndexName,
      KeySchema: toKeySchema(val),
      Projection: { ProjectionType: 'ALL' },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }))

  return {
    AttributeDefinitions,
    KeySchema,
    GlobalSecondaryIndexes: GlobalSecondaryIndexes.length ? GlobalSecondaryIndexes : undefined
  }
}

/** @param {{ partitionKey: string, sortKey?: string }} index */
const toKeySchema = ({ partitionKey, sortKey }) => {
  /** @type {import('@aws-sdk/client-dynamodb').KeySchemaElement[]} */
  const KeySchema = [{ AttributeName: partitionKey, KeyType: 'HASH' }]
  if (sortKey) {
    KeySchema.push({ AttributeName: sortKey, KeyType: 'RANGE' })
  }
  return KeySchema
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {import("sst/constructs").TableProps} tableProps
 * @param {string} [pfx]
 */
export async function createTable (dynamo, tableProps, pfx = '') {
  const name = pfx + webcrypto.randomUUID().split('-')[0]
  console.log(`Creating DynamoDB table "${name}"...`)

  await dynamo.send(new CreateTableCommand({
    TableName: name,
    ...dynamoDBTableConfig(tableProps),
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))

  return name
}

/** @param {{ port?: number, region?: string }} [opts] */
export const createSQS = async (opts = {}) => {
  console.log('Creating local SQS...')
  const port = opts.port || 9324
  const region = opts.region || 'elasticmq'
  const container = await new Container('softwaremill/elasticmq-native')
    .withExposedPorts(port)
    .start()
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9324)}`
  return { client: new SQSClient({ region, endpoint }), endpoint }
}

/**
 * @param {import('@aws-sdk/client-sqs').SQSClient} sqs
 * @param {string} [pfx]
 */
export async function createQueue (sqs, pfx = '') {
  const name = pfx + webcrypto.randomUUID().split('-')[0]
  console.log(`Creating SQS queue "${name}"...`)
  const res = await sqs.send(new CreateQueueCommand({ QueueName: name }))
  if (!res.QueueUrl) throw new Error('missing queue URL')
  return res.QueueUrl
}
