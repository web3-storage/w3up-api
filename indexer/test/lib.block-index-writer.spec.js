import { sha256 } from 'multiformats/hashes/sha2'
import { webcrypto } from '@storacha/one-webcrypto'
import { writeBlockIndexEntries } from '../lib/block-index-writer.js'
import { bindTestContext, createBlockIndexWriterTestContext } from './helpers/context.js'
import { base58btc } from 'multiformats/bases/base58'

export const test = bindTestContext({
  'should write block indexes': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const digests = await Promise.all(
      Array
        .from(Array(3000), () => webcrypto.randomUUID())
        .map(s => sha256.digest(new TextEncoder().encode(s)))
    )
    const entries = digests.map(digest => {
      const digestStr = base58btc.encode(digest.bytes)
      return /** @type {import('../lib/api.js').Location} */ ({
        digest,
        location: new URL(`https://bucket.w3s.link/${digestStr}/${digestStr}.blob`),
        range: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
      })
    })
    const { error } = await writeBlockIndexEntries(ctx, entries)
    assert.ok(!error)

    for (const entry of entries) {
      const { ok } = await ctx.blocksCarsPositionStore.list(entry.digest)
      assert.ok(ok?.results.length)
    }
  }
}, createBlockIndexWriterTestContext)
