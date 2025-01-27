import { PrincipalView } from '@ipld/dag-ucan'
import { Ability, DID, Delegation, Failure, Principal, Result, Receipt, OutcomeModel, Signature } from "@ucanto/interface"
import { ed25519 } from '@ucanto/principal'

export interface BridgeRequestContext {
  serviceDID: PrincipalView<DID>
  serviceURL: URL
}

export interface UnexpectedFailure extends Failure {}

export interface ParsedRequest {
  authorizationHeader?: string
  authSecretHeader?: string
  contentType?: string
  body?: ReadableStream
}

export type Task = [Ability, DID, Record<string, any>]

export type AuthSecretHeaderParsingFailure = UnexpectedFailure
export type AuthSecretHeaderParser = (headerValue: string) =>
  Promise<Result<ed25519.EdSigner, AuthSecretHeaderParsingFailure>>


export interface DelegationParsingError extends Failure {}
export type AuthorizationHeaderParsingFailure = DelegationParsingError | UnexpectedFailure
export type AuthorizationHeaderParser = (headerValue: string) =>
  Promise<Result<Delegation, AuthorizationHeaderParsingFailure>>

/**
 * The results of parsing a bridge request body.
 */
export interface BridgeRequestContent {
  /**
   * A list of tasks to be invoked
   */
  tasks: Task[]
}

export interface UnknownContentType extends Failure {}
export type BodyParsingFailure = UnknownContentType | UnexpectedFailure

export type BodyParser = (body: ReadableStream, contentType?: string) =>
  Promise<Result<BridgeRequestContent, BodyParsingFailure>>

export interface InvalidTask extends Failure {}
export type TaskParsingFailure = UnexpectedFailure
export type TaskParser = (task: unknown) =>
  Promise<Result<Task, TaskParsingFailure>>

export interface InvalidTasks extends Failure {}
export type TasksParsingFailure = InvalidTasks | UnexpectedFailure
export type TasksParser = (tasks: unknown) =>
  Promise<Result<Task[], TasksParsingFailure>>

export type TasksExecutionFailure = UnexpectedFailure
export type TaskReceipt = Receipt<any, TasksExecutionFailure>
export type TasksExecutor = (
  issuer: ed25519.EdSigner,
  servicePrincipal: Principal,
  serviceURL: URL,
  tasks: Task[],
  proof: Delegation
) => 
  Promise<Receipt<any, TasksExecutionFailure>[]>
  
export interface BridgeReceipt {
  p: OutcomeModel,
  s: Signature
}
export type BridgeReceiptFailure = UnexpectedFailure
export type BridgeReceiptBuilder = (receipts: TaskReceipt[]) => 
  Promise<Result<BridgeReceipt[], BridgeReceiptFailure>>
export type BridgeBodyBuilder = (receipts: BridgeReceipt[], accepts: string | undefined) => string

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
