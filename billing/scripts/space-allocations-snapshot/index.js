import all from 'p-all'
import fs from 'node:fs'
import dotenv from 'dotenv'
import * as CSV from 'csv-stringify/sync'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { createConsumerStore } from '../../tables/consumer.js'
import { createCustomerStore } from '../../tables/customer.js'
import { createAllocationStore } from '../../tables/allocations.js'
import { createSubscriptionStore } from '../../tables/subscription.js'

import { expect } from '../../functions/lib.js'
import { mustGetEnv } from '../../../lib/env.js'
import {
  calculateCost,
  createMemoryQueue,
  toDateString,
} from '../dry-run/helpers.js'
import { EndOfQueue } from '../../test/helpers/queue.js'

import * as BillingCron from '../../lib/billing-cron.js'
import * as SpaceBillingQueue from '../../lib/space-billing-queue.js'
import * as CustomerBillingQueue from '../../lib/customer-billing-queue.js'
import { startOfMonth } from '../../lib/util.js'
import { Schema } from '../../data/lib.js'

/**
 * @typedef {import('../../lib/api.js').CustomerDID} CustomerDID
 * @typedef {import('../../lib/api.js').AllocationSnapshot} AllocationSnapshot
 * @typedef {import('../../lib/api.js').SpaceBillingInstruction} SpaceBillingInstruction
 * @typedef {import('../../lib/api.js').CustomerBillingInstruction} CustomerBillingInstruction
 * @typedef {import('../../lib/api.js').QueueAdder<import('../../lib/api.js').CustomerBillingInstruction> & import('../../test/lib/api.js').QueueRemover<import('../../lib/api.js').CustomerBillingInstruction>} CustomerBillingQueue
 * @typedef {import('../../lib/api.js').QueueAdder<import('../../lib/api.js').SpaceBillingInstruction> & import('../../test/lib/api.js').QueueRemover<import('../../lib/api.js').SpaceBillingInstruction>} SpaceBillingQueue
 */

/**
 * ===========================================
 *               CONFIGURATION
 * ===========================================
 */

dotenv.config({ path: '.env.local' })

const concurrency = 5
const dynamo = new DynamoDBClient()

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')

const CUSTOMER_TABLE_NAME=`${STORACHA_ENV}-w3infra-customer`
const SUBSCRIPTION_TABLE_NAME=`${STORACHA_ENV}-w3infra-subscription`
const CONSUMER_TABLE_NAME=`${STORACHA_ENV}-w3infra-consumer`
const ALLOCATIONS_TABLE_NAME=`${STORACHA_ENV}-w3infra-allocation`
const STORE_TABLE_NAME=`${STORACHA_ENV}-w3infra-store`

const customerStore = createCustomerStore(dynamo, {
  tableName: CUSTOMER_TABLE_NAME,
})
const subscriptionStore = createSubscriptionStore(dynamo, {
  tableName: SUBSCRIPTION_TABLE_NAME,
})
const consumerStore = createConsumerStore(dynamo, {
  tableName: CONSUMER_TABLE_NAME,
})
const allocationStore = createAllocationStore(dynamo, {
  tableName: ALLOCATIONS_TABLE_NAME,
})
const storeTableStore = createAllocationStore(dynamo, {
  tableName: STORE_TABLE_NAME,
})

/** @type CustomerBillingQueue */
const customerBillingQueue = createMemoryQueue()
/** @type SpaceBillingQueue */
const spaceBillingQueue = createMemoryQueue()

/** @type AllocationSnapshot */
const result = {}

/**
 * Note: The allocations and stores retrieved have 'insertedAt' values greater than 'from' and less than or equal to 'to'.
 */
const args = process.argv.slice(2)
const { from, to, customer } = parseArgs(args)

export async function main() {
  /** @type CustomerBillingInstruction[] */
  let customerBillingInstructions = []

  if (customer) {
    console.log(`Getting customer...`)

    const { ok: record, error } = await customerStore.get({ customer })
    if (error) throw error

    customerBillingInstructions.push({
      customer: record.customer,
      account: record.account,
      product: record.product,
      from,
      to,
    })
  } else {
    console.log(`Getting all customers...`)

    expect(
      await BillingCron.enqueueCustomerBillingInstructions(
        { from, to },
        {
          customerStore,
          customerBillingQueue,
        }
      )
    )

    customerBillingInstructions = /** @type CustomerBillingInstruction[] */ (
      await consumeQueue(customerBillingQueue)
    )
  }

  console.log(`Getting all spaces...`)

  await all(
    customerBillingInstructions.map((instruction) => async () => {
      expect(
        await CustomerBillingQueue.enqueueSpaceBillingInstructions(
          instruction,
          {
            subscriptionStore,
            consumerStore,
            spaceBillingQueue,
          }
        )
      )

      const spaceBillingInstructions = /** @type SpaceBillingInstruction[] */ (
        await consumeQueue(spaceBillingQueue)
      )

      await all(
        spaceBillingInstructions.map((instruction) => async () => {
          const spaceAllocation = expect(
            await SpaceBillingQueue.calculateSpaceAllocation(
              'allocationStore',
              instruction,
              { allocationStore }
            )
          )

          const storeAllocation = expect(
            await SpaceBillingQueue.calculateSpaceAllocation(
              'storeTableStore',
              instruction,
              // @ts-ignore TODO: fix this
              { storeTableStore }
            )
          )

          if (!result[instruction.customer]) {
            result[instruction.customer] = {
              product: instruction.product,
              provider: instruction.provider,
              recordedAt: instruction.to,
              spaceAllocations: [],
              totalAllocation: 0n,
              totalUsage: 0n,
            }
          }

          const spaceSize = spaceAllocation.size + storeAllocation.size
          const storeUsage = spaceAllocation.usage + spaceAllocation.usage

          result[instruction.customer].spaceAllocations.push({
            [instruction.space]: {
              size: spaceSize,
              usage: storeUsage,
            },
          })
          result[instruction.customer].totalAllocation += spaceSize
          result[instruction.customer].totalUsage += storeUsage
        }),
        { concurrency }
      )
    }),
    { concurrency }
  )

  console.log(`✅ Allocation snapshot completed successfully`)

  await writeToJsonFile(
    `./allocation-snapshot-${toDateString(from)}_${toDateString(to)}.json`,
    result
  )

  await exportSnapshotToCSV()

  await calculateAndExportUsageSummary()
}

