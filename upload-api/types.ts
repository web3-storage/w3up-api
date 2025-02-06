import * as UCAN from '@ipld/dag-ucan'
import { DID, Delegation, UCANLink, ByteView, DIDKey, Result, Failure, Unit } from '@ucanto/interface'
import { UnknownLink } from 'multiformats'
import { CID } from 'multiformats/cid'
import { CarStoreBucket } from '@web3-storage/upload-api'
import { AccountDID, ProviderDID, Service, SpaceDID, PlanCreateAdminSessionSuccess, PlanCreateAdminSessionFailure, AgentStore } from '@storacha/upload-api'

export type {
  UnknownLink,
  AgentStore,
  AgentMessage,
  UCANLink,
  Capability,
  Result,
  WriteError,
  Writer,
  Unit,
  Link,
  Invocation,
  StorageGetError,
  ParsedAgentMessage,
  AgentMessageIndexRecord,
  Receipt,
  ReceiptModel,
  Accessor,
  Variant,
  ReceiptLink
} from '@storacha/upload-api'

export interface StoreOperationError extends Error {
  name: 'StoreOperationFailed'
}

export interface UcanLogCtx {
  basicAuth: string
  agentStore: AgentStore
}

export interface MetricsStore {
  incrementTotals: (metricsToUpdate: Record<string, number>) => Promise<void>
}

export interface MetricsCtx {
  metricsStore: MetricsStore
  carStore: CarStore
}

export interface SpaceMetricsItem {
  value: number
  space: string
}

export interface SpaceMetricsStore {
  incrementTotals: (metricsToUpdate: Record<string, SpaceMetricsItem[]>) => Promise<void>
}

export interface SpaceMetricsCtx {
  metricsStore: SpaceMetricsStore
  carStore: CarStore
}

export interface CarStore extends CarStoreBucket {
  getSize: (link: UnknownLink) => Promise<number>
}

export interface InvocationBucket {
  putWorkflowLink: (cid: string, workflowCid: string) => Promise<void>
  putReceipt: (cid: string, bytes: Uint8Array) => Promise<void>
  putInLink: (cid: string, workflowCid: string) => Promise<void>
  putOutLink: (cid: string, workflowCid: string) => Promise<void>
  getInLink: (cid: string) => Promise<string|undefined>
  getWorkflowLink: (cid: string) => Promise<string|undefined>
}

export interface TaskBucket {
  putResult: (taskCid: string, bytes: Uint8Array) => Promise<void>
  putInvocationLink: (taskCid: string, invocationCid: string) => Promise<void>
}

export interface WorkflowBucket {
  put: (Cid: string, bytes: Uint8Array) => Promise<void>
  get: (Cid: string) => Promise<Uint8Array|undefined>
}

export interface DelegationsBucket {
  /** put a delegation into the delegations bucket */
  put: (cid: CID, bytes: ByteView<Delegation>) => Promise<void>
  /** get a delegation from the delegations bucket */
  get: (cid: CID) => Promise<ByteView<Delegation>|undefined>
}

export interface MetricsTable {
  /**
   * Get all metrics from table.
   */
  get: () => Promise<Array<Record<string, any>>>
}


export interface SpaceMetricsTable {
  /**
   * Return the total amount of storage a space has used.
   */
  getAllocated: (consumer: DIDKey) => Promise<number>
}

export interface SubscriptionInput {
  /** DID of the customer who maintains this subscription */
  customer: DID,
  /** DID of the provider who services this subscription */
  provider: DID,
  /** ID of this subscription - should be unique per-provider */
  subscription: string,
  /** CID of the invocation that created this subscription */
  cause: UCANLink
}

export interface SubscriptionTable {
  get: (provider: ProviderDID, subscription: string) =>
    Promise<{ customer: DID } | null>
  /** add a subscription - a relationship between a customer and a provider that will allow for provisioning of consumers */
  add: (consumer: SubscriptionInput) => Promise<{}>
  /** return the count of subscriptions in the system */
  count: () => Promise<bigint>
  /** return a list of the subscriptions a customer has with a provider */
  findProviderSubscriptionsForCustomer: (customer: DID, provider: DID) =>
    Promise<Array<{ subscription: string }>>
}

export interface ConsumerInput {
  /** the DID of the consumer (eg, a space) for whom services are being provisioned */
  consumer: DID,
  /** DID of the customer who maintains the subscription for this consumer */
  customer: DID,
  /** the DID of the provider who will provide services for the consumer */
  provider: DID,
  /** the ID of the subscription representing the relationship between the consumer and provider */
  subscription: string,
  /** the CID of the UCAN invocation that created this record */
  cause: UCANLink
}

