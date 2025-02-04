import all from 'p-all'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Stream from 'stream-json'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import StreamValues from 'stream-json/streamers/StreamValues.js'

const args = process.argv.slice(2)
const folderPath = args[0] ?? 's3-export'

const concurrency = 5
const seenCauses = new Map()
/** @type {{pk:string, sk: string}[]} */
const itemsToDelete = []

/**
 *
 * @param {any} item
 */
function processItem(item) {
  const seenItem = seenCauses.get(item.cause)
  if (seenItem) {
    const duplicateItemPk = new Date(seenItem.receiptAt) < new Date(item.receiptAt)
      ? { pk: item.pk, sk: item.sk }
      : { pk: seenItem.pk, sk: seenItem.sk }
    itemsToDelete.push(duplicateItemPk)
  } else {
    seenCauses.set(item.cause, {
      receiptAt: item.receiptAt,
      pk: item.pk,
      sk: item.sk,
    })
  }
}

/**
 *
 * @param {string} filePath
 * @returns
 */
async function processFile(filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath)
    const gunzipStream = zlib.createGunzip()
    const jsonStream = Stream.parser({ jsonStreaming: true })
    const pipeline = fileStream
      .pipe(gunzipStream)
      .pipe(jsonStream)
      .pipe(StreamValues.streamValues())

    pipeline.on('data', ({ value }) => {
      if (value.Item) {
        processItem(unmarshall(value.Item))
      }
    })

    pipeline.on('end', resolve)
    pipeline.on('error', reject)
  })
}

export async function main() {
  const files = fs
    .readdirSync(folderPath)
    .filter((file) => file.endsWith('.json.gz'))

  if (files.length == 0) {
    throw new Error('No relevant files found in the folder.')
  }

  await all(
    files.map((file) => async () => {
      const filePath = path.join(folderPath, file)
      console.log(`Processing file: ${filePath}`)
      await processFile(filePath)
    }),
    { concurrency }
  )

  console.log(`Unique items: ${seenCauses.size}`)
  console.log(`Items to delete: ${itemsToDelete.length}`)

  await fs.promises.writeFile(
    `./items-to-delete.json`,
    JSON.stringify(itemsToDelete)
  )
}

try {
  await main()
} catch (e) {
  console.error(e)
}