try {
  await main()
} catch (e) {
  console.error(e)
}

/**
 * ===========================================
 *            FUNCTION DECLARATIONS
 * ===========================================
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
function validateDateArg(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * @param {string[]} args - Array of arguments in the format 'from=yyyy-mm-dd' or 'to=yyyy-mm-dd'.
 * @returns {{ from: Date, to: Date, customer?: CustomerDID }} - Object with parsed 'from' and 'to' dates.
 * @throws {Error} If the arguments are invalid or improperly formatted.
 */
function parseArgs(args) {
  const fromArg = args.find((e) => e.includes('from='))?.split('from=')[1]
  const toArg = args.find((e) => e.includes('to='))?.split('to=')[1]
  const customer = /** @type CustomerDID */ (
    args.find((e) => e.includes('customer='))?.split('customer=')[1]
  )

  if (
    (fromArg && !validateDateArg(fromArg)) ||
    (toArg && !validateDateArg(toArg))
  ) {
    throw new Error('Expected argument in the format yyyy-mm-dd')
  }

  if (customer && Schema.did({ method: 'mailto' }).read(customer).error) {
    throw new Error(`Invalid customer format: expected 'did:mailto:agent'.`)
  }

  const from = fromArg ? new Date(fromArg) : new Date('1970-01-01') // since all time
  const to = toArg
    ? new Date(toArg)
    : (() => {
        const now = new Date()
        now.setUTCMonth(now.getUTCMonth() + 1)
        return startOfMonth(now) // until first day of next month
      })()

  if (from > to) {
    throw new Error("'from' date must be earlier than 'to' date")
  }

  return {
    from,
    to,
    customer,
  }
}

/**
 * @param  {CustomerBillingQueue | SpaceBillingQueue} queue
 * @returns {Promise<CustomerBillingInstruction[] | SpaceBillingInstruction[]>}
 * */
async function consumeQueue(queue) {
  const instructions = []
  while (true) {
    const removeResult = await queue.remove()
    if (removeResult.error) {
      if (removeResult.error.name === EndOfQueue.name) break
      throw removeResult.error
    }
    instructions.push(removeResult.ok)
  }
  return instructions
}

/**
 * @param {string} filePath
 * @param {object} data
 * @returns {Promise<void>}
 */
async function writeToJsonFile(filePath, data) {
  await fs.promises.writeFile(
    filePath,
    JSON.stringify(
      data,
      (key, value) => (typeof value === 'bigint' ? value.toString() : value) // return everything else unchanged
    )
  )
}

/**
 * @param {string} filePath
 * @param {any[]} columns
 * @param {any[][]} data
 * @returns {Promise<void>}
 */
async function writeToCsvFile(filePath, columns, data) {
  await fs.promises.writeFile(
    filePath,
    CSV.stringify(data, {
      header: true,
      columns,
    })
  )
}

async function exportSnapshotToCSV() {
  /** @type {Array<[string, string, bigint, string, string]>} */
  const snapshot = []

  for (const customer of /** @type {Array<import('../../lib/api.js').CustomerDID>} */ (
    Object.keys(result)
  )) {
    for (const spaceAllocation of result[customer].spaceAllocations) {
      const [space, { size }] =
        /** @type [import('../../lib/api.js').ConsumerDID, {size:bigint, usage:bigint}] */ (
          Object.entries(spaceAllocation)[0]
        )

      snapshot.push([
        result[customer].provider,
        space,
        size,
        result[customer].recordedAt.toISOString(),
        new Date().toISOString(), // insertedAt
      ])
    }
  }

  await writeToCsvFile(
    `./snapshot-${toDateString(from)}_${toDateString(to)}.csv`,
    ['provider', 'space', 'size', 'recordedAt', 'insertedAt'],
    snapshot
  )
}

async function calculateAndExportUsageSummary() {
  /** @type {Array<[string, string, string, number]>} */
  const usageSummary = []
  const duration = to.getTime() - from.getTime()

  for (const customer of /** @type {Array<import('../../lib/api.js').CustomerDID>} */ (
    Object.keys(result)
  )) {
    if (!result[customer].product) {
      console.warn(`Customer ${customer} is missing product!`)
      break
    }
    try {
      const cost = calculateCost(
        result[customer].product,
        result[customer].totalUsage,
        duration
      )
      usageSummary.push([
        customer,
        result[customer].product,
        result[customer].totalAllocation.toString(),
        cost,
      ])
    } catch (err) {
      console.warn(`Failed to calculate cost for: ${customer}`, err)
    }
  }

  usageSummary.sort((a, b) => b[3] - a[3])

  await fs.promises.writeFile(
    `./summary-${toDateString(from)}-${toDateString(to)}.csv`,
    CSV.stringify(usageSummary, {
      header: true,
      columns: ['Customer', 'Product', 'Bytes', 'Cost ($)'],
    })
  )
}
