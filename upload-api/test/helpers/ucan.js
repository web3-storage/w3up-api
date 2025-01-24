import { invoke, delegate, Receipt, API, Message } from '@ucanto/core'
import * as CAR from '@ucanto/transport/car'
import * as Signer from '@ucanto/principal/ed25519'
import * as UcantoClient from '@ucanto/client'

import { stringToDelegation } from '@storacha/access/encoding';
import { connect, createServer } from '@storacha/upload-api';
import { DebugEmail } from '@storacha/upload-api/test';
import { createBucket, createTable } from '../helpers/resources.js';
import { storeTableProps, uploadTableProps, allocationTableProps, consumerTableProps, delegationTableProps, subscriptionTableProps, rateLimitTableProps, revocationTableProps, spaceMetricsTableProps, storageProviderTableProps, blobRegistryTableProps, adminMetricsTableProps } from '../../tables/index.js';
import { useBlobRegistry, useAllocationTableBlobRegistry } from '../../stores/blob-registry.js'
import { composeCarStoresWithOrderedHas } from '../../buckets/car-store.js';
import { useStoreTable } from '../../tables/store.js';
import { useUploadTable } from '../../tables/upload.js';
import { useProvisionStore } from '../../stores/provisions.js';
import { useConsumerTable } from '../../tables/consumer.js';
import { useSubscriptionTable } from '../../tables/subscription.js';
import { useDelegationsTable } from '../../tables/delegations.js';
import { useRevocationsTable } from '../../stores/revocations.js';
import { useDelegationsStore } from '../../buckets/delegations-store.js';
import { useRateLimitTable } from '../../tables/rate-limit.js';
import { useSpaceMetricsTable } from '../../tables/space-metrics.js';
import { createCustomerStore, customerTableProps } from '../../../billing/tables/customer.js';
import { usePlansStore } from '../../stores/plans.js';
import { useMetricsTable as useAdminMetricsStore } from '../../stores/metrics.js'
import { useMetricsTable as useSpaceMetricsStore } from '../../stores/space-metrics.js'
import { pieceTableProps } from '../../../filecoin/store/index.js';
import { usePieceTable } from '../../../filecoin/store/piece.js'
import { createTaskStore as createFilecoinTaskStore } from '../../../filecoin/store/task.js'
import { createReceiptStore as createFilecoinReceiptStore } from '../../../filecoin/store/receipt.js'
import * as AgentStore from '../../stores/agent.js'
import { createTestBillingProvider } from './billing.js';
import { useTestCarStore } from './buckets/car-store.js'
import { ClaimsService } from '@storacha/upload-api/test/external-service'
import { create as createRoutingService } from './external-services/router.js'
import { create as createStorageProvider } from './external-services/storage-provider.js'
import { create as createBlobRetriever } from '../../external-services/blob-retriever.js'
import { create as createIndexingServiceClient } from './external-services/indexing-service.js'
import { useStorageProviderTable } from '../../tables/storage-provider.js'

export { API }

/**
 * @param {API.Principal} audience
 */
export async function createSpace(audience) {
  const space = await Signer.generate()
  const spaceDid = space.did()

  return {
    proof: await UcantoClient.delegate({
      issuer: space,
      audience,
      capabilities: [{ can: '*', with: spaceDid }],
    }),
    spaceDid,
  }
}

/**
 * @param {API.Ability} can
 * @param {any} nb
 * @param {object} [options]
 * @param {Signer.EdSigner} [options.audience]
 * @param {Signer.EdSigner} [options.issuer]
 * @param {`did:key:${string}`} [options.withDid]
 * @param {Signer.Delegation[]} [options.proofs]
 */
export async function createUcanInvocation(can, nb, options = {}) {
  const audience = options.audience || (await Signer.generate())
  const issuer = options.issuer || (await Signer.generate())

  let proofs
  let withDid
  if (!options.withDid || !options.proofs) {
    const { proof, spaceDid } = await createSpace(issuer)

    proofs = [proof]
    withDid = spaceDid
  } else {
    proofs = options.proofs
    withDid = options.withDid
  }

  return await delegate({
    issuer,
    audience,
    capabilities: [
      {
        can,
        with: withDid,
        nb,
      },
    ],
    proofs,
  })
}

/**
 * Create an invocation with given capabilities.
 *
 * @param {API.Ability} can
 * @param {any} nb
 * @param {object} [options]
 * @param {Signer.EdSigner} [options.audience]
 * @param {Signer.EdSigner} [options.issuer]
 * @param {`did:key:${string}`} [options.withDid]
 * @param {Signer.Delegation[]} [options.proofs]
 */
export async function createInvocation(can, nb, options = {}) {
  const audience = options.audience || (await Signer.generate())
  const issuer = options.issuer || (await Signer.generate())

  let proofs
  let withDid
  if (!options.withDid || !options.proofs) {
    const { proof, spaceDid } = await createSpace(issuer)

    proofs = [proof]
    withDid = spaceDid
  } else {
    proofs = options.proofs
    withDid = options.withDid
  }

  const invocation = invoke({
    issuer,
    audience,
    capability: {
      can,
      with: withDid,
      nb,
    },
    proofs,
  })

  return invocation
}

