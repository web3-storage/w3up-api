// @jsxImportSource preact
import * as preact from 'preact'
import { render } from 'preact-render-to-string'
import { Response } from '@web-std/fetch'

/**
 * Dev changes quickly without deploying to AWS!
 * Use test/helpers/validate-email-server.js
 */

/**
 * Build HTML document
 *
 * @param {string} body
 */
export function buildDocument(body) {
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>w3up Email Validation</title>
  <meta name="description" content="">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script async src="https://js.stripe.com/v3/pricing-table.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@acab/reset.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/dark.min.css">
  <style>
    :root {
      --background-body: #000;
      --background: hsla(240,5%,84%,.1);
      --background-alt: rgb(29, 32, 39);
      --button-base: hsl(212deg 27% 10%);
      --button-hover: hsl(212deg 27% 6%);
      --scrollbar-thumb: hsl(212deg 27% 10%);
      --scrollbar-thumb-hover: hsl(212deg 27% 6%);
    }
    :where(:root) body {
      display: grid;
      height: 100vh;
      height: 100dvh;
      padding: 0;
      margin: 0;
      max-width: 100%;
    }
    body {
      margin: 0 40px;
      padding: 40px 0;
    }
    .fcenter {
      display: flex;
      align-items: center;
      flex-direction: column;
      justify-content: center;
    }
    .mcenter {
      margin: 0 auto;
    }
    .box, .box[open] {
      max-width: 640px;
      background-color: var(--background-alt);
      padding: 20px;
      margin: 1em auto;
      border-radius: 6px;
      overflow: hidden;
    }
    .box > p {
      margin-bottom: 10px;
    }
    .box > p:last-child {
      margin-bottom: 0;
    }
    .box.wide {
      margin: 1em auto;
      max-width: 72rem;
    }
    summary {
      background-color: transparent;
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
${body}
</body>
</html>`
}

export class HtmlResponse extends Response {
  /**
   *
   * @param {import('preact').VNode<{}>} body
   * @param {ResponseInit} [init]
   */
  constructor(body, init = {}) {
    const headers = {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    }
    const stringBody = buildDocument(render(body))
    super(stringBody, { ...init, ...headers })
    this.stringBody = stringBody
  }

  getStringBody(){
    return this.stringBody
  }

  /**
   * @param {import('preact').VNode<{}>} body
   * @param {ResponseInit} [init]
   */
  static respond(body, init = {}) {
    return new HtmlResponse(body, init)
  }
}

/**
 *
 * @param {object} props
 * @param {boolean} [props.autoApprove]
 */
export const PendingValidateEmail = ({ autoApprove }) => (
  <div style={{ paddingTop: '50px', margin: '0 auto', width: '100%', maxWidth: '72rem' }}>
    <header style={{ textAlign: 'center', color: 'white' }}>
      <div style={{ display: 'inline-block', transform: 'scale(1.25)' }}>
        <svg width="50" viewBox="0 0 27.2 27.18" xmlns="http://www.w3.org/2000/svg"><path d="M13.6 27.18A13.59 13.59 0 1127.2 13.6a13.61 13.61 0 01-13.6 13.58zM13.6 2a11.59 11.59 0 1011.6 11.6A11.62 11.62 0 0013.6 2z" fill="currentColor" /><path d="M12.82 9.9v2.53h1.6V9.9l2.09 1.21.77-1.21-2.16-1.32 2.16-1.32-.77-1.21-2.09 1.21V4.73h-1.6v2.53l-2-1.21L10 7.26l2.2 1.32L10 9.9l.78 1.21zM18 17.79v2.52h1.56v-2.52L21.63 19l.78-1.2-2.16-1.33 2.16-1.28-.78-1.19-2.08 1.2v-2.58H18v2.56L15.9 14l-.77 1.2 2.16 1.32-2.16 1.33.77 1.15zM8.13 17.79v2.52h1.56v-2.52L11.82 19l.77-1.2-2.16-1.33 2.12-1.28-.73-1.24-2.13 1.23v-2.56H8.13v2.56L6.05 14l-.78 1.2 2.16 1.3-2.16 1.33.78 1.17z" fill="currentColor" /></svg>
      </div>
      <h1>Validating Email</h1>
    </header>
    <div class="fcenter">
      <form id="approval" method="post" class="fcenter">
        <button class="mcenter">Approve</button>
      </form>
      {autoApprove ? (
        <script
          dangerouslySetInnerHTML={{
            // NOTE: this script sticks to ES3-era syntax for compat with more browsers
            __html: `(function () {
            // auto-submit the form for any user w/JS enabled
            var form = document.getElementById('approval');
            form.style.display = 'none';
            form.submit();
          })();`,
          }}
        />
      ) : undefined}
    </div>
  </div>
)

/**
 *
 * @param {object} param0
 * @param {string} param0.ucan
 * @param {string} param0.email
 * @param {string} param0.audience
 * @param {string} [param0.stripePricingTableId]
 * @param {string} [param0.stripePublishableKey]
 * @param {string} [param0.qrcode]
 */
export const ValidateEmail = ({ ucan, qrcode, email, audience, stripePricingTableId, stripePublishableKey }) => {
  const showPricingTable = stripePricingTableId && stripePublishableKey
  return (
    <div style={{ paddingTop: '50px', margin: '0 auto', width: '100%', maxWidth: '72rem' }}>
      <header style={{ textAlign: 'center', color: 'white' }}>
        <div style={{ display: 'inline-block', transform: 'scale(1.25)' }}>
          <svg width="50" viewBox="0 0 27.2 27.18" xmlns="http://www.w3.org/2000/svg"><path d="M13.6 27.18A13.59 13.59 0 1127.2 13.6a13.61 13.61 0 01-13.6 13.58zM13.6 2a11.59 11.59 0 1011.6 11.6A11.62 11.62 0 0013.6 2z" fill="currentColor" /><path d="M12.82 9.9v2.53h1.6V9.9l2.09 1.21.77-1.21-2.16-1.32 2.16-1.32-.77-1.21-2.09 1.21V4.73h-1.6v2.53l-2-1.21L10 7.26l2.2 1.32L10 9.9l.78 1.21zM18 17.79v2.52h1.56v-2.52L21.63 19l.78-1.2-2.16-1.33 2.16-1.28-.78-1.19-2.08 1.2v-2.58H18v2.56L15.9 14l-.77 1.2 2.16 1.32-2.16 1.33.77 1.15zM8.13 17.79v2.52h1.56v-2.52L11.82 19l.77-1.2-2.16-1.33 2.12-1.28-.73-1.24-2.13 1.23v-2.56H8.13v2.56L6.05 14l-.78 1.2 2.16 1.3-2.16 1.33.78 1.17z" fill="currentColor" /></svg>
        </div>
        <h1>Email Validated</h1>
        <p style={{ paddingBottom: '30px', color: 'white' }}>
          {email} was confirmed. {showPricingTable ? '' : 'You may close this window.'}
        </p>
      </header>
      {showPricingTable && (
        <div class="box wide">
          <p style={{ textAlign: 'center', color: 'white', fontSize: '20px', fontWeight: 'bold' }}>In order to <span style={{ textDecoration: 'underline' }}>upload data</span> you need to sign up for a billing plan:</p>
          {preact.createElement('stripe-pricing-table', {
              'pricing-table-id': stripePricingTableId,
              'publishable-key': stripePublishableKey,
              'customer-email': email,
            }, '')}
        </div>
      )}
      <div class="box" style={{ fontSize: '14px' }}>
        <p style={{ fontSize: '14px' }}>By registering with web3.storage you agree to the web3.storage <a href="https://console.web3.storage/terms">Terms of Service</a>.</p>
      </div>
      <details
        class="box"
        style={{ overflow: 'overlay', textDecoration: 'none' }}
      >
        {' '}
        <summary style={{ fontSize: '14px' }}>Auth details</summary>
        <h5 style={{ marginBottom: 0 }}>Validation requested by</h5>
        <pre>
          <code>{audience}</code>
        </pre>
        {qrcode && (
          <>
            <h5>QR Code</h5>
            <div
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{
                __html: qrcode,
              }}
              class='mcenter'
              style={{
                width: '300px',
              }}
            />
          </>
        )}
        <h5 style={{ marginBottom: 0, paddingTop: '8px' }}>UCAN</h5>
        <pre>
          <code>{ucan}</code>
        </pre>
      </details>
    </div>
  )
}

/**
 *
 * @param {object} param0
 * @param {string} param0.msg
 */
export const ValidateEmailError = ({ msg }) => (
  <div class="fcenter">
    <img
      src="https://web3.storage/android-chrome-512x512.png"
      height="80"
      width="80"
    />
    <h1>Email Validation Failed</h1>
    <p>{msg} You may close this window and try again.</p>
  </div>
)