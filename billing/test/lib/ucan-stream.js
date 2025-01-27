import { Schema } from '@ucanto/core'
import * as BlobCaps from '@storacha/capabilities/blob'
import * as SpaceBlobCaps from '@storacha/capabilities/space/blob'
import * as StoreCaps from '@storacha/capabilities/store'
import { parse as parseDID, decode as decodeDID } from '@ipld/dag-ucan/did'
import { findSpaceUsageDeltas, storeSpaceUsageDeltas } from '../../lib/ucan-stream.js'
import { randomConsumer } from '../helpers/consumer.js'
import { randomLink } from '../helpers/dag.js'
import { randomDID, randomDIDKey } from '../helpers/did.js'

/** @type {import('./api.js').TestSuite<import('./api.js').UCANStreamTestContext>} */
export const test = {
  'should filter UCANs': async (/** @type {import('entail').assert} */ assert, ctx) => {
    /** @type {import('../../lib/api.js').UcanStreamMessage[]} */
    const invocations = [{
      type: 'workflow',
      carCid: randomLink(),
      value: {
        att: [{
          with: await randomDID(),
          can: StoreCaps.list.can
        }],
        aud: await randomDID(),
        cid: randomLink()
      },
      ts: new Date()
    }]

    const shard = randomLink()

    /**
     * @type {import('../../lib/api.js').UcanReceiptMessage<[
     *   | import('@storacha/capabilities/types').BlobAccept
     *   | import('@storacha/capabilities/types').SpaceBlobRemove
     *   | import('@storacha/capabilities/types').StoreAdd
     *   | import('@storacha/capabilities/types').StoreRemove
     * ]>[]}
     */
    const receipts = [{
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: await randomDIDKey(),
          can: BlobCaps.accept.can,
          nb: {
            _put: {
              "ucan/await": [
                ".out.ok",
                randomLink()
              ]
            },
            blob: {
              digest: randomLink().multihash.bytes,
              size: 138
            },
            space: parseDID(await randomDIDKey())
          }
        }],
        aud: await randomDID(),
        cid: randomLink()
      },
      out: { ok: { site: randomLink() } },
      ts: new Date()
    }, {
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: await randomDIDKey(),
          can: SpaceBlobCaps.remove.can,
          nb: {
            digest: randomLink().multihash.bytes
          }
        }],
        aud: await randomDID(),
        cid: randomLink()
      },
      out: { ok: { size: 138 } },
      ts: new Date()
    }, {
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: await randomDIDKey(),
          can: StoreCaps.add.can,
          nb: {
            // @ts-expect-error different CID type per dep versions
            link: shard,
            size: 138
          }
        }],
        aud: await randomDID(),
        cid: randomLink()
      },
      out: { ok: { status: 'upload', allocated: 138 } },
      ts: new Date()
    }, {
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: await randomDIDKey(),
          can: StoreCaps.remove.can,
          // @ts-expect-error different CID type per dep versions
          nb: { link: shard }
        }],
        aud: await randomDID(),
        cid: randomLink()
      },
      out: { ok: { size: 138 } },
      ts: new Date()
    }]

    const deltas = findSpaceUsageDeltas([...invocations, ...receipts])
    assert.equal(deltas.length, receipts.length)

    // ensure we have a delta for every receipt
    for (const r of receipts) {
      assert.ok(deltas.some(d => (
        d.cause.toString() === r.invocationCid.toString() &&
        // resource for blob accept is found in the caveats
        (r.value.att[0].can === BlobCaps.accept.can
          ? d.resource === decodeDID(r.value.att[0].nb.space).did()
          : d.resource === r.value.att[0].with)
      )))
    }
  },
  'should store space diffs': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const consumer = await randomConsumer()

    await ctx.consumerStore.put(consumer)

    const from = new Date()

    /** @type {import('../../lib/api.js').UcanReceiptMessage<[import('@storacha/capabilities/types').StoreAdd]>[]} */
    const receipts = [{
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: Schema.did({ method: 'key' }).from(consumer.consumer),
          can: StoreCaps.add.can,
          nb: {
            // @ts-expect-error different CID type per dep versions
            link: randomLink(),
            size: 138
          }
        }],
        aud: consumer.provider,
        cid: randomLink()
      },
      out: { ok: { status: 'upload', allocated: 138 } },
      ts: new Date(from.getTime() + 1)
    }, {
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: Schema.did({ method: 'key' }).from(consumer.consumer),
          can: StoreCaps.add.can,
          nb: {
            // @ts-expect-error different CID type per dep versions
            link: randomLink(),
            size: 1138
          }
        }],
        aud: consumer.provider,
        cid: randomLink()
      },
      out: { ok: { status: 'upload', allocated: 1138 } },
      ts: new Date(from.getTime() + 2)
    }]

    const deltas = findSpaceUsageDeltas(receipts)
    const storeDeltasRes = await storeSpaceUsageDeltas(deltas, ctx)
    assert.ok(storeDeltasRes.ok)

    const res = await ctx.spaceDiffStore.list({
      provider: consumer.provider,
      space: consumer.consumer,
      from
    }, { size: receipts.length })
    assert.ok(res.ok)
    assert.equal(res.ok.results.length, receipts.length)

    // ensure we have a diff for every receipt
    for (const r of receipts) {
      assert.ok(res.ok.results.some(d => (
        d.cause.toString() === r.invocationCid.toString() &&
        d.provider === consumer.provider &&
        d.space === r.value.att[0].with &&
        d.subscription === consumer.subscription &&
        d.delta === r.value.att[0].nb?.size
      )))
    }
  },
  'should filter non-allocating store/add messages': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const consumer = await randomConsumer()

    await ctx.consumerStore.put(consumer)

    const from = new Date()

    /** @type {import('../../lib/api.js').UcanReceiptMessage<[import('@storacha/capabilities/types').StoreAdd]>[]} */
    const receipts = [{
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: Schema.did({ method: 'key' }).from(consumer.consumer),
          can: StoreCaps.add.can,
          nb: {
            // @ts-expect-error different CID type per dep versions
            link: randomLink(),
            size: 138
          }
        }],
        aud: consumer.provider,
        cid: randomLink()
      },
      // allocated: 0 indicates this shard was previously stored in this space
      out: { ok: { status: 'upload', allocated: 0 } },
      ts: new Date(from.getTime() + 1)
    }]

    const deltas = findSpaceUsageDeltas(receipts)
    const storeDeltasRes = await storeSpaceUsageDeltas(deltas, ctx)
    assert.equal(storeDeltasRes.ok, 'no space diffs to store')

    const res = await ctx.spaceDiffStore.list({
      provider: consumer.provider,
      space: consumer.consumer,
      from
    }, { size: 1000 })
    assert.ok(res.ok)
    assert.equal(res.ok.results.length, 0)
  }
}
