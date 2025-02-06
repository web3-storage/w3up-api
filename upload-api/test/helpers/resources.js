import { customAlphabet } from 'nanoid'
import pRetry from 'p-retry'
import { GenericContainer as Container } from 'testcontainers'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import * as Signer from '@ucanto/principal/ed25519'
import * as Server from '@ucanto/server'
import * as Legacy from '@ucanto/transport/legacy'
import * as HTTP from 'http'

/**
 * @typedef {Partial<{
 *   account: Partial<import('@storacha/access/types').Service['space']>
 * }>} PartialAccessService
 * @typedef {ReturnType<mockAccessService>} MockedAccessService
 * @typedef {{
 *   servicePrincipal: import('@ucanto/interface').Principal
 *   serviceURL: URL
 *   setServiceImpl: (impl: PartialAccessService) => void
 *   server: import('@ucanto/server').ServerView<MockedAccessService>
 *   httpServer: HTTP.Server
 * }} MockAccess
 */

/**
 * @param {object} [opts]
 * @param {number} [opts.port]
 * @param {string} [opts.region]
 */
export async function createDynamodDb(opts = {}) {
  const port = opts.port || 8000
  const region = opts.region || 'us-west-2'
  const dbContainer = await new Container('amazon/dynamodb-local:latest')
    .withExposedPorts(port)
    .start()

  const endpoint = `http://${dbContainer.getHost()}:${dbContainer.getMappedPort(
    8000
  )}`

  return new DynamoDBClient({
    region,
    endpoint,
  })
}

/**
 * 
 * @param {string} indexName 
 * @param {import('sst/constructs').TableGlobalIndexProps} props 
 */
function globalIndexPropsToGlobalIndexSpec (indexName, props) {
  const { partitionKey, projection, sortKey } = props
  /**
   * @type {import('@aws-sdk/client-dynamodb').GlobalSecondaryIndex}
   */
  const spec = {
    IndexName: indexName,
    KeySchema: [
      {
        AttributeName: partitionKey,
        KeyType: "HASH",
      },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    },
    Projection: {
      ProjectionType: "KEYS_ONLY",
      NonKeyAttributes: undefined
    }
  }
  if (sortKey) {
    spec.KeySchema?.push({ AttributeName: sortKey, KeyType: 'RANGE' })
  }
  if (projection && projection == 'all') {
    spec.Projection = {
      ProjectionType: "ALL",
      NonKeyAttributes: undefined
    }
  } else if (Array.isArray(projection)) {
    spec.Projection = {
      ProjectionType: 'INCLUDE',
      NonKeyAttributes: projection
    }
  }
  return spec
}

/**
 * Convert SST TableProps to DynamoDB `CreateTableCommandInput` config
 *
 * @typedef {import('@aws-sdk/client-dynamodb').CreateTableCommandInput} CreateTableCommandInput
 * @typedef {import('sst/constructs').TableProps} TableProps
 *
 * @param {TableProps} props
 * @returns {Pick<CreateTableCommandInput, 'AttributeDefinitions' | 'KeySchema' | 'GlobalSecondaryIndexes'>}
 */
export function dynamoDBTableConfig ({ fields, primaryIndex, globalIndexes }) {
  if (!primaryIndex || !fields)
    throw new Error('Expected primaryIndex and fields on TableProps')
  const attributes = Object.values(primaryIndex)
  if (globalIndexes) {
    for (const index of Object.values(globalIndexes)) {
      if (index.partitionKey) attributes.push(index.partitionKey)
      if (index.sortKey) attributes.push(index.sortKey)
    }
  }
  const AttributeDefinitions = Object.entries(fields)
    .filter(([k]) => attributes.includes(k)) // 'The number of attributes in key schema must match the number of attributes defined in attribute definitions'
    .map(([k, v]) => ({
      AttributeName: k,
      AttributeType: /** @type {import('@aws-sdk/client-dynamodb').ScalarAttributeType} */ (v[0].toUpperCase()),
    }))
  /** @type {import('@aws-sdk/client-dynamodb').KeySchemaElement[]} */
  const KeySchema = [
    { AttributeName: primaryIndex.partitionKey, KeyType: 'HASH' },
  ]
  if (primaryIndex.sortKey) {
    KeySchema.push({ AttributeName: primaryIndex.sortKey, KeyType: 'RANGE' })
  }
  /** @type {Pick<CreateTableCommandInput, 'AttributeDefinitions' | 'KeySchema' | 'GlobalSecondaryIndexes'>} */
  const result = {
    AttributeDefinitions,
    KeySchema
  }
  if (globalIndexes) {
    result.GlobalSecondaryIndexes = Object.entries(globalIndexes).map(
      ([indexName, props]) => globalIndexPropsToGlobalIndexSpec(indexName, props)
    )
  }
  return result
}

