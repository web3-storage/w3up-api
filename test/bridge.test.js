import { fetch } from '@web-std/fetch'
import { base64url } from 'multiformats/bases/base64'
import * as Signature from '@ipld/dag-ucan/signature'
import { ed25519 } from '@ucanto/principal'
import { CBOR } from '@ucanto/core'
import * as dagJSON from '@ipld/dag-json'
import pWaitFor from 'p-wait-for'
import { test } from './helpers/context.js'
import {
  getApiEndpoint,
  getReceiptsEndpoint,
  getDynamoDb
} from './helpers/deployment.js'
import { randomFile } from './helpers/random.js'
import { createMailSlurpInbox, setupNewClient } from './helpers/up-client.js'

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    metricsDynamo: getDynamoDb('admin-metrics'),
    spaceMetricsDynamo: getDynamoDb('space-metrics'),
    rateLimitsDynamo: getDynamoDb('rate-limit')
  }
})

/**
 * 
 * @param {string} apiEndpoint 
 * @returns 
 */
async function getServicePublicKey(apiEndpoint) {
  const serviceInfoResponse = await fetch(`${apiEndpoint}/version`)
  const { publicKey } = await serviceInfoResponse.json()
  return publicKey
}

/**
 * 
 * @param {import('@storacha/client').Client} client 
 * @param {[import('@ucanto/interface').Capability, ...import('@ucanto/interface').Capability[]]} capabilities 
 * @param {number} expiration 
 * @param {string | undefined} password 
 * @returns 
 */
async function generateAuthHeaders(client, capabilities, expiration, password = 'i am the very model of a modern major general') {
  const coupon = await client.coupon.issue({
    capabilities,
    expiration,
    password
  })

  const { ok: bytes, error } = await coupon.archive()
  if (!bytes) {
    console.error(error)
    throw new Error(error.message)
  }
  return {
    'X-Auth-Secret': base64url.encode(new TextEncoder().encode(password)),
    'Authorization': base64url.encode(bytes)
  }
}

/**
 * 
 * @param {import('./helpers/context.js').Context} context 
 * @param {import('@storacha/client').Client} client 
 * @param {[import('@ucanto/interface').Capability, ...import('@ucanto/interface').Capability[]]} capabilities 
 * @param {number} expiration 
 * @param {any} requestBody 
 */
async function makeBridgeRequest(context, client, capabilities, expiration, requestBody) {
  return fetch(`${context.apiEndpoint}/bridge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...await generateAuthHeaders(
        client,
        capabilities,
        expiration
      )
    },
    body: dagJSON.stringify(requestBody),
  })
}

test('the bridge can make various types of requests', async t => {
  const inbox = await createMailSlurpInbox()
  const { client } = await setupNewClient(t.context.apiEndpoint, { inbox })
  const spaceDID = client.currentSpace()?.did()
  if (!spaceDID) {
    t.fail('client was set up but does not have a currentSpace - this is weird!')
    return
  }

  const response = await makeBridgeRequest(
    t.context, client,
    [{ can: 'upload/list', with: spaceDID }],
    Date.now() + (1000 * 60),
    {
      tasks: [
        ['upload/list', spaceDID, {}]
      ]
    }
  )

  t.deepEqual(response.status, 200)
  const receipts = dagJSON.parse(await response.text())
  t.deepEqual(receipts.length, 1)
  t.assert(receipts[0].p.out.ok)
  const result = receipts[0].p.out.ok
  t.deepEqual(result.results, [])
  t.deepEqual(result.size, 0)


  // verify that uploading a file changes the upload/list response
  // upload a file and wait for it to show up
  const file = await randomFile(42)
  const fileLink = await client.uploadFile(file, {
    receiptsEndpoint: getReceiptsEndpoint()
  })
  let secondReceipts
  await pWaitFor(async () => {
    const secondResponse = await makeBridgeRequest(
      t.context, client,
      [{ can: 'upload/list', with: spaceDID }],
      Date.now() + (1000 * 60),
      {
        tasks: [
          ['upload/list', spaceDID, {}]
        ]
      }
    )
    const response = await secondResponse.text()
    secondReceipts = dagJSON.parse(response)
    const result = secondReceipts[0].p.out.ok.results[0]
    return Boolean(result && result.root.equals(fileLink))
  }, {
    interval: 100,
  })

  t.assert(secondReceipts[0].p.out.ok)
  t.deepEqual(secondReceipts[0].p.out.ok.results.length, 1)
  // assert that the first item in the list is the item we just uploaded
  t.deepEqual(secondReceipts[0].p.out.ok.results[0].root.toString(), fileLink.toString())


  // verify expired requests fail
  const expiredResponse = await makeBridgeRequest(
    t.context, client,
    [{ can: 'upload/list', with: spaceDID }],
    0,
    {
      tasks: [
        ['upload/list', spaceDID, {}]
      ]
    }
  )
  const expiredReceipts = dagJSON.parse(await expiredResponse.text())
  t.assert(expiredReceipts[0].p.out.error)


  // ensure response is verifiable
  const payload = receipts[0].p
  const signature = Signature.view(receipts[0].s)

  // we need to get the service key out of band because the receipt
  // has a did:web as it's `iss` field but local development environments
  // use the `did:web:staging` DID backed by different keys and therefore aren't
  // resolvable using the normal `did:web` resolution algorithm
  const publicKey = await getServicePublicKey(t.context.apiEndpoint)
  const verifier = ed25519.Verifier.parse(publicKey)
  const verification = await signature.verify(verifier, CBOR.encode(payload))
  if (verification.error) {
    t.fail(verification.error.message)
    console.error(verification.error)
  }
  t.assert(verification.ok)
})

