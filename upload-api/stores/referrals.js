/**
 * Abstraction layer for referrals.
 *
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../types.js').ReferralsStore}
 */
export function createReferralStore(options = {}) {
  return {
    async getReferredBy(email) {
      const result = await fetch(`${options.endpoint}/referredby/${email}`)
      return await result.json()
    }
  }
}
