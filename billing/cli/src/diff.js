import { randomLink } from '../../test/helpers/dag.js'
import { expect, mustGetEnv } from '../../functions/lib.js'
import Bytes from 'bytes'
import { createSubscriptionStore } from '../../tables/subscription.js'
import { createSpaceDiffStore } from '../../tables/space-diff.js'
import { getConsumerBySpace, getDynamo, isValidDate } from './lib.js'

/**
 * Remove some bytes from the space at the passed ISO timestamp.
 * 
 * $ billing diff remove did:key:space0 3MB 2023-09-16T09:00:00.000Z
 * 
 * @param {string} space
 * @param {string} rawBytes 
 * @param {string} datetime
 */
export async function diffRemove(space, rawBytes, datetime) {
  const change = Bytes(rawBytes) * -1
  await insertDiff(space, change, datetime)
}

/**
 * Add some bytes to the space at the passed ISO timestamp.
 * 
 * $ billing diff add did:key:space0 3MB 2023-09-16T09:00:00.000Z
 * 
 * @param {string} space
 * @param {string} rawBytes 
 * @param {string} datetime
 */
export async function diffAdd (space, rawBytes, datetime) {
  const change = Bytes(rawBytes)
  await insertDiff(space, change, datetime)
}

/**
 * Insert a diff record
 * 
 * @param {string} space
 * @param {number} delta - positive or negative integer in bytes
 * @param {string} datetime
 */
async function insertDiff (space, delta, datetime) {
  const receiptAt = new Date(datetime)
  if (!isValidDate(receiptAt)) {
    throw new Error(`${datetime} is not a valid date-time`)
  }
  const dynamo = getDynamo()
  const consumer = await getConsumerBySpace(dynamo, space)
  const subscriptionStore = createSubscriptionStore(dynamo, {
    tableName: mustGetEnv('SUBSCRIPTION_TABLE_NAME')
  })
  const subscription = expect(
    await subscriptionStore.get({ provider: consumer.provider, subscription: consumer.subscription }),
    `getting subscription: ${consumer.subscription}`
  )
  const spaceDiffStore = createSpaceDiffStore(dynamo, {
    tableName: mustGetEnv('SPACE_DIFF_TABLE_NAME')
  })
  const res = await spaceDiffStore.put({
    cause: randomLink(),
    space: consumer.consumer,
    subscription: subscription.subscription,
    insertedAt: new Date(),
    provider: consumer.provider,
    delta,
    receiptAt
  })
  console.log(res)
}
