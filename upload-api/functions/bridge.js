import * as Sentry from '@sentry/serverless'
import { invoke, Delegation, sha256 } from '@ucanto/core'
import * as DID from '@ipld/dag-ucan/did'
import { connect } from '@ucanto/client'
import * as CAR from '@ucanto/transport/car'
import * as HTTP from '@ucanto/transport/http'
import { ed25519 } from '@ucanto/principal'
import { base64url } from 'multiformats/bases/base64'
import * as dagJSON from '@ipld/dag-json'
import * as dagCBOR from '@ipld/dag-cbor'
import { streamToArrayBuffer, stringToStream } from '../bridge/streams.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * 
 * @type {import('../bridge/types.js').AuthSecretHeaderParser}
 */
async function parseAuthSecretHeader(headerValue) {
  const secret = base64url.decode(headerValue)
  const { digest } = await sha256.digest(secret)
  return { ok: await ed25519.Signer.derive(digest) }
}

/**
 * @type {import('../bridge/types.js').AuthorizationHeaderParser}
 */
async function parseAuthorizationHeader(headerValue) {
  const result = await Delegation.extract(base64url.decode(headerValue))
  return result.ok ? result : {
    error: {
      name: 'DelegationParsingError',
      message: 'could not extract delegation from authorization header value',
      cause: result.error
    }
  }
}

/**
 * @type {import('../bridge/types.js').TaskParser}
 */
async function parseTask(maybeTask) {
  if (Array.isArray(maybeTask)) {
    return (maybeTask[0] && maybeTask[1] && maybeTask[2]) ? {
      // TODO: should we do more verification of the format of these arguments?
      // weird to have to cast twice, but TypeScript complains unless I cast back to unknown first
      ok: /** @type {import('../bridge/types.js').Task} */(/** @type {unknown} */(maybeTask))
    } : {
      error: {
        name: 'InvalidTask',
        message: 'maybeTask is missing one or more of the arguments required of a Task'
      }
    }
  } else {
    return {
      error: {
        name: 'InvalidTask',
        message: 'maybeTask is not an Array'
      }
    }
  }
}

/**
 * 
 * @type {import('../bridge/types.js').TasksParser}
 */
async function parseTasks(maybeTasks) {
  if (Array.isArray(maybeTasks)) {
    /**
     * @type {import('../bridge/types.js').Task[]}
     */
    const tasks = []
    for (const maybeTask of maybeTasks) {
      const taskResult = await parseTask(maybeTask)
      if (taskResult.ok) {
        tasks.push(taskResult.ok)
      } else {
        return {
          error: taskResult.error
        }
      }
    }
    return { ok: tasks }
  } else {
    return {
      error: {
        name: 'InvalidTasks',
        message: 'maybeTasks is not an array'
      }
    }
  }
}

/**
 * @type {import('../bridge/types.js').BodyParser}
 */
