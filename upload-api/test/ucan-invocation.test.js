import { s3 as test } from './helpers/context.js'

import * as AgentStore from '../stores/agent.js'
import * as Stream from '../stores/agent/stream.js'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
// eslint-disable-next-line no-unused-vars
import { Receipt, API } from '@ucanto/core'
import * as CAR from '@ucanto/transport/car'
import { add as storeAdd } from '@storacha/capabilities/store'
import { add as uploadAdd } from '@storacha/capabilities/upload'
import { toString } from 'uint8arrays/to-string'
// @ts-expect-error
import lambdaUtils from 'aws-lambda-test-utils'

import { createS3, createBucket } from './helpers/resources.js'
import { randomCAR } from './helpers/random.js'
import {
  createSpace,
  createUcanInvocation,
  createInvocation,
  createAgentMessageReceipt,
  encodeAgentMessage,
} from './helpers/ucan.js'


import {
  processUcanLogRequest,
  replaceAllLinkValues
} from '../ucan-invocation.js'

/**
 * @typedef {API.IssuedInvocation} IssuedInvocation
 * @typedef {API.Tuple<IssuedInvocation>} Invocation
 */

test.before(async (t) => {
  const { client: s3 } = await createS3({
    port: 9000,
  })

  t.context.s3 = s3
})

test('processes agent message as CAR with multiple invocations', async (t) => {
  t.plan(18)
  const kinesis = {
    /**
     * @param {any} input 
     */
    putRecords: (input) => {
      t.is(input.StreamName, agentStore.connection.stream.name)
      t.is(input.Records?.length, invocations.length)
      for (const record of input.Records || []) {
        if (!record.Data) {
          throw new Error('must have Data')
        }
        const invocation = JSON.parse(toString(record.Data))
        t.truthy(invocation)
        t.truthy(invocation.ts)
        t.is(invocation.type,  Stream.defaults.workflow.type)
        t.is(invocation.carCid, agentMessageCarCid)

        const cap = capabilities.find(
          (cap) => cap.can === invocation.value.att[0].can
        )
        t.truthy(cap)
        t.deepEqual(
          replaceAllLinkValues(cap?.nb),
          invocation.value.att[0].nb
        )
      }

      return Promise.resolve()
    }
  }

  const { agentStore } = await getStores({
    ...t.context,
    streamName: 'stream-name',
    kinesis: { channel: kinesis }
  })
  const basicAuth = 'test-token'

  // Create agent message with two invocations
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const capabilities = [
    {
      can: storeAdd.can,
      nb: { link, size: data.byteLength },
    },
    {
      can: uploadAdd.can,
      nb: { root: link },
    },
  ]

  const invocations = await Promise.all(
    capabilities.map((cap) =>
      createInvocation(cap.can, cap.nb, {
        issuer: alice,
        audience: uploadService,
        withDid: spaceDid,
        proofs: [proof],
      })
    )
  )

  const request = await encodeAgentMessage({ invocations })

  // Create request with car
  const carRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': request.headers['content-type'],
    },
    body: toString(request.body, 'base64'),
  })

  // Decode request for expectations
  const decodedCar = await CAR.codec.decode(new Uint8Array(request.body.buffer))
  const agentMessageCarCid = decodedCar.roots[0].cid.toString()
  const agentMessage = await CAR.request.decode(request)

  await t.notThrowsAsync(() =>
    processUcanLogRequest(carRequest, {
      agentStore,
      basicAuth
    })
  )

  // Minio might take a bit
  await new Promise((resolve) => setTimeout(() => resolve(true), 100))

  // Verify CAR agent message persisted
  const cmd = new HeadObjectCommand({
    Key: `${agentMessageCarCid}/${agentMessageCarCid}`,
    Bucket: agentStore.connection.store.buckets.message.name,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify invocation symlink for car agent message stored
  for (const invocation of agentMessage.invocations) {
    const cmdInvocationStored = new HeadObjectCommand({
      Key: `${invocation.cid}/${invocation.cid}@${agentMessageCarCid}.in`,
      Bucket: agentStore.connection.store.buckets.index.name,
    })
    const s3ResponseInvocationStored = await t.context.s3.send(
      cmdInvocationStored
    )
    t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)
  }
})

