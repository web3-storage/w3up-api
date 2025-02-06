import { sha256 } from 'multiformats/hashes/sha2'
import { equals } from 'multiformats/bytes'
import { webcrypto } from '@storacha/one-webcrypto'
import { publishBlockAdvertisement } from '../lib/block-advert-publisher.js'
import { bindTestContext, createBlockAdvertPublisherTestContext } from './helpers/context.js'
import { collectQueueMessages } from './helpers/queue.js'

export const test = bindTestContext({
  'should publish all multihashes in advert': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const entries = await Promise.all(
      Array
        .from(Array(3000), () => webcrypto.randomUUID())
        .map(s => sha256.digest(new TextEncoder().encode(s)))
    )
    const { error } = await publishBlockAdvertisement(ctx, { entries })
    assert.ok(!error)

    const collected = await collectQueueMessages(ctx.multihashesQueue)
    assert.ok(collected.ok)
    assert.equal(collected.ok.length, entries.length)

    for (const digest of collected.ok) {
      assert.ok(entries.some(e => equals(digest.bytes, e.bytes)))
    }
  }
}, createBlockAdvertPublisherTestContext)
