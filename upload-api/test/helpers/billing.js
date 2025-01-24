/**
 * @returns {import('../../types.js').BillingProvider}
 */
export function createTestBillingProvider() {
  /**
   * @type {Record<import("@storacha/upload-api").AccountDID, import("@ucanto/interface").DID>}
   */
  const customers = {}
  return {
    async hasCustomer(customer) {
      return { ok: Boolean(customers[customer]) }
    },

    async setPlan(customer, product) {
      customers[customer] = product
      return { ok: {} }
    },

    async createAdminSession(customer) {
      return { ok: { url: 'https://example/test-billing-admin-session' } }
    }
  }
}