/**
 * @param {API.IssuedInvocation} run
 * @param {object} options
 * @param {any} [options.result]
 * @param {any} [options.meta]
 */
export async function createAgentMessageReceipt(
  run,
  { result = { ok: {} }, meta = { test: 'metadata' } }
) {
  const delegation = await run.buildIPLDView()

  return await Receipt.issue({
    // @ts-ignore Mismatch between types for Principal and Signer
    issuer: run.audience,
    result,
    ran: delegation.link(),
    meta,
    fx: {
      fork: [],
    },
  })
}

/**
 * @param {object} source
 * @param {API.IssuedInvocation[]} [source.invocations]
 * @param {API.Receipt[]} [source.receipts]
 */
export const encodeAgentMessage = async (source) => {
  const message = await Message.build({
    invocations: /** @type {API.Tuple<API.IssuedInvocation>} */ (
      source.invocations
    ),
    receipts: /** @type {API.Tuple<API.Receipt>} */ (source.receipts),
  })

  return await CAR.request.encode(message)
}



/**
 * @typedef {import('@storacha/upload-api').Assert} Assert
 * @typedef {(assert: Assert, context: TestContext) => unknown} Test
 * @typedef {Record<string, Test>} Tests
 * @typedef {import('@storacha/upload-api').UcantoServerTestContext} UploadAPITestContext
 * @typedef {UploadAPITestContext & {
 * dynamo: import('@aws-sdk/client-dynamodb').DynamoDBClient
 * sqs: {
 *  channel: import('@aws-sdk/client-sqs').SQSClient
 * },
 * s3: {
 *  channel: import('@aws-sdk/client-s3').S3Client,
 *  region: string,
 * },
 * r2: {
 *  channel: import('@aws-sdk/client-s3').S3Client,
 *  region: string,
 * },
 * buckets: {
 *  index: { name: string }
 *  message: { name: string }
 * }
 * }} TestContext
 * 
 * @param {import('ava').ExecutionContext} t
 * @returns {Promise<TestContext>}
 */
