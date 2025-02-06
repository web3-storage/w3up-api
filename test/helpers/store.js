import pRetry from 'p-retry'

/**
 * @template T
 * @param {() => Promise<import('../../filecoin/types').Result<T>>} fn
 * @param {(res: import('../../filecoin/types').Result<T>) => boolean} verifyResFn
 */
export async function waitForStoreOperationOkResult (fn, verifyResFn) {
  return await pRetry(async () => {
    const r = await fn()
    if (!verifyResFn(r)) {
      if (r.error) {
        throw r.error
      }
      throw new Error('result did not satisfy verifcation function')
    }

    return r
  }, {
    maxTimeout: 1000,
    minTimeout: 250,
    retries: 1e3
  })
}

/**
 * 
 * @param {import('@storacha/client').Client} client 
 * @param {import('@storacha/client/account').Account} account 
 */
export async function getUsage(client, account) {
  /** @type {Record<`did:${string}:${string}`, number>} */
  const usage = {}
  const now = new Date()
  const period = {
    // we may not have done a snapshot for this month _yet_, so get report
    // from last month -> now
    from: startOfLastMonth(now),
    to: now,
  }

const subscriptions = await client.capability.subscription.list(account.did())
for (const { consumers } of subscriptions.results) {
  for (const space of consumers) {
    try {
      const result = await client.capability.usage.report(space, period)
      for (const [, report] of Object.entries(result)) {
        usage[report.space] = report.size.final
      }
    } catch (err) {
      // TODO: figure out why usage/report cannot be used on old spaces 
      console.error(err)
    }
  }
}
return usage
}

/**
 * 
 * @param {string | number | Date} now 
 * @returns 
 */
const startOfMonth = (now) => {
  const d = new Date(now)
  d.setUTCDate(1)
  d.setUTCHours(0)
  d.setUTCMinutes(0)
  d.setUTCSeconds(0)
  d.setUTCMilliseconds(0)
  return d
}

/**
 * 
 * @param {string | number | Date} now 
 * @returns 
 */
const startOfLastMonth = (now) => {
  const d = startOfMonth(now)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d
}