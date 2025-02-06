import * as Sentry from '@sentry/serverless'
import * as UploadAPI from '@storacha/upload-api'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

export const createServiceRouter = UploadAPI.createService

// S3 Put command has hard-limit of 5GiB.
// By limiting CAR size to 127*(1<<25), we guarantee max-4GiB-padded Filecoin pieces
// and have better utilization of Fil sector space.
// By receiving one more byte, we would immediatly get to 8GiB padded piece.
export const MAX_UPLOAD_SIZE = 127*(1<<25)

/**
 * @param {import('@ucanto/interface').Signer} servicePrincipal
 * @param {Omit<UploadAPI.UcantoServerContext, 'errorReporter'|'id'|'maxUploadSize'|'validateAuthorization'>} context
 */
export const createUcantoServer = (servicePrincipal, context) =>
  UploadAPI.createServer({
    ...context,
    id: servicePrincipal,
    maxUploadSize: MAX_UPLOAD_SIZE,
    errorReporter: {
      catch: (/** @type {string | Error} */ err) => {
        console.warn(err)
        Sentry.AWSLambda.captureException(err)
      },
    },
  })
