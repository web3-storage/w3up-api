/**
 * @param {import("../../billing/lib/api.js").CustomerStore} customerStore
 * @param {import('../types.js').BillingProvider} billingProvider
 * @returns {import("@storacha/upload-api").PlansStorage}
 */
export function usePlansStore(customerStore, billingProvider) {
  return {
    initialize: async (account, externalID, plan) => {
      const getResult = await customerStore.get({ customer: account })
      if (getResult.ok) {
        return {
          error: {
            name: 'CustomerExists',
            message: `${account} already exists, cannot be initialized`
          }
        }
      }
      if (!externalID.startsWith('stripe:')) {
        return ({
          error: {
            name: 'UnexpectedError',
            message: 'external ID must be a "stripe:" URI but is not',
            cause: null
          }
        })
      }
      // Note that there is a possible race condition here - if two `initialize` calls come in at
      // the same time, they may both get here since the account hasn't been initialized yet.
      // In that case, the last `put` will win, which should be fine - as far as I can tell
      // there's no way we can really determine which one was "valid" so accepting whichever of them
      // happens to go last should be fine.
      const stripeID = /** @type {import('@ucanto/interface').URI<'stripe:'>} */(externalID)
      await customerStore.put({
        customer: account,
        account: stripeID,
        product: plan,
        insertedAt: new Date()
      })
      return { ok: {} }
    },

    get: async (account) => {
      const result = await customerStore.get({ customer: account })
      return result.ok ?
        {
          ok: {
            product: /** @type {import("@ucanto/interface").DID} */(result.ok.product),
            updatedAt: (result.ok.updatedAt || result.ok.insertedAt).toISOString()
          }
        } : {
          error: {
            name: 'PlanNotFound',
            message: result.error.message
          }
        }
    },

    set: async (account, plan) => {
      const hasCustomerRecordResponse = await customerStore.get({ customer: account })
      if (hasCustomerRecordResponse.error) {
        return {
          error: {
            name: 'CustomerNotFound',
            message: 'could not find customer to update plan',
            cause: hasCustomerRecordResponse.error
          }
        }
      }
      const setBillingProviderPlanResponse = await billingProvider.setPlan(account, plan)
      if (setBillingProviderPlanResponse.error) {
        return {
          error: {
            name: 'PlanUpdateError',
            message: 'error updating plan in billing provider',
            cause: setBillingProviderPlanResponse.error
          }
        }
      }
      const customerStoreResponse = await customerStore.updateProduct(account, plan)
      if (customerStoreResponse.error){
        return {
          error: {
            name: 'PlanUpdateError',
            message: 'error updating plan in customer store - customer store and billing provider may be out of sync',
            cause: customerStoreResponse.error
          }
        }
      }
      return { ok: {} }
    },

    createAdminSession: async (account, returnURL) => billingProvider.createAdminSession(account, returnURL)
  }
}