/**
 * @param {object} [opts]
 * @param {number} [opts.port]
 * @param {string} [opts.region]
 */
export async function createS3(opts = {}) {
  const region = opts.region || 'us-west-2'
  const port = opts.port || 9000

  const minio = await pRetry(() =>
    new Container('quay.io/minio/minio')
      .withCommand(['server', '/data'])
      .withExposedPorts(port)
      .start()
  )

  const clientOpts = {
    endpoint: `http://${minio.getHost()}:${minio.getMappedPort(port)}`,
    forcePathStyle: true,
    region,
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    },
  }

  return {
    client: new S3Client(clientOpts),
    clientOpts,
  }
}

/**
 * represents connection to cloudflare r2 over its s3-compatiable API,
 * e.g. carpark
 */
export const createR2 = createS3;

/**
 * @param {S3Client} s3
 */
export async function createBucket(s3) {
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const Bucket = id()
  await s3.send(new CreateBucketCommand({ Bucket }))
  return Bucket
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 * @param {TableProps} props
 */
export async function createTable(dynamo, props) {
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const tableName = id()

  // TODO: see in pickup Document DB wrapper
  await dynamo.send(
    new CreateTableCommand({
      TableName: tableName,
      ...dynamoDBTableConfig(props),
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1,
      },
    })
  )

  return tableName
}

/** @param {{ port?: number, region?: string }} [opts] */
export const createSQS = async (opts = {}) => {
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
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const name = id()
  const res = await sqs.send(new CreateQueueCommand({ QueueName: name }))
  if (!res.QueueUrl) throw new Error('missing queue URL')
  return new URL(res.QueueUrl)
}

/**
 * @typedef {object} ResourcesMetadata
 * @property {string} [region]
 * @property {string} tableName
 * @property {string} bucketName
 */

/**
 * @param {any} ctx
 * @param {ResourcesMetadata} resourcesMetadata
 */
export function getSigningOptions(ctx, resourcesMetadata) {
  return {
    region: resourcesMetadata.region || 'us-west-2',
    secretAccessKey: ctx.secretAccessKey,
    accessKeyId: ctx.accessKeyId,
    sessionToken: ctx.sessionToken,
    bucket: resourcesMetadata.bucketName,
  }
}

/** @returns {Promise<MockAccess>} */
export async function createAccessServer() {
  const signer = await Signer.generate()
  const server = Server.create({
    id: signer,
    service: mockAccessService(),
    codec: Legacy.inbound,
    validateAuthorization: () => ({ ok: {} })
  })

  const httpServer = HTTP.createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) {
        chunks.push(chunk)
      }
      const { headers, body } = await server.request({
        // @ts-expect-error
        headers: request.headers,
        body: Buffer.concat(chunks),
      })
      response.writeHead(200, headers)
      response.write(body)
    } catch (err) {
      console.error(err)
      response.statusCode = 500
    } finally {
      response.end()
    }
  })

  const servicePrincipal = signer
  const serviceURL = await new Promise((resolve) => {
    httpServer.listen(() => {
      // @ts-expect-error
      const { port } = httpServer.address()
      const serviceURL = new URL(`http://127.0.0.1:${port}`)
      resolve(serviceURL)
    })
  })
  /** @param {PartialAccessService} impl */
  const setServiceImpl = (impl) =>
    Object.assign(server.service, mockAccessService(impl))

  return { servicePrincipal, serviceURL, setServiceImpl, server, httpServer }
}

const notImplemented = () => {
  throw new Server.Failure('not implemented')
}

/** @param {PartialAccessService} [impl] */
function mockAccessService(impl = {}) {
  return {
    space: {
      info: withCallCount(impl.account?.info ?? notImplemented),
    },
  }
}

/**
 * @template {Function} T
 * @param {T} fn
 */
function withCallCount(fn) {
  /** @param {T extends (...args: infer A) => any ? A : never} args */
  const countedFn = (...args) => {
    countedFn.called = true
    countedFn.callCount++
    return fn(...args)
  }
  countedFn.called = false
  countedFn.callCount = 0
  return countedFn
}