export async function executionContextToUcantoTestServerContext(t) {
  const { dynamo, sqs, s3, r2 } = t.context;

  const carStoreBucketName = await createBucket(s3)
  const r2CarStoreBucketName = r2 ? await createBucket(r2) : undefined
  const delegationsBucketName = await createBucket(s3)
  const agentIndexBucketName = await createBucket(s3)
  const agentMessageBucketName = await createBucket(s3)

  const agentStore = AgentStore.open({
    store: {
      connection: { channel: s3 },
      region: 'us-west-2',
      buckets: {
        message: { name: agentMessageBucketName },
        index: { name: agentIndexBucketName },
      },
    },
    stream: {
      connection: { disable: {} },
      name: '',
    },
  })
  const spaceMetricsTableName = await createTable(dynamo, spaceMetricsTableProps)
  const adminMetricsTableName = await createTable(dynamo, adminMetricsTableProps)
  const metrics = {
    space: useSpaceMetricsStore(dynamo, spaceMetricsTableName),
    admin: useAdminMetricsStore(dynamo, adminMetricsTableName)
  }
  const blobRegistry = useBlobRegistry(
    dynamo,
    await createTable(dynamo, blobRegistryTableProps),
    metrics
  )
  const allocationTableName = await createTable(dynamo, allocationTableProps)
  const allocationBlobRegistry = useAllocationTableBlobRegistry(blobRegistry, dynamo, allocationTableName)
  const getServiceConnection = () => connection

  // To be deprecated
  const storeTable = useStoreTable(
    dynamo,
    await createTable(dynamo, storeTableProps)
  );

  const uploadTable = useUploadTable(
    dynamo,
    await createTable(dynamo, uploadTableProps),
    metrics
  );

  // To be deprecated
  const s3CarStoreBucket = await useTestCarStore(s3, carStoreBucketName)
  const r2CarStoreBucket = r2CarStoreBucketName
    ? await useTestCarStore(r2, r2CarStoreBucketName)
    : undefined
  const carStoreBucket = r2CarStoreBucket
    ? composeCarStoresWithOrderedHas(
      s3CarStoreBucket,
      r2CarStoreBucket,
    )
    : s3CarStoreBucket

  const signer = await Signer.Signer.generate();
  const id = signer.withDID('did:web:test.up.storacha.network');
  const aggregatorSigner = await Signer.Signer.generate();

  const storageProviderTable = useStorageProviderTable(
    dynamo,
    await createTable(dynamo, storageProviderTableProps)
  )
  const router = createRoutingService(storageProviderTable, id)

  const revocationsStorage = useRevocationsTable(
    dynamo,
    await createTable(dynamo, revocationTableProps)
  )
  const delegationsStorage = useDelegationsTable(
    dynamo,
    await createTable(dynamo, delegationTableProps),
    { bucket: useDelegationsStore(s3, delegationsBucketName) }
  );
  const rateLimitsStorage = useRateLimitTable(
    dynamo,
    await createTable(dynamo, rateLimitTableProps)
  )
  const subscriptionTable = useSubscriptionTable(
    dynamo,
    await createTable(dynamo, subscriptionTableProps)
  );
  const consumerTable = useConsumerTable(
    dynamo,
    await createTable(dynamo, consumerTableProps)
  );
  const spaceMetricsTable = useSpaceMetricsTable(
    dynamo,
    await createTable(dynamo, spaceMetricsTableProps)
  )
  const pieceStore = usePieceTable(
    dynamo,
    await createTable(dynamo, pieceTableProps)
  )
  const provisionsStorage = useProvisionStore(
    subscriptionTable,
    consumerTable,
    spaceMetricsTable,
    [id.did()]
  );
  const customersStore = createCustomerStore(dynamo, { tableName: await createTable(dynamo, customerTableProps) })
  const billingProvider = createTestBillingProvider()
  const plansStorage = usePlansStore(customersStore, billingProvider)
  const email = new DebugEmail();
  const claimsService = await ClaimsService.activate()
  const indexingServiceClient = createIndexingServiceClient(claimsService)
  const blobRetriever = createBlobRetriever(indexingServiceClient)

  const storageProviders = await Promise.all([
    createStorageProvider(storageProviderTable, claimsService, id),
    createStorageProvider(storageProviderTable, claimsService, id),
  ])

  /** @type {import('@storacha/upload-api').UcantoServerContext} */
  const serviceContext = {
    id,
    signer: id,
    email,
    url: new URL('http://example.com'),
    registry: allocationBlobRegistry,
    router,
    blobRetriever,
    agentStore,
    getServiceConnection,
    provisionsStorage,
    delegationsStorage,
    rateLimitsStorage,
    revocationsStorage,
    plansStorage,
    errorReporter: {
      catch(error) {
        t.fail(error.message);
      },
    },
    maxUploadSize: 5_000_000_000,
    // TODO: to be deprecated with `store/*` protocol
    storeTable,
    uploadTable,
    // TODO: to be deprecated with `store/*` protocol
    carStoreBucket,
    r2CarStoreBucket,
    claimsService,
    validateAuthorization: () => ({ ok: {} }),
    // filecoin/*
    aggregatorId: aggregatorSigner,
    pieceStore,
    taskStore: createFilecoinTaskStore(s3, agentIndexBucketName, agentMessageBucketName),
    receiptStore: createFilecoinReceiptStore(s3, agentIndexBucketName, agentMessageBucketName),
    // @ts-expect-error not tested here
    pieceOfferQueue: {},
    // @ts-expect-error not tested here
    filecoinSubmitQueue: {},
    options: {
      // TODO: we compute and put all pieces into the queue on bucket event
      // We may change this to validate user provided piece
      skipFilecoinSubmitQueue: true
    },
  };
  const connection = connect({
    id: serviceContext.id,
    channel: createServer(serviceContext)
  });

  return {
    ...serviceContext,
    carStoreBucket,
    storageProviders,
    claimsService,
    mail: email,
    grantAccess: (mail) => confirmConfirmationUrl(connection, mail),
    service: id,
    connection,
    fetch,

    dynamo,
    sqs: {
      channel: sqs
    },
    r2: {
      channel: r2,
      region: 'us-west-2',
    },
    s3: {
      channel: s3,
      region: 'us-west-2',
    },
    buckets: {
      index: { name: agentIndexBucketName },
      message: { name: agentMessageBucketName },
    },
  }
}

/**
 * @param {URL} confirmationUrl
 * @returns {Promise<API.Invocation<import('@storacha/capabilities/types').AccessConfirm>>}
 */
export async function extractConfirmInvocation(confirmationUrl) {
  const delegation = stringToDelegation(
    confirmationUrl.searchParams.get('ucan') ?? ''
  )
  if (
    delegation.capabilities.length !== 1 ||
    delegation.capabilities[0].can !== 'access/confirm'
  ) {
    throw new Error(`parsed unexpected delegation from confirmationUrl`)
  }
  const confirm =
    /** @type {API.Invocation<import('@storacha/capabilities/types').AccessConfirm>} */ (
      delegation
    )
  return confirm
}

/**
 * @param {API.ConnectionView<import('@storacha/access').Service>} connection
 * @param {{ url: string|URL }} confirmation
 */
export async function confirmConfirmationUrl(connection, confirmation) {
  // extract confirmation invocation from email that was sent by service while handling access/authorize
  const confirm = await extractConfirmInvocation(new URL(confirmation.url))
  // invoke the access/confirm invocation as if the user had clicked the email
  const [confirmResult] = await connection.execute(confirm)
  if (confirmResult.out.error) {
    throw confirmResult.out.error
  }
}