test('processes agent message as CAR with receipt', async (t) => {
  t.plan(12)
  const kinesis = {
    // @ts-expect-error not same return type
    putRecords: (input) => {
      for (const record of input.Records || []) {
        if (!record.Data) {
          throw new Error('must have Data')
        }

        kinesisWorkflowInvocations?.push(JSON.parse(toString(record.Data)))
      }
      return Promise.resolve()
    }
  }

  const { agentStore } = await getStores({
    ...t.context,
    streamName: 'stream-name',
    kinesis: { channel: kinesis }
  })
  const basicAuth = 'test-token'

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  // Create message with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const capabilities = [
    {
      can: storeAdd.can,
      nb: { link, size: data.byteLength },
    },
  ]

  const invocations = await Promise.all(
    capabilities.map((cap) =>
      createInvocation(cap.can, cap.nb, {
        issuer: alice,
        audience: uploadService,
        withDid: spaceDid,
        proofs: [proof],
      })
    )
  )

  const request = await encodeAgentMessage({ invocations })

  // Create request with car
  const carInvocationsRequest =
    lambdaUtils.mockEventCreator.createAPIGatewayEvent({
      headers: {
        authorization: `Basic ${basicAuth}`,
        'content-type': request.headers['content-type'],
      },
      body: toString(request.body, 'base64'),
    })

  // process ucan log request for message
  /** @type {any[]} */
  const kinesisWorkflowInvocations = []
  await t.notThrowsAsync(() =>
    processUcanLogRequest(carInvocationsRequest, {
      agentStore,
      basicAuth,
    })
  )

  // Create receipts
  const result = {
    ok: {
      deleted: true,
    },
  }
  const receipts = await Promise.all(
    invocations.map((i) =>
      createAgentMessageReceipt(i, {
        result,
      })
    )
  )

  const response = await encodeAgentMessage({ receipts })

  // Decode request for expectations
  const decodedCarReceipts = await CAR.codec.decode(
    new Uint8Array(response.body.buffer)
  )
  const agentMessageCarReceiptsCid = decodedCarReceipts.roots[0].cid.toString()
  const agentMessageReceipts = await CAR.request.decode(response)
  const invocationCid = [...agentMessageReceipts.receipts.values()][0].ran
    .link()
    .toString()

  // Create request with car
  const carReceiptsRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent(
    {
      headers: {
        authorization: `Basic ${basicAuth}`,
        'content-type': response.headers['content-type'],
      },
      body: toString(response.body, 'base64'),
    }
  )

  kinesis.putRecords = (input) => {
    t.is(input.StreamName, agentStore.connection.stream.name)
    t.is(input.Records?.length, receipts.length)
    for (const record of input.Records || []) {
      if (!record.Data) {
        throw new Error('must have Data')
      }
      const data = JSON.parse(toString(record.Data))
      t.truthy(data)
      t.is(data.carCid, agentMessageCarReceiptsCid.toString())
      t.is(data.task, invocationCid)
      t.is(data.type, agentStore.connection.stream.receipt.type)
      t.deepEqual(data.out, result)
      t.deepEqual(data.value, kinesisWorkflowInvocations[0].value)
    }
    return Promise.resolve()
  }

  // process ucan log request for message
  /** @type {any[]} */
  await t.notThrowsAsync(() =>
    processUcanLogRequest(carReceiptsRequest, {
      agentStore,
      basicAuth
  }))

  // Verify CAR agent message persisted
  const cmd = new HeadObjectCommand({
    Key: `${agentMessageCarReceiptsCid}/${agentMessageCarReceiptsCid}`,
    Bucket: agentStore.connection.store.buckets.message.name,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify receipts
  for (const receipt of agentMessageReceipts.receipts.values()) {
    const invocationCid = receipt.ran.link().toString()

    // Verify receipt symlink for car agent message stored
    const cmdInvocationStored = new HeadObjectCommand({
      Key: `${invocationCid}/${receipt.link()}@${agentMessageCarReceiptsCid}.out`,
      Bucket: agentStore.connection.store.buckets.index.name,
    })
    const s3ResponseInvocationStored = await t.context.s3.send(
      cmdInvocationStored
    )
    t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)
  }
})

