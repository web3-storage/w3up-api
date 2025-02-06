import { hasOkReceipt } from './utils.js'

import {
  STORE_ADD,
  STORE_REMOVE,
  METRICS_NAMES,
  SPACE_METRICS_NAMES,
} from './constants.js'

/**
 * @typedef {import('@ucanto/interface').Capability} Capability
 * @typedef {import('@storacha/upload-api').StoreRemoveSuccess} StoreRemoveSuccess
 * @typedef {import('@storacha/upload-api').SpaceBlobRemoveSuccess} SpaceBlobRemoveSuccess
 */

/**
 * Update total admin metrics for upload-api receipts.
 * Metrics:
 * - STORE_ADD_TOTAL: increment number of `store/add` success receipts
 * - STORE_ADD_SIZE_TOTAL: increment size of `store/add` success receipts
 * - STORE_REMOVE_TOTAL: increment number of `store/remove` success receipts
 * - STORE_REMOVE_SIZE_TOTAL: increment size of `store/remove` success receipts
 * 
 * @param {import('./types.js').UcanStreamInvocation[]} ucanInvocations
 * @param {import('./types.js').MetricsCtx} ctx
 */
export async function updateAdminMetrics (ucanInvocations, ctx) {
  const receipts = getReceiptPerCapability(ucanInvocations)

  // Append size for `store/remove` receipts
  const storeRemoveReceipts = await Promise.all((receipts.get(STORE_REMOVE) || []).map(async r => {
    const storeRemoveSuccess = /** @type {StoreRemoveSuccess} */ (r.out.ok)
    let size = storeRemoveSuccess?.size

    // old receipts may not have size
    if (size == null) {
      size = await ctx.carStore.getSize(r.nb?.link)
    }

    r.nb.size = size
    return r
  }))

  await ctx.metricsStore.incrementTotals({
    [METRICS_NAMES.STORE_ADD_TOTAL]: (receipts.get(STORE_ADD) || []).length,
    [METRICS_NAMES.STORE_ADD_SIZE_TOTAL]: (receipts.get(STORE_ADD) || []).reduce(
      (acc, c) => acc + c.nb?.size, 0
    ),
    [METRICS_NAMES.STORE_REMOVE_TOTAL]: (receipts.get(STORE_REMOVE) || []).length,
    [METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL]: storeRemoveReceipts.reduce(
      (acc, c) => acc + c.nb?.size, 0
    ),
  })
}

/**
 * Update total space metrics for upload-api receipts.
 * Metrics:
 * - STORE_ADD_TOTAL: increment number of `store/add` success receipts for a space
 * - STORE_ADD_SIZE_TOTAL: increment size of `store/add` success receipts for a space
 * - STORE_REMOVE_TOTAL: increment number of `store/remove` success receipts for a space
 * - STORE_REMOVE_SIZE_TOTAL: increment size of `store/remove` success receipts for a space
 * 
 * @param {import('./types.js').UcanStreamInvocation[]} ucanInvocations
 * @param {import('./types.js').SpaceMetricsCtx} ctx
 */
export async function updateSpaceMetrics (ucanInvocations, ctx) {
  const receipts = getReceiptPerCapability(ucanInvocations)

  // Append size for `store/remove` receipts
  const storeRemoveReceipts = await Promise.all((receipts.get(STORE_REMOVE) || []).map(async r => {
    const storeRemoveSuccess = /** @type {StoreRemoveSuccess} */ (r.out.ok)
    let size = storeRemoveSuccess?.size

    // old receipts may not have size
    if (size == null) {
      size = await ctx.carStore.getSize(r.nb?.link)
    }

    r.nb.size = size
    return r
  }))

  await ctx.metricsStore.incrementTotals({
    [SPACE_METRICS_NAMES.STORE_ADD_TOTAL]: normalizeCapsPerSpaceTotal(receipts.get(STORE_ADD) || []),
    [SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL]: normalizeCapsPerSpaceSize(receipts.get(STORE_ADD) || []),
    [SPACE_METRICS_NAMES.STORE_REMOVE_TOTAL]: normalizeCapsPerSpaceTotal(receipts.get(STORE_REMOVE) || []),
    [SPACE_METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL]: normalizeCapsPerSpaceSize(storeRemoveReceipts),
  })
}

/**
 * Reduce all capabilities executed of a given type by counting totals per space.
 * Merge same space operations into single one.
 *
 * @param {Capability[]} capabilities 
 */
function normalizeCapsPerSpaceTotal (capabilities) {
  const res = capabilities.reduce((acc, c) => {
    const existing = acc?.find((e) => c.with === e.space)
    if (existing) {
      existing.value += 1
    } else {
      acc.push({
        space: c.with,
        value: 1
      })
    }
    return acc
  }, /** @type {import('./types.js').SpaceMetricsItem[]} */ ([]))

  return res
}

/**
 * Reduce all capabilities executed of a given type by totals sizes per space.
 * Merge same space operations into single one.
 *
 * @param {Capability[]} capabilities 
 */
function normalizeCapsPerSpaceSize (capabilities) {
  const res = capabilities.reduce((acc, c) => {
    const existing = acc?.find((e) => c.with === e.space)
    const size = c.nb?.size != null ? c.nb.size : c.nb?.blob?.size
    if (size == null) throw new Error('missing size')
    if (existing) {
      existing.value += size
    } else {
      acc.push({ space: c.with, value: size })
    }
    return acc
  }, /** @type {import('./types.js').SpaceMetricsItem[]} */ ([]))

  return res
}

/**
 * Get a map of receipts per capability.
 *
 * @param {import('./types.js').UcanStreamInvocation[]} ucanInvocations
 * @returns {Map<string, Array<Capability & { out: import('@ucanto/interface').Result }>>}
 */
function getReceiptPerCapability (ucanInvocations) {
  return ucanInvocations
    .reduce(
      (acc, workflowInvocations) => {
        if (!hasOkReceipt(workflowInvocations)) {
          return acc
        }

        for (const invocation of workflowInvocations.value.att) {
          const current = acc.get(invocation.can) || []
          current.push(invocation)
          acc.set(invocation.can, current.map((/** @type {Capability} */c) => ({
            ...c,
            out: workflowInvocations.out
          })))
        }

        return acc
      },
      (new Map())
    )
}
