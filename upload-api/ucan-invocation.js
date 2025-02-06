import * as CAR from '@ucanto/transport/car'
import * as Link from 'multiformats/link'
import { AgentMessage } from '@storacha/upload-api'

import {
  BadBodyError,
  BadContentTypeError,
  NoTokenError,
  ExpectedBasicStringError,
  NoValidTokenError,
} from './errors.js'

export const CONTENT_TYPE = CAR.contentType

/** @typedef {import('./types.js').UcanLogCtx} UcanLogCtx */

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {UcanLogCtx} ctx
 */
export async function processUcanLogRequest(request, ctx) {
  const token = getTokenFromRequest(request)
  if (token !== ctx.basicAuth) {
    throw new NoValidTokenError('invalid Authorization credentials provided')
  }

  if (!request.body) {
    throw new BadBodyError('service requests are required to have body')
  }
  const bytes = Buffer.from(request.body, 'base64')

  const contentType = request.headers['content-type'] || ''
  if (contentType === CONTENT_TYPE) {
    const request = {
      body: bytes,
      headers: {
        'content-type': contentType,
      },
    }
    const message = await CAR.request.decode(request)

    const result = await ctx.agentStore.messages.write({
      source: request,
      data: message,
      index: AgentMessage.index(message)
    })

    if (result.error) {
      throw result.error
    }

    return result.ok
  }

  throw new BadContentTypeError()
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
function getTokenFromRequest(request) {
  const authHeader = request.headers.authorization || ''
  if (!authHeader) {
    throw new NoTokenError('no Authorization header provided')
  }

  const token = parseAuthorizationHeader(authHeader)
  return token
}

/**
 * @param {string} header
 */
function parseAuthorizationHeader(header) {
  if (!header.toLowerCase().startsWith('basic ')) {
    throw new ExpectedBasicStringError('no basic Authorization header provided')
  }

  return header.slice(6)
}

/**
 * @param {any} value
 */
export const replaceAllLinkValues = (value) => {
  // Array with Links?
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (Link.isLink(value[i])) {
        value[i] = toJSON(value[i])
      } else {
        replaceAllLinkValues(value[i])
      }
    }
  }
  // Object with Links?
  else if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (Link.isLink(value[key])) {
        value[key] = toJSON(value[key])
      }
      replaceAllLinkValues(value[key])
    }
  }

  return value
}

/**
 * @template {import('multiformats').UnknownLink} Link
 * @param {Link} link
 */
export const toJSON = (link) =>
  /** @type {import('@storacha/upload-api').LinkJSON<Link>} */ ({
    '/': link.toString(),
  })
