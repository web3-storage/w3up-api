import fs from 'node:fs'
import dotenv from 'dotenv'
import parse from 'csv-parser'
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb'

import { mustGetEnv } from '../../../lib/env.js'

/**
 * @typedef {object} ParsedSnapshot
 * @property {string} provider - Storage provider this snapshot refers to.
 * @property {string} space - Space this snapshot refers to.
 * @property {string} size - Total allocated size in bytes, as a string.
 * @property {string} recordedAt - ISO string representing the recorded timestamp.
 * @property {string} insertedAt - ISO string representing the insertion timestamp.
 */

dotenv.config({ path: '.env.local' })

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const SPACE_SNAPSHOT_TABLE_NAME = `${STORACHA_ENV}-w3infra-space-snapshot`

const args = process.argv.slice(2)
const filename = args[0] // TODO: validate

const dynamo = new DynamoDBClient()

/**
 * Write up to 100 snapshots
 * 
 * @param {ParsedSnapshot[]} snapshots 
 */
async function upsertSnapshots(snapshots) {
  if (snapshots.length > 100) throw new Error('cannot write more than 100 snapshots in one batch - https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/dynamodb/command/TransactWriteItemsCommand/')

  /** @type {import('@aws-sdk/client-dynamodb').TransactWriteItem[]} */
  const transactItems = []
  for (const snap of snapshots) {
    transactItems.push({
      Put: {
        // NOTE: This operation will create a new item if it doesn't exist, or overwrite the item if it does.
        TableName: SPACE_SNAPSHOT_TABLE_NAME,
        Item: {
          pk: { S: `${snap.provider}#${snap.space}` },
          recordedAt: { S: snap.recordedAt },
          insertedAt: { S: snap.insertedAt },
          provider: { S: snap.provider },
          size: { N: snap.size },
          space: { S: snap.space },
        },
      },
    })
  }

  /** @type {import('@aws-sdk/client-dynamodb').TransactWriteItemsCommandInput} */
  const transactWriteParams = { TransactItems: transactItems }

  const command = new TransactWriteItemsCommand(transactWriteParams)
  return await dynamo.send(command)
}

export async function main() {
  /** @type ParsedSnapshot[]} */
  const snapshots = await readCsvInput(filename)
  console.log(`writing ${snapshots.length} snapshots to ${STORACHA_ENV}'s ${SPACE_SNAPSHOT_TABLE_NAME} dynamo table`)
  for (let i = 0; i < snapshots.length; i += 100) {
    const batch = [];
    for (let j = i; j < i + 100 && j < snapshots.length; j++) {
      batch.push(snapshots[j]);
    }
    try {
      const response = await upsertSnapshots(batch)
      console.log(response)
    } catch (err) {
      console.error(`Failed to update or create batch ${JSON.stringify(batch, null, 4)}`, err)
    }
  }
}

try {
  await main()
} catch (e) {
  console.error(e)
}

/**
 * @param {string} filename
 * @returns {Promise<any[]>}
 */
function readCsvInput(filename) {
  return new Promise((resolve, reject) => {
    /** @type any[] */
    const data = []
    fs.createReadStream(filename, { encoding: 'utf8' })
      .pipe(parse())
      .on('data', (row) => {
        data.push(row)
      })
      .on('error', (error) => {
        reject(new Error('Error reading input file!', { cause: error }))
      })
      .on('end', () => {
        console.log('Finished reading input file!')
        resolve(data)
      })
  })
}
