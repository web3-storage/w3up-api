import all from 'p-all'
import fs from 'node:fs'
import dotenv from 'dotenv'
import Stream from 'stream-json'
import { BatchWriteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import StreamArray from 'stream-json/streamers/StreamArray.js'

import { mustGetEnv } from '../../../lib/env.js'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

dotenv.config({ path: '.env.local' })

/**
 * @typedef {object} ItemKey
 * @property {string} pk
 * @property {string} sk
 */

const SPACE_DIFF_TABLE_NAME = mustGetEnv('SPACE_DIFF_TABLE_NAME')

const BATCH_SIZE = 25
const MAX_RETRIES = 3
const concurrency = 5
const dynamo = new DynamoDBClient()

/**
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 *
 * @param {ItemKey[]} items
 * @param {number} retryCount
 * @param {number} delay
 */
async function processBatch(items, retryCount = 0, delay = 100) {
  console.log(`Processing batch with ${items.length} items...`)
  const deleteRequests = items.map((item) => ({
    DeleteRequest: {
      Key: marshall(item),
    },
  }))

  const batchDeleteCommand = new BatchWriteItemCommand({
    RequestItems: {
      [SPACE_DIFF_TABLE_NAME]: deleteRequests,
    },
  })

  try {
    const response = await dynamo.send(batchDeleteCommand)

    if (response.UnprocessedItems && response.UnprocessedItems[SPACE_DIFF_TABLE_NAME]) {
      const unprocessedItems = /** @type {ItemKey[]} */ (
        response.UnprocessedItems[SPACE_DIFF_TABLE_NAME].map((item) =>
          unmarshall(/** @type {Record<string, any>} */ (item.DeleteRequest?.Key))
        )
      )
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying ${unprocessedItems.length} unprocessed items...`)
        await sleep(delay)
        return processBatch(
          unprocessedItems,
          retryCount + 1,
          delay * 2 // Increase delay exponentially
        )
      } else {
        console.error(
          'Max retries reached. Some items could not be processed:',
          unprocessedItems
        )
      }
    }
  } catch (err) {
    console.error('Failed to delete batch!', err)
  }
}

/**
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function processFile(filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath)
    const pipeline = fileStream
      .pipe(Stream.parser())
      .pipe(StreamArray.streamArray())

    /** @type {ItemKey[]} */
    let batch = []
    /** @type {(() => Promise<void>)[]} */
    const tasks = []

    pipeline.on('data', async ({ value }) => {
      if (value) {
        batch.push(value)
        if (batch.length == BATCH_SIZE) {
          const copyBatch = batch.slice()
          tasks.push(() => processBatch(copyBatch))
          batch = []
        }
      }
    })

    pipeline.on('end', async () => {
      if (batch.length > 0) {
        tasks.push(() => processBatch(batch))
      }
      await all(tasks, { concurrency })
      resolve()
    })
    pipeline.on('error', reject)
  })
}

export async function main() {
  const file = `items-to-delete.json`
  console.log(`Processing ${file}...`)
  await processFile(file)
}

try {
  await main()
} catch (e) {
  console.error(e)
}
