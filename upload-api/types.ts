import * as UCAN from '@ipld/dag-ucan'
import { DID, Link, Delegation, Signature, Block, UCANLink } from '@ucanto/interface'
import { UnknownLink } from 'multiformats'
import { CID } from 'multiformats/cid'
import { Kinesis } from '@aws-sdk/client-kinesis'


export interface UcanLogCtx extends WorkflowCtx, ReceiptBlockCtx {
  basicAuth: string
}

export interface UcanStreamCtx {
  streamName: string
  kinesisClient?: Kinesis
}

export interface WorkflowCtx extends UcanStreamCtx {
  invocationBucket: InvocationBucket
  taskBucket: TaskBucket
  workflowBucket: WorkflowBucket
}

export interface ReceiptBlockCtx extends UcanStreamCtx {
  invocationBucket: InvocationBucket
  taskBucket: TaskBucket
  workflowBucket: WorkflowBucket
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
  put: (cid: CID, bytes: Uint8Array) => Promise<void>
  get: (cid: CID) => Promise<Uint8Array|undefined>
}

export interface SubscriptionInput {
  customer: DID,
  provider: DID,
  order: string,
  cause: UCANLink
}

export interface Subscription {

}

export interface SubscriptionTable {
  insert: (consumer: SubscriptionInput) => Promise<Subscription>
}

export interface ConsumerInput {
  consumer: DID,
  provider: DID,
  order: string,
  cause: UCANLink
}

export interface Consumer {

}

export interface ConsumerTable {
  insert: (consumer: ConsumerInput) => Promise<Consumer>
}

export interface UcanInvocation {
  att: UCAN.Capabilities
  aud: `did:${string}:${string}`
  iss: `did:${string}:${string}`
  cid: string
}

export interface Workflow {
  cid: UnknownLink
  bytes: Uint8Array
  invocations: UcanInvocation[]
}

// TODO: Remove once in ucanto
export interface Receipt {
  ran: Link
  out: ReceiptResult
  meta: Record<string, unknown>
  iss?: DID
  prf?: Array<Link<Delegation>>
  s: Signature
}

// TODO: Remove once in ucanto
export interface ReceiptBlock extends Block<Receipt> {
  data: Receipt
}

// TODO: Remove once in ucanto
/**
 * Defines result type as per invocation spec
 *
 * @see https://github.com/ucan-wg/invocation/#6-result
 */
export type ReceiptResult<T = unknown, X extends {} = {}> = Variant<{
  ok: T
  error: X
}>

// TODO: Remove once in ucanto
export type Variant<U extends Record<string, unknown>> = {
  [Key in keyof U]: { [K in Exclude<keyof U, Key>]?: never } & {
    [K in Key]: U[Key]
  }
}[keyof U]

// would be generated by sst, but requires `sst build` to be run, which calls out to aws; not great for CI
declare module '@serverless-stack/node/config' {
  export interface SecretResources {
    PRIVATE_KEY: {
      value: string
    },
    UCAN_INVOCATION_POST_BASIC_AUTH: {
      value: string
    }
  }
}

export {}
