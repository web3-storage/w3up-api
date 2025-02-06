import { Console } from "@storacha/capabilities"
import * as Receipt from "../../functions/receipt.js"
import { GetObjectCommand } from '@aws-sdk/client-s3'
import * as CAR from "@ucanto/transport/car"

/**
 * @type {import('../helpers/ucan.js').Tests}
 */
export const test = {
  'test receipt endpoint': async (assert, context) => {
    const log = await Console.log.invoke({
      issuer: context.signer,
      audience: context.connection.id,
      with: context.signer.did(),
      nb: {
        value: "hello world"
      }
    }).delegate()

    await context.provisionsStorage.put({
      cause: /** @type {any} */(log.link()),
      provider: /** @type {'did:web:stuff'} */(context.connection.id.did()),
      consumer: context.signer.toDIDKey(),
      customer: 'did:mailto:alice@web.mail'
    })

    const [result] = await context.connection.execute(log)
    assert.ok(result.out.ok)

    
    const receipt = await Receipt.receiptGet({
      pathParameters: {
        taskCid: log.link().toString()
      }
    }, {
      connection: { channel: context.s3.channel },
      region: `${context.s3.region}`,
      buckets: context.buckets
    })
    

    assert.deepEqual(receipt.statusCode, 302)
    const url = new URL(receipt.headers?.Location ?? '')


    const response = await context.s3.channel.send(new GetObjectCommand({
      Bucket: context.buckets.message.name,
      Key: url.pathname.slice(1)
    }))

    

    
    const message = await CAR.request.decode({
      headers: { 'content-type': CAR.contentType },
      body: /** @type {Uint8Array} */(await response.Body?.transformToByteArray())
    })

    assert.ok(message.receipts.get(`${log.link()}`), 'has receipt')
  }
}
