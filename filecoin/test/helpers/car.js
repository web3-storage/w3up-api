import { encode } from 'multiformats/block'
import { identity } from 'multiformats/hashes/identity'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import * as pb from '@ipld/dag-pb'
import { CarBufferWriter } from '@ipld/car'
import { toString } from 'uint8arrays'
import { Piece } from '@web3-storage/data-segment'

/**
 * @returns {Promise<{
 *   body: Uint8Array
 *   checksum: string
 *   key: string
 *   link: import('multiformats').UnknownLink
 *   piece: import('@web3-storage/data-segment').PieceLink
 * }>}
 */
export async function createCar () {
  const id = await encode({
    value: pb.prepare({ Data: 'a red car on the street!' }),
    codec: pb,
    hasher: identity,
  })

  const parent = await encode({
    value: pb.prepare({ Links: [id.cid] }),
    codec: pb,
    hasher,
  })
  const car = CarBufferWriter.createWriter(Buffer.alloc(1000), {
    roots: [parent.cid],
  })
  car.write(parent)

  const body = car.close()
  const digest = await hasher.digest(body)
  const checksum = toString(digest.digest, 'base64pad')

  const key = `${parent.cid.toString()}/${parent.cid.toString()}`
  const piece = Piece.fromPayload(body)

  return {
    body,
    checksum,
    key,
    link: parent.cid,
    piece: piece.link
  }
}
