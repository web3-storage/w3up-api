import { test } from './helpers/context.js'

import pWaitFor from 'p-wait-for'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import * as StoreCapabilities from '@storacha/capabilities/store'
import { ShardingStream, UnixFS, Store, Upload } from '@storacha/upload-client'

import { METRICS_NAMES, SPACE_METRICS_NAMES } from '../upload-api/constants.js'

import {
  getStage,
  getApiEndpoint,
  getRoundaboutEndpoint,
  getAwsBucketClient,
  getCloudflareBucketClient,
  getCarparkBucketInfo,
  getDynamoDb,
} from './helpers/deployment.js'
import { createMailSlurpInbox, setupNewClient, getServiceProps } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'
import { getMetrics, getSpaceMetrics } from './helpers/metrics.js'
import { getUsage } from './helpers/store.js'

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    roundaboutEndpoint: getRoundaboutEndpoint(),
    metricsDynamo: getDynamoDb('admin-metrics'),
    spaceMetricsDynamo: getDynamoDb('space-metrics'),
    rateLimitsDynamo: getDynamoDb('rate-limit')
  }
})

/**
 * Integration test for all flow from `blob/add` and `index/add`, to read interfaces and kinesis stream.
 * 1. Login client
 * 2. Get metrics before uploading any data
 * 3. Store a CAR
 * 4. Add an Upload associated with the CAR previously added
 * 5. Check CAR was correctly stored on bucket
 * 6. Check DUDEWHERE index was correctly stored on bucket
 * 7. Check upload list includes CAR stored
 * 8. Remove CAR
 * 9. Verify Replicator
 * 10. Read from w3link
 * 11. Read from Roundabout
 * 12. Verify metrics
 */