export interface ConsumerRecord {
  /** the ID of the subscription representing the relationship between the consumer and provider */
  subscription: string,
  /** the CID of the UCAN invocation that created this record */
  cause: UCANLink
}

export interface ConsumerListRecord {
  /** DID of the consumer (e.g. a space) for whom services have been provisioned. */
  consumer: SpaceDID
  /** DID of the provider who provides services for the consumer. */
  provider: ProviderDID
  /** ID of the subscription representing the relationship between the consumer and provider. */
  subscription: string
  /**
   * CID of the UCAN invocation that created this record.
   * Note: This became a required field after 2023-07-10T23:12:38.000Z.
   */
  cause?: UCANLink
}

export interface ConsumerTable {
  /** get a consumer record for a given provider */
  get: (provider: ProviderDID, consumer: DIDKey) => Promise<{ subscription: string, customer: AccountDID } | null>
  /** get a consumer record for a given subscription */
  getBySubscription: (provider: ProviderDID, subscription: string) => Promise<{ consumer: DID } | null>
  /** add a consumer - a relationship between a provider, subscription and consumer */
  add: (consumer: ConsumerInput) => Promise<{}>
  /** return the number of consumers */
  count: () => Promise<bigint>
  /** return a boolean indicating whether the given consumer has a storage provider */
  hasStorageProvider: (consumer: DID) => Promise<boolean>
  /** return a list of storage providers the given consumer has registered with */
  getStorageProviders: (consumer: DID) => Promise<ProviderDID[]>
  /** List consumers by customer account DID. */
  listByCustomer: (customer: AccountDID) => Promise<{ results: ConsumerListRecord[] }>
}

// TODO: unify this with RecordNotFound in ../billing/tables/lib.js
export interface RecordNotFound<K> extends Failure {
  name: 'RecordNotFound'
  key: K
}

// TODO unify this with Customer in ../billing/lib/api.ts
export interface Customer {
  product: string
  updatedAt: string
}

// TODO unify this with CustomerStore in ../billing/lib/api.ts
export interface CustomerTable {
  /** get a customer record */
  get: (customer: DID<'mailto'>) => Promise<Result<Customer, RecordNotFound<DID<'mailto'>>>>
}

export interface StorageProviderInput {
  provider: DID
  endpoint: URL
  proof: Delegation
  weight: number
}

export interface StorageProviderRecord {
  provider: DID
  endpoint: URL
  proof: Delegation
  weight: number
  insertedAt: Date
}

export interface StorageProviderTable {
  put (input: StorageProviderInput): Promise<void>
  get (provider: DID): Promise<StorageProviderRecord|undefined>
  del (provider: DID): Promise<void>
  list (): Promise<{ provider: DID, weight: number }[]>
}

export type SpaceService = Pick<Service, "space">

export type UcanStreamInvocationType = 'workflow' | 'receipt'

export interface UcanStreamInvocation {
  carCid: string
  invocationCid: string
  value: UcanInvocation
  ts: number
  type: UcanStreamInvocationType
  out?: Result
}

export interface UcanInvocation {
  att: UCAN.Capabilities
  aud: `did:${string}:${string}`
  iss: `did:${string}:${string}`
  cid: string
}

// would be generated by sst, but requires `sst build` to be run, which calls out to aws; not great for CI
declare module 'sst/node/config' {
  export interface SecretResources {
    PRIVATE_KEY: {
      value: string
    },
    UCAN_INVOCATION_POST_BASIC_AUTH: {
      value: string
    },
    STRIPE_SECRET_KEY: {
      value: string
    },
    INDEXING_SERVICE_PROOF: {
      value: string
    }
  }
}

export interface InvalidSubscriptionState extends Failure {
  name: 'InvalidSubscriptionState'
}

export interface BillingProviderUpdateError extends Failure {
  name: 'BillingProviderUpdateError'
}

type SetPlanFailure = InvalidSubscriptionState | BillingProviderUpdateError

export interface BillingProvider {
  hasCustomer: (customer: AccountDID) => Promise<Result<boolean, Failure>>
  setPlan: (customer: AccountDID, plan: DID) => Promise<Result<Unit, SetPlanFailure>>
  createAdminSession: (customer: AccountDID, returnURL: string) => Promise<Result<PlanCreateAdminSessionSuccess, PlanCreateAdminSessionFailure>>
}

export interface Referral {
  refcode: string
}

export interface ReferralsStore {
  getReferredBy: (email: string) => Promise<Referral>
}

export {}
