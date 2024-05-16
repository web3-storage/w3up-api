import { fetch } from '@web-std/fetch'
import git from 'git-rev-sync'
import pWaitFor from 'p-wait-for'
import { base58btc } from 'multiformats/bases/base58'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import * as DidMailto from '@web3-storage/did-mailto'

import { METRICS_NAMES, SPACE_METRICS_NAMES } from '../upload-api/constants.js'

import { test } from './helpers/context.js'
import {
  getStage,
  getApiEndpoint,
  getCloudflareBucketClient,
  getDynamoDb
} from './helpers/deployment.js'
import { createMailSlurpInbox, createNewClient, setupNewClient } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'
import { getMetrics, getSpaceMetrics } from './helpers/metrics.js'

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    metricsDynamo: getDynamoDb('admin-metrics'),
    spaceMetricsDynamo: getDynamoDb('space-metrics'),
    rateLimitsDynamo: getDynamoDb('rate-limit')
  }
})

test('GET /', async t => {
  const response = await fetch(t.context.apiEndpoint)
  t.is(response.status, 200)
})

test('GET /version', async t => {
  const stage = getStage()
  const response = await fetch(`${t.context.apiEndpoint}/version`)
  t.is(response.status, 200)

  const body = await response.json()
  t.is(body.env, stage)
  t.is(body.commit, git.long('.'))
})

test('upload-api /metrics', async t => {
  const apiEndpoint = getApiEndpoint()

  const response = await fetch(`${apiEndpoint}/metrics`)
  t.is(response.status, 200)

  const body = await response.text()
  /**
   * # HELP w3up_bytes Total bytes associated with each invocation.
   * # TYPE w3up_bytes counter
   * w3up_bytes{can="store/add"} 0
   * w3up_bytes{can="store/remove"} 0
   */
  t.is((body.match(/w3up_bytes/g) || []).length, 4)
  /**
   * # HELP w3up_invocations_total Total number of invocations.
   * # TYPE w3up_invocations_total counter
   * w3up_invocations_total{can="store/add"} 1
   * w3up_invocations_total{can="store/remove"} 0
   * w3up_invocations_total{can="upload/add"} 0
   * w3up_invocations_total{can="upload/remove"} 1
   */
  t.is((body.match(/w3up_invocations_total/g) || []).length, 6)
})

test('authorizations can be blocked by email or domain', async t => {
  const client = await createNewClient(t.context.apiEndpoint)

  // test email blocking
  await t.context.rateLimitsDynamo.client.send(new PutItemCommand({
    TableName: t.context.rateLimitsDynamo.tableName,
    Item: marshall({
      id: Math.random().toString(10),
      subject: 'travis@example.com',
      rate: 0
    })
  }))

  // it would be nice to use t.throwsAsync here, but that doesn't work with errors that aren't exceptions: https://github.com/avajs/ava/issues/2517
  try {
    await client.authorize('travis@example.com')
    t.fail('authorize should fail with a blocked email address')
  } catch (e) {
    t.is(e.name, 'AccountBlocked')
    t.is(e.message, 'Account identified by did:mailto:example.com:travis is blocked')
  }

  // test domain blocking
  await t.context.rateLimitsDynamo.client.send(new PutItemCommand({
    TableName: t.context.rateLimitsDynamo.tableName,
    Item: marshall({
      id: Math.random().toString(10),
      subject: 'example2.com',
      rate: 0
    })
  }))
  
  // it would be nice to use t.throwsAsync here, but that doesn't work with errors that aren't exceptions: https://github.com/avajs/ava/issues/2517
  try {
    await client.login('travis@example2.com')
    t.fail('authorize should fail with a blocked domain')
  } catch (e) {
    t.is(e.name, 'AccountBlocked')
    t.is(e.message, 'Account identified by did:mailto:example2.com:travis is blocked')
  }
})

