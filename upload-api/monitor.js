/** Tools for monitoring the upload-api. */
import { code as dagPBCode } from '@ipld/dag-pb'
import { code as rawCode } from 'multiformats/codecs/raw'
import * as Link from 'multiformats/link'
import { sha256 } from 'multiformats/hashes/sha2'
import { ScanCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import * as ed25519 from '@ucanto/principal/ed25519'
import { webcrypto } from '@storacha/one-webcrypto'

const MAX_SAMPLE_SIZE = 10
const SAMPLE_SIZE = 1

const codes = [dagPBCode, rawCode]

const randomCodec = () => codes[Math.floor(Math.random() * codes.length)]

const randomDID = async () => (await ed25519.generate()).did()

const randomLink = async () => {
  const bytes = webcrypto.getRandomValues(new Uint8Array(256))
  const digest = await sha256.digest(bytes)
  return Link.create(randomCodec(), digest)
}

/**
 * Get a random sample of registered upload root CIDs. Currently filtered to
 * codecs that can be served natively by an IPFS gateway (raw and dag-pb).
 *
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {{ size?: number }} [options]
 */
export const sampleUploads = async function * (dynamo, tableName, options) {
  const size = Math.min(options?.size ?? SAMPLE_SIZE, MAX_SAMPLE_SIZE)
  let i = 0
  while (i < size) {
    const [root, space] = await Promise.all([randomLink(), randomDID()])
    const res = await dynamo.send(new ScanCommand({
      TableName: tableName,
      IndexName: 'cid',
      Limit: 1,
      ExclusiveStartKey: marshall({ root: root.toString(), space })
    }))
    if (!res.Items?.length) continue

    const raw = unmarshall(res.Items[0])
    yield { root: Link.parse(raw.root) }
    i++
  }
}