test('fails to process agent message as CAR with receipt when there is no invocation previously stored', async (t) => {
  const kinesis = {
    putRecords: () => {
      return Promise.resolve()
    },
  }

  const { agentStore } = await getStores({
    ...t.context,
    streamName: 'stream-name',
    kinesis: { channel: kinesis },
  })
  const basicAuth = 'test-token'

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  // Create message with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const capabilities = [
    {
      can: storeAdd.can,
      nb: { link, size: data.byteLength },
    },
  ]

  const invocations = await Promise.all(
    capabilities.map((cap) =>
      createInvocation(cap.can, cap.nb, {
        issuer: alice,
        audience: uploadService,
        withDid: spaceDid,
        proofs: [proof],
      })
    )
  )

  // Create receipts
  const result = {
    ok: {
      deleted: true,
    },
  }
  const receipts = await Promise.all(
    invocations.map((i) =>
      createAgentMessageReceipt(i, {
        result,
      })
    )
  )

  const message = await encodeAgentMessage({ receipts })

  // Create request with car
  const carReceiptsRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent(
    {
      headers: {
        authorization: `Basic ${basicAuth}`,
        'content-type': message.headers['content-type'],
      },
      body: toString(message.body, 'base64'),
    }
  )

  // fails to process ucan log request for message
  /** @type {any[]} */
  await t.throwsAsync(() =>
    processUcanLogRequest(carReceiptsRequest, {
      agentStore,
      basicAuth,
    })
  )
})

test('can process ucan log request for given receipt after its invocation stored', async (t) => {
  const kinesis = {
    // @ts-expect-error not same return type
    putRecords: (input) => {
      for (const record of input.Records || []) {
        if (!record.Data) {
          throw new Error('must have Data')
        }

        kinesisWorkflowInvocations?.push(JSON.parse(toString(record.Data)))
      }
      return Promise.resolve()
    },
  }

  const { agentStore } = await getStores({
    ...t.context,
    streamName: 'stream-name',
    kinesis: { channel: kinesis }
  })
  const basicAuth = 'test-token'
  const uploadService = await Signer.generate()

  // Create workflow with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const invocation = await createUcanInvocation(storeAdd.can, {
    link,
    size: data.byteLength,
  })

  const workflow = await encodeAgentMessage({
    invocations: [invocation],
  })
  const message = await CAR.request.decode(workflow)

  const invocationCid = message.invocations[0].cid

  t.deepEqual(invocationCid.bytes, invocation.link().bytes)

  // Create Workflow request with car
  const workflowRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      ...workflow.headers,
      authorization: `Basic ${basicAuth}`,
    },
    body: toString(workflow.body, 'base64'),
  })

  // process ucan log request for workflow
  /** @type {any[]} */
  const kinesisWorkflowInvocations = []
  await t.notThrowsAsync(() =>
    processUcanLogRequest(workflowRequest, {
      agentStore,
      basicAuth
    })
  )

  // create receipt
  const out = { ok: 'Done' }
  const receipt = await Receipt.issue({
    issuer: uploadService.signer,
    result: out,
    ran: invocationCid,
  })
  const receiptWorkflow = await encodeAgentMessage({ receipts: [receipt] })
  const receiptArchive = await CAR.request.decode(receiptWorkflow)
  const decodedCarReceipts = await CAR.codec.decode(
    /** @type {Uint8Array} */(receiptWorkflow.body)
  )
  const agentMessageCarReceiptsCid = decodedCarReceipts.roots[0].cid.toString()
  const receiptRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      ...receiptWorkflow.headers,
    },
    body: toString(receiptWorkflow.body, 'base64'),
  })

  kinesis.putRecords = (input) => {
    t.is(input.StreamName, agentStore.connection.stream.name)
    t.is(input.Records?.length, 1)

    const [record] = input.Records || []
    const data = JSON.parse(
      toString(/** @type {Uint8Array} */(record.Data))
    )
    t.truthy(data)
    t.is(data.carCid, receiptArchive.root.cid.toString())
    t.is(data.task, invocationCid.toString())
    t.is(data.type, agentStore.connection.stream.receipt.type)
    t.deepEqual(data.out, out)
    t.deepEqual(data.value, kinesisWorkflowInvocations[0].value)
    return Promise.resolve()
  }

  // process ucan log request for receipt
  await t.notThrowsAsync(() =>
    processUcanLogRequest(receiptRequest, {
      agentStore,
      basicAuth
    })
  )

  // Verify CAR agent message persisted
  const cmd = new HeadObjectCommand({
    Key: `${agentMessageCarReceiptsCid}/${agentMessageCarReceiptsCid}`,
    Bucket: agentStore.connection.store.buckets.message.name,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify receipt symlink for car agent message stored
  const cmdInvocationStored = new HeadObjectCommand({
    Key: `${invocationCid}/${receipt.link()}@${agentMessageCarReceiptsCid}.out`,
    Bucket: agentStore.connection.store.buckets.index.name
  })
  const s3ResponseInvocationStored = await t.context.s3.send(
    cmdInvocationStored
  )
  t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)
})