async function parseBody(body, contentType) {
  const bodyBytes = await streamToArrayBuffer(body)
  let parsedBody
  try {
    if (!contentType || contentType === 'application/json' || contentType === 'application/vnd.ipld.dag-json') {
      parsedBody = dagJSON.decode(bodyBytes)
    } else if (contentType === 'application/cbor' || contentType === 'application/vnd.ipld.dag-cbor') {
      parsedBody = dagCBOR.decode(bodyBytes)
    } else {
      return {
        error: {
          name: 'UnknownContentType',
          message: `${contentType} is not supported`
        }
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: {
        name: 'UnexpectedError',
        message: err.message
      }
    }
  }
  const tasksResult = await parseTasks(parsedBody.tasks)
  return (tasksResult.ok) ? {
    ok: { tasks: tasksResult.ok }
  } : {
    error: tasksResult.error
  }
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 * @returns {import('../bridge/types.js').ParsedRequest}
 */
function parseAwsLambdaRequest(request) {
  const authSecretHeader = request.headers['x-auth-secret']
  const authorizationHeader = request.headers.authorization
  const contentType = request.headers['content-type']
  const body = request.body !== undefined ? stringToStream(request.body) : request.body
  return { authorizationHeader, authSecretHeader, body, contentType }
}

/**
 * 
 * @type {import('../bridge/types.js').BridgeReceiptBuilder}
 */
async function buildBridgeReceipts(receipts) {
  /** @type {import('../bridge/types.js').BridgeReceipt[]} */
  const bridgeReceipts = []
  for (const receipt of receipts) {
    if (receipt.root.data) {
      bridgeReceipts.push({
        p: receipt.root.data.ocm,
        s: receipt.root.data.sig
      })
    } else {
      return {
        error: {
          name: 'BridgeReceiptFailure',
          message: 'One of the receipts contains no data'
        }
      }
    }
  }
  return { ok: bridgeReceipts }
}

/**
 * @type {import('../bridge/types.js').BridgeBodyBuilder}
 */
function serializeBridgeReceipts(receipts) {
  // TODO: use second parameter to pick serialization format
  return dagJSON.stringify(receipts)
}

/**
 * 
 * @type {import('../bridge/types.js').TasksExecutor}
 */
export async function invokeAndExecuteTasks(
  issuer, servicePrincipal, serviceURL, tasks, delegation
) {
  const invocations = tasks.map((task) => invoke({
    issuer,
    audience: servicePrincipal,
    capability: {
      can: task[0],
      with: task[1],
      nb: task[2]
    },
    proofs: [delegation]
  }))
  /**
   * @type {import('@ucanto/interface').ConnectionView<import('@storacha/upload-api').Service>}
   */
  const connection = connect({
    id: servicePrincipal,
    codec: CAR.outbound,
    channel: HTTP.open({
      url: serviceURL,
      method: 'POST'
    })
  })
  // this is an annoying hack to make typescript happy - it wants at LEAST one argument and needs
  // to be assured that that's the case
  const [firstInvocation, ...restOfInvocations] = invocations
  // @ts-ignore multiple issues here
  return connection.execute(firstInvocation, ...restOfInvocations)
}



/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {import('../bridge/types.js').BridgeRequestContext} context
 */
export async function handleBridgeRequest(request, context) {
  try {
    const { authSecretHeader, authorizationHeader, body, contentType } = parseAwsLambdaRequest(request)

    if (!authorizationHeader) {
      return {
        statusCode: 401,
        body: 'request missing Authorization header'
      }
    }

    if (!authSecretHeader) {
      return {
        statusCode: 401,
        body: 'request missing X-Auth-Secret header'
      }
    }

    if (!body) {
      return {
        statusCode: 400,
        body: 'request has no body'
      }
    }

    const parseAuthSecretResult = await parseAuthSecretHeader(authSecretHeader)

    if (parseAuthSecretResult.error) {
      return {
        statusCode: 401,
        body: parseAuthSecretResult.error.message
      }
    }
    const issuer = parseAuthSecretResult.ok

    const parseAuthorizationResult = await parseAuthorizationHeader(authorizationHeader)
    if (parseAuthorizationResult.error) {
      return {
        statusCode: 401,
        body: parseAuthorizationResult.error.message
      }
    }
    const delegation = parseAuthorizationResult.ok


    const parseBodyResult = await parseBody(body, contentType)
    if (parseBodyResult.error) {
      return {
        statusCode: 400,
        body: parseBodyResult.error.message
      }
    }
    const tasks = parseBodyResult.ok.tasks
    const receipts = await invokeAndExecuteTasks(
      issuer,
      context.serviceDID,
      context.serviceURL,
      tasks,
      delegation
    )

    const bridgeReceipts = await buildBridgeReceipts(receipts)
    return bridgeReceipts.ok ? {
      statusCode: 200,
      headers: {
        "Content-Type": "application/vnd.ipld.dag-json"
      },
      body: serializeBridgeReceipts(bridgeReceipts.ok, request.headers.accepts)
    } : {
      statusCode: 500,
      body: bridgeReceipts.error.message
    }
  } catch (/** @type {any} */ error) {
    console.error(error)
    return {
      statusCode: error.status ?? 500,
      body: Buffer.from(error.message).toString('base64'),
      isBase64Encoded: true,
    }
  }
}

/**
 * 
 * @returns {import('aws-lambda').Handler}
 */
function createBridgeHandler() {
  const { UPLOAD_API_DID, ACCESS_SERVICE_URL } = process.env

  if (!UPLOAD_API_DID) {
    throw new Error('UPLOAD_API_DID is not set')
  }
  const serviceDID = DID.parse(UPLOAD_API_DID)

  if (!ACCESS_SERVICE_URL) {
    throw new Error('ACCESS_SERVICE_URL is not set')
  }
  const serviceURL = new URL(ACCESS_SERVICE_URL)
  /**
   * @type {import('../bridge/types.js').BridgeRequestContext}
   */
  const context = {
    serviceDID,
    serviceURL
  }
  return (request) => handleBridgeRequest(request, context)
}

export const handler = Sentry.AWSLambda.wrapHandler(createBridgeHandler())