test('store protocol integration flow', async t => {
  const stage = getStage()
  const inbox = await createMailSlurpInbox()
  const { client, account } = await setupNewClient(t.context.apiEndpoint, { inbox })
  const serviceProps = getServiceProps(client, t.context.apiEndpoint, StoreCapabilities.add.can)
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }

  // Get space metrics before store/add
  const spaceBeforeStoreAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.STORE_ADD_TOTAL)
  const spaceBeforeStoreAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL)

  // Get metrics before upload
  const beforeOperationMetrics = await getMetrics(t)
  const beforeStoreAddTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.STORE_ADD_TOTAL)
  const beforeStoreAddSizeTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.STORE_ADD_SIZE_TOTAL)

  const beforeOperationUsage = await getUsage(client, account)
  const spaceBeforeStoreAddUsage = beforeOperationUsage[spaceDid]
  const s3Client = getAwsBucketClient()
  const r2Client = getCloudflareBucketClient()

  console.log('Creating new File')
  const file = await randomFile(100)

  // Encode file as Unixfs and perform store/add
  const blocksReadableStream = UnixFS.createFileEncoderStream(file)
  /** @type {import('@storacha/upload-client/types').CARLink[]} */
  const shards = []
  /** @type {import('@storacha/upload-client/types').AnyLink | undefined} */
  let root

  await blocksReadableStream
    .pipeThrough(new ShardingStream())
    .pipeThrough(
      new TransformStream({
        async transform(car, controller) {
          const bytes = new Uint8Array(await car.arrayBuffer())
          // Invoke store/add and write bytes to write target
          const cid = await Store.add(serviceProps.conf, bytes, { connection: serviceProps.connection })

          const { version, roots, size } = car
          controller.enqueue({ version, roots, size, cid })

        }
      })
    )
    .pipeTo(
      new WritableStream({
        write(meta) {
          root = root || meta.roots[0]
          shards.push(meta.cid)
        },
      })
    )

  if (root === undefined) throw new Error('missing root CID')
  t.is(shards.length, 1)

  // Invoke upload/add
  await Upload.add(serviceProps.conf, root, shards, { connection: serviceProps.connection })

  console.log('Uploaded new file', root.toString())
  // Check carpark
  console.log('Checking CAR stored in write target:', shards[0].toString())
  const carparkRequest = await s3Client.send(
    new HeadObjectCommand({
      Bucket: (getCarparkBucketInfo()).Bucket,
      Key: `${shards[0].toString()}/${shards[0].toString()}.car`
    })
  )
  t.is(carparkRequest.$metadata.httpStatusCode, 200)
  const carSize = carparkRequest.ContentLength

  // List space files
  let uploadFound, cursor
  do {
    const listResult = await client.capability.upload.list({
      size: 5,
      cursor
    })
    uploadFound = listResult.results.find(upload => upload.root.equals(root))
    cursor = listResult.cursor
  } while (!uploadFound)

  t.is(uploadFound.shards?.length, 1)
  for (let i = 0; i < shards.length; i++) {
    t.truthy(shards[i].equals(uploadFound.shards?.[i]))
  }

  // Remove file from space
  const removeResult = await client.capability.upload.remove(root)
  // @ts-expect-error error type not found
  t.falsy(removeResult?.error)

  // Replicator
  console.log('Checking replicator')
  // Check carpark
  await pWaitFor(async () => {
    let carpark
    try {
      carpark = await r2Client.send(
        new HeadObjectCommand({
          Bucket: process.env.R2_CARPARK_BUCKET_NAME || '',
          Key: `${shards[0].toString()}/${shards[0].toString()}.car`
        })
      )
    } catch {}

    return carpark?.$metadata.httpStatusCode === 200
  }, {
    interval: 100,
  })

  // Verify w3link can resolve uploaded file
  console.log('Checking w3link can fetch root', root.toString())
  const gatewayURL = `https://${root}.ipfs-staging.w3s.link`
  const gatewayRetries = 5
  for (let i = 0; i < gatewayRetries; i++) {
    const controller = new AbortController()
    const timeoutID = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(gatewayURL, { method: 'HEAD', signal: controller.signal })
      if (res.status === 200) break
    } catch (err) {
      console.error(`failed gateway fetch: ${root} (attempt ${i + 1})`, err)
      if (i === gatewayRetries - 1) throw err
    } finally {
      clearTimeout(timeoutID)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  // Read from Roundabout returns 200
  console.log('Checking Roundabout can fetch CAR:', shards[0].toString())
  const roundaboutResponse = await fetch(
    `${t.context.roundaboutEndpoint}/${shards[0].toString()}`
  )
  t.is(roundaboutResponse.status, 200)

  // TODO: Check bitswap
  // There is a big delay here as indexing happens in back-end, so not done for now

  // Check metrics were updated
  console.log('Checking metrics match work done')
  if (beforeStoreAddSizeTotal && spaceBeforeStoreAddSizeMetrics) {
    await pWaitFor(async () => {
      const afterOperationMetrics = await getMetrics(t)
      const afterStoreAddTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.STORE_ADD_TOTAL)
      const afterStoreAddSizeTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.STORE_ADD_SIZE_TOTAL)
      const spaceAfterStoreAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.STORE_ADD_TOTAL)
      const spaceAfterStoreAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL)

      // If staging accept more broad condition given multiple parallel tests can happen there
      if (stage === 'staging') {
        return (
          afterStoreAddTotal?.value >= beforeStoreAddTotal?.value + 1 &&
          afterStoreAddSizeTotal?.value >= beforeStoreAddSizeTotal.value + carSize &&
          spaceAfterStoreAddMetrics?.value >= spaceBeforeStoreAddMetrics?.value + 1 &&
          spaceAfterStoreAddSizeMetrics?.value >= spaceBeforeStoreAddSizeMetrics?.value + carSize
        )
      }

      return (
        afterStoreAddTotal?.value === beforeStoreAddTotal?.value + 1 &&
        afterStoreAddSizeTotal?.value === beforeStoreAddSizeTotal.value + carSize &&
        spaceAfterStoreAddMetrics?.value === spaceBeforeStoreAddMetrics?.value + 1 &&
        spaceAfterStoreAddSizeMetrics?.value === spaceBeforeStoreAddSizeMetrics?.value + carSize
      )
    })
  }

  if (beforeOperationUsage) {
    console.log("checking usage matches work done")
    await pWaitFor(async () => {
      const afterOperationUsage = await getUsage(client, account)
      const spaceAfterStoreAddUsage = afterOperationUsage[spaceDid]
      // If staging accept more broad condition given multiple parallel tests can happen there
      return (
          spaceAfterStoreAddUsage >= spaceBeforeStoreAddUsage + carSize
      )
    })
  }

  // verify that blocking a space makes it impossible to upload a file to it
  await t.context.rateLimitsDynamo.client.send(new PutItemCommand({
    TableName: t.context.rateLimitsDynamo.tableName,
    Item: marshall({
      id: Math.random().toString(10),
      subject: client.currentSpace()?.did(),
      rate: 0
    })
  }))
  const uploadError = await t.throwsAsync(async () => {
    await client.capability.store.add(await randomFile(100))
  })

  t.is(uploadError?.message, 'failed store/add invocation')
})