test('fails to process ucan log request with no Authorization header', async (t) => {
  const { agentStore } = await getStores({
    ...t.context,
    streamName: 'name',
    kinesis: { disable: {} }
  })
  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent()

  await t.throwsAsync(() =>
    processUcanLogRequest(request, {
      agentStore,
      basicAuth,
    })
  )
})

test('fails to process ucan log request with no Authorization basic header', async (t) => {
  const { agentStore } = await getStores({
    ...t.context,
    streamName: 'name',
    kinesis: { disable: {} }
  })

  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: 'Bearer token-test',
    },
  })

  await t.throwsAsync(() =>
    processUcanLogRequest(request, {
      agentStore,
      basicAuth,
    })
  )
})

test('fails to process ucan log request with Authorization basic token empty', async (t) => {
  const { agentStore } = await getStores({
    ...t.context,
    streamName: 'name',
    kinesis: { disable: {} }
  })
  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: 'Basic',
    },
  })

  await t.throwsAsync(() =>
    processUcanLogRequest(request, {
      agentStore,
      basicAuth,
    })
  )
})

test('fails to process ucan log request with invalid Authorization basic token', async (t) => {
  const { agentStore } = await getStores({
    ...t.context,
    streamName: 'name',
    kinesis: { disable: {} }
  })
  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: 'Basic invalid-token',
    },
  })

  await t.throwsAsync(() =>
    processUcanLogRequest(request, {
      agentStore,
      basicAuth,
    })
  )
})

test('replace all link values as object and array', async (t) => {
  const car = await randomCAR(128)
  const otherCar = await randomCAR(40)

  // invoke a upload/add with proof
  const root = car.roots[0]
  const shards = [car.cid, otherCar.cid].sort()

  const att = [
    {
      nb: {
        link: root,
        size: car.size,
      },
      can: 'store/add',
      with: 'did:key:z6MkfTDbhRZz26kcDNmmehPxeujSkbXe8jqv5fLpKvtc3Wcv',
    },
    {
      nb: {
        root,
        shards: [...shards],
      },
      can: 'upload/add',
      with: 'did:key:z6MkfTDbhRZz26kcDNmmehPxeujSkbXe8jqv5fLpKvtc3Wcv',
    },
  ]

  att.map(replaceAllLinkValues)

  // Object with Link
  // @ts-expect-error Property '/' does not exist on type 'Link<Partial<Model>
  t.is(att[0].nb.link['/'], root.toString())
  // @ts-expect-error Property '/' does not exist on type 'Link<Partial<Model>
  t.is(att[1].nb.root['/'], root.toString())

  // Array with Link
  t.deepEqual(
    // @ts-expect-error Property '/' does not exist on type 'Link<Partial<Model>
    att[1].nb.shards?.map((s) => s['/']),
    shards.map((s) => s.toString())
  )
})

/**
 * @param {{ s3: any; kinesis: any; streamName?: string }} ctx
 */
async function getStores(ctx) {
  const { invocationBucketName, workflowBucketName } =
    await prepareResources(ctx.s3)

  const agentStore = AgentStore.open({
    store: {
      connection: {
        channel: ctx.s3
      },
      region: 'us-west-2',
      buckets: {
        message: { name: workflowBucketName },
        index: { name: invocationBucketName }
      }
    },
    stream: {
      name: ctx.streamName ?? 'stream-name',
      connection: ctx.kinesis
    }
  })

  return {
    agentStore,
  }
}


/**
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 */
async function prepareResources(s3Client) {
  const invocationBucketName = await createBucket(s3Client)
  const workflowBucketName = await createBucket(s3Client)

  return {
    invocationBucketName,
    workflowBucketName,
  }
}