// Integration test for all flow from uploading a file to Kinesis events consumers and replicator
test('w3infra store/upload integration flow', async t => {
  const stage = getStage()
  const inbox = await createMailSlurpInbox()
  const client = await setupNewClient(t.context.apiEndpoint, { inbox })
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }
  const account = client.accounts()[DidMailto.fromEmail(inbox.email)]

  // it should be possible to create more than one space
  const space = await client.createSpace("2nd space")
  await account.provision(space.did())
  await space.save()

  // Get space metrics before upload
  const spaceBeforeUploadAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL)
  const spaceBeforeBlobAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_TOTAL)
  const spaceBeforeBlobAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

  // Get metrics before upload
  const beforeOperationMetrics = await getMetrics(t)
  const beforeBlobAddTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_TOTAL)
  const beforeUploadAddTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.UPLOAD_ADD_TOTAL)
  const beforeBlobAddSizeTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

  const r2Client = getCloudflareBucketClient()

  const file = await randomFile(100)
  const shards = []

  // Upload new file
  const fileLink = await client.uploadFile(file, {
    onShardStored: (meta) => {
      shards.push(meta.cid)
      console.log('shard file written', meta.cid)
    }
  })
  t.truthy(fileLink)
  t.is(shards.length, 1)

  // Check carpark
  const encodedMultihash = base58btc.encode(shards[0].multihash.bytes)
  console.log('encoded b58btc multihash', encodedMultihash)
  const carparkRequest = await r2Client.send(
    new HeadObjectCommand({
      Bucket: 'carpark-staging-0',
      Key: `${encodedMultihash}/${encodedMultihash}.blob`,
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
    uploadFound = listResult.results.find(upload => upload.root.equals(fileLink))
    cursor = listResult.cursor
  } while (!uploadFound)

  t.is(uploadFound.shards?.length, 1)
  for (let i = 0; i < shards.length; i++) {
    t.truthy(uploadFound.shards?.[i].equals(shards[i]))
  }

  console.log('file link', fileLink.toString())
  // Verify w3s.link can resolve uploaded file
  // const w3linkResponse = await fetch(
  //   `https://${fileLink}.ipfs-staging.w3s.link`,
  //   {
  //     method: 'HEAD'
  //   }
  // )
  // t.is(w3linkResponse.status, 200)

  // TODO: Hoverboard

  // TODO: Roundabout

  // Remove file from space
  const removeResult = await client.capability.upload.remove(fileLink)
  // @ts-expect-error error not typed
  t.falsy(removeResult?.error)

  console.log('check metrics')
  // Check metrics were updated
  if (beforeBlobAddSizeTotal && spaceBeforeUploadAddMetrics && spaceBeforeBlobAddSizeMetrics && beforeUploadAddTotal) {
    await pWaitFor(async () => {
      const afterOperationMetrics = await getMetrics(t)
      const afterBlobAddTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_TOTAL)
      const afterUploadAddTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.UPLOAD_ADD_TOTAL)
      const afterBlobAddSizeTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)
      const spaceAfterUploadAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL)
      const spaceAfterBlobAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_TOTAL)
      const spaceAfterBlobAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

      // If staging accept more broad condition given multiple parallel tests can happen there
      if (stage === 'staging') {
        return (
          afterBlobAddTotal?.value >= beforeBlobAddTotal?.value + 1 &&
          afterUploadAddTotal?.value === beforeUploadAddTotal?.value + 1 &&
          afterBlobAddSizeTotal?.value >= beforeBlobAddSizeTotal.value + carSize &&
          spaceAfterBlobAddMetrics?.value >= spaceBeforeBlobAddMetrics?.value + 1 &&
          spaceAfterUploadAddMetrics?.value >= spaceBeforeUploadAddMetrics?.value + 1 &&
          spaceAfterBlobAddSizeMetrics?.value >= spaceBeforeBlobAddSizeMetrics?.value + carSize
        )
      }

      return (
        afterBlobAddTotal?.value === beforeBlobAddTotal?.value + 1 &&
        afterUploadAddTotal?.value === beforeUploadAddTotal?.value + 1 &&
        afterBlobAddSizeTotal?.value === beforeBlobAddSizeTotal.value + carSize &&
        spaceAfterBlobAddMetrics?.value === spaceBeforeBlobAddMetrics?.value + 1 &&
        spaceAfterUploadAddMetrics?.value === spaceBeforeUploadAddMetrics?.value + 1 &&
        spaceAfterBlobAddSizeMetrics?.value === spaceBeforeBlobAddSizeMetrics?.value + carSize
      )
    })
  }
})
