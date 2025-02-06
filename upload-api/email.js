import fetch from '@web-std/fetch'

/**
 * @typedef { import('@storacha/upload-api').ValidationEmailSend } ValidationEmailSend
 */

/**
 * @param {{token:string, sender?:string}} opts
 */
export const configure = (opts) => new Email(opts)

export class Email {
  /**
   * @param {object} opts
   * @param {string} opts.token - Postmark server token
   * @param {string} [opts.sender] - Sender email mailbox (`Display Name
   *                                 <email@address.com>`)
   * @param {string} [opts.environment] - Environment/stage name to display in
   *                                      the email subject. Omit to show none
   *                                      (ie, production).
   */
  constructor(opts) {
    this.sender = opts.sender
    this.headers = {
      Accept: 'text/json',
      'Content-Type': 'text/json',
      'X-Postmark-Server-Token': opts.token,
    }
    this.environment = opts.environment
  }

  /**
   * Send validation email with ucan to register
   *
   * @param {ValidationEmailSend} opts
   */
  async sendValidation(opts) {
    const { hostname } = new URL(opts.url)
    const emailParams = hostname.endsWith('web3.storage')
      ? {
          From: this.sender || 'web3.storage <noreply@web3.storage>',
          TemplateAlias: 'welcome',
          TemplateModel: {
            product_url: 'https://web3.storage',
            product_name: 'Web3 Storage',
            email: opts.to,
            action_url: opts.url,
          },
        }
      : {
        From: this.sender || 'Storacha <noreply@storacha.network>',
        TemplateAlias: 'welcome-storacha',
          TemplateModel: {
            email: opts.to,
            action_url: opts.url,
            environment_name: this.environment,
          },
        }

    const rsp = await fetch('https://api.postmarkapp.com/email/withTemplate', {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        To: opts.to,
        ...emailParams,
      }),
    })

    if (!rsp.ok) {
      throw new Error(
        `Send email failed with status: ${rsp.status
        }, body: ${await rsp.text()}`
      )
    }
  }
}
