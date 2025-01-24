import { sha256 } from 'multiformats/hashes/sha2'
import * as raw from 'multiformats/codecs/raw'
import * as Link from 'multiformats/link'
import { CarBufferWriter } from '@ipld/car'
import { randomInteger } from './math.js'
import { randomBytes } from './bytes.js'

export const randomBlock = () => {
  const bytes = randomBytes(randomInteger(1, 1024 * 1024))
  const mh = sha256.digest(bytes)
  if (mh instanceof Promise) throw new Error('sha256 hasher is async')
  return { cid: Link.create(raw.code, mh), bytes }
}

/**
 * @param {import('multiformats').UnknownLink} root
 * @param {import('multiformats').Block[]} blocks
 */
export const encodeCAR = (root, blocks) => {
  const roots = [root]
  const headerSize = CarBufferWriter.headerLength({ roots })
  let blocksSize = 0
  for (const b of blocks) {
    blocksSize += CarBufferWriter.blockLength(b)
  }
  const writer = CarBufferWriter.createWriter(new Uint8Array(headerSize + blocksSize), { roots })

  for (const b of blocks) {
    writer.write(b)
  }
  const bytes = writer.close()
  const mh = sha256.digest(bytes)
  if (mh instanceof Promise) throw new Error('sha256 hasher is async')
  return { cid: Link.create(0x0202, mh), bytes }
}
