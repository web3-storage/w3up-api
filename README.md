# upload-service-infra

The Infra for [upload-service].

A [UCAN] based API to for storing CARs and registering uploads, built on [Ucanto] and [SST].

The server-side implementation of the capabilities defined in [upload-service].

## Getting Started

The repo contains the infra deployment code and the api implementation.

```
├── billing         - usage accounting and reporting to the payment system
├── carpark         - lambda for announce new CARs in the carpark bucket
├── filecoin        - lambdas to get content into Filecoin deals
├── indexer         - lambdas to connect w3up to E-IPFS
├── replicator      - lambda to replicate buckets to R2
├── stacks          - sst and aws cdk code to deploy all the things
├── ucan-invocation - kinesis log data stream and its lambda consumers
└── upload-api      - lambda & dynamoDB implementation of the upload-api http gateway
```

To work on this codebase **you need**:

- Node.js >= v16 (prod env is node v16)
- Install the deps with `npm i`
- run your env `npx sst dev --no-deploy`

You can then run the tests locally with `npm test`.

To try out a change submit a PR and you'll get temporary infra rolled out for you automatically at `https://<pr#>.up.storacha.network`.

[`sst`](https://sst.dev) is the framework we use to define what to deploy. Read the docs! https://sst.dev

## Deployment

Deployments are managed by [seed.run].

The `main` branch is deployed to https://staging.up.storacha.network and staging builds are promoted to prod manually via the UI at https://console.seed.run

### Local dev

You can use `sst` to create a custom dev deployment on aws, with a local dev console for debugging.

To do that **you need**

- An AWS account with the AWS CLI configured locally
- Copy `.env.tpl` to `.env.local`

Then run `npm start` to deploy dev services to your aws account and start dev console

```console
npm start
```

See: https://docs.sst.dev for more info on how things get deployed.

#### Testing Stripe Integration

There are two possible ways to configure stripe for test, a legacy version that uses the same test environment with all the users, and the new sandbox implementation that allows a separate test environment.

##### Stripe Test Legacy

To test the Stripe integration, set the `STRIPE_SECRET_KEY` and `STRIPE_ENDPOINT_SECRET`
secrets using `sst secrets set` (use `npm exec sst -- secrets set` to do this in the root of this project).

`STRIPE_SECRET_KEY ` should be set to the "secret" API key found on the test mode API keys page: https://dashboard.stripe.com/test/apikeys

To get a value for `STRIPE_ENDPOINT_SECRET` you'll need to create a webhook on https://dashboard.stripe.com/test/webhooks and point it at the Stripe webhook handler for your development server. You can get webhook handler URL by adding `/stripe` to the end of the
`w3infra-BillingStack` `ApiEndpoint` output after running `npm start` and letting it deploy.
The `STRIPE_ENDPOINT_SECRET` is the signing secret for your webhook and the full value will look something like `whsec_AEWftGyXzREfERw4nMyPDFVCerafe`. You can find it in the Stripe webhook dashboard.

You can use the `stripe` CLI to trigger test events, like:

```
stripe trigger checkout.session.completed
```

##### Stripe Sandbox

Setting up a sandbox is similar to the regular setup but includes a few additional steps for the pricing table configuration.

1. **Create a Sandbox:** Start by creating a new sandbox in the Stripe interface.
2. **Configure the Environment:** Follow the previous steps to set up the environment variables and the webhook.
3. **Set Up Products:**
   - Navigate to the **Product Catalog** page.
   - Create three products with a **Recurring** pricing model.
   - Configure each product's pricing model as follows:
     - **Usage-based**
     - **Per tier**
     - **Graduated**
   - Refer to the provided table to set the price values for each product.

| Product  | First unit | Last unit | Per unit | Flat fee |
| -------- | :--------: | --------: | -------: | -------: |
| Starter  |     0      |         5 |     0.00 |     0.00 |
|          |     6      |         ∞ |     0.15 |     0.00 |
| Lite     |     0      |       100 |     0.00 |    10.00 |
|          |    101     |         ∞ |     0.05 |     0.00 |
| Business |     0      |      2000 |     0.00 |   100.00 |
|          |    2001    |         ∞ |     0.03 |     0.00 |

4. **Create the Pricing Table:**
   - Go to the **Pricing Tables** section in the navigation bar.
   - Create a new table using the three products you set up earlier.
5. Set the new `STRIPE_PRICING_TABLE_ID` value using `npx sst secrets set`.

Once these steps are complete, your sandbox should be ready to use.

## Package Tests

To run per-package tests, first install Docker Desktop (https://www.docker.com/) and ensure it is running.

Next, ensure the `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables are set in your terminal. They do
not need to be set to real values - the following works in `bash`-like shells:

```
export AWS_REGION='us-west-2'; export AWS_ACCESS_KEY_ID='NOSUCH'; export AWS_SECRET_ACCESS_KEY='NOSUCH'
```

Finally, to run the tests for all packages, run:

```
npm test
```

Or to run the tests for a single package, run:

```
npm test -w <path/to/package>
```

## Integration tests

Integration tests run by default on post-deploy stage of [seed.run] deployment pipeline. These integration tests will run with the deployed infrastructure for the given stages (PR / staging).

It is also possible to run the integration tests with a development deploy of `sst`. For this, you can run:

```
npm run deploy
npm run test-integration
```

Please notice that appropriate environment variables must be set for the development deploy. For this you are required to setup your `.env.local` file as instructed in Getting started section. You can read more [here](https://gist.github.com/alanshaw/e949abfcf6728f590ac9fa083dba5648) on how to setup CI with a w3account.

### Environment Variables

Ensure the following variables are set in the env when deploying

#### `HOSTED_ZONES`

The root domain(s) to deploy the w3up API to. e.g `up.storacha.network`. The value should match a hosted zone configured in route53 that your aws account has access to. Multiple zones can be specified, in which case they are seperated by a comma, and this will cause deployment to each specified zone.

#### `ROUNDABOUT_HOSTED_ZONE`

The domain to deploy the roundabout API to. e.g `roundabout.web3.storage`. The value should match a hosted zone configured in route53 that your aws account has access to.

#### `ACCESS_SERVICE_URL`

URL of the w3access service.

#### `AGGREGATOR_DID`

DID of the filecoin aggregator service.

#### `AGGREGATOR_URL`

URL of the filecoin aggregator service.

#### `INDEXING_SERVICE_DID`

DID of the [indexing service](https://github.com/storacha/indexing-service).

#### `INDEXING_SERVICE_URL`

URL of the [indexing service](https://github.com/storacha/indexing-service).

#### `INDEXING_SERVICE_PROOF`

Proof that the upload service can publish claims to the [indexing service](https://github.com/storacha/indexing-service).

#### `DEAL_TRACKER_DID`

DID of the filecoin deal tracker service.

#### `DEAL_TRACKER_URL`

URL of the filecoin deal tracker service.

#### `UPLOAD_API_DID`

[DID](https://www.w3.org/TR/did-core/) of the upload-api ucanto server. e.g. `did:web:up.storacha.network`. Optional: if omitted, a `did:key` will be derrived from `PRIVATE_KEY`

#### `R2_ACCESS_KEY_ID`

Access key for S3 like cloud object storage to replicate content into.

#### `R2_SECRET_ACCESS_KEY`

Secret access key for S3 like cloud object storage to replicate content into.

#### `R2_ENDPOINT`

Endpoint for S3 like cloud object storage to replicate content into.

#### `R2_CARPARK_BUCKET_NAME`

Bucket name to replicate written CAR files.

#### `R2_DELEGATION_BUCKET_NAME`

Bucket name where delegations are stored.

#### `PRINCIPAL_MAPPING`

Optional - custom principal resolution mappings. JSON encoded mapping of did:web to did:key.

#### `PROVIDERS`

A comma-separated string of ServiceDIDs in use.

#### `SENTRY_DSN`

Data source name for Sentry application monitoring service.

#### `EIPFS_INDEXER_SQS_ARN`

AWS ARN for Elastic IPFS SQS indexer used to request Elastic IPFS to index given CAR files.

#### `EIPFS_INDEXER_SQS_URL`

AWS URL for Elastic IPFS SQS indexer used to request Elastic IPFS to index given CAR files.

#### `POSTMARK_TOKEN`

Postmark API token, which is used by the email verification system to send emails.

#### `MAILSLURP_API_KEY`

API token for [Mailslurp](https://www.mailslurp.com/), which is used in [integration tests](./test/integration.test.js). To invalidate or refresh tokens, head to the [Mailslurp dashboard](https://app.mailslurp.com/dashboard/).

### Secrets

Set production secrets in aws SSM via [`sst secrets`](https://docs.sst.dev/config#sst-secrets). The region must be set to the one you deploy that stage to

```sh
# set `PRIVATE_KEY` for prod
$ npx sst secrets set --region us-west-2 --stage prod PRIVATE_KEY "MgCblCY...="
```

To set a fallback value for `staging` or an ephmeral PR build use [`sst secrets set-fallback`](https://docs.sst.dev/config#fallback-values)

```sh
# set `PRIVATE_KEY` for any stage in us-east-2
$ npx sst secrets set --fallback --region us-east-2 PRIVATE_KEY "MgCZG7...="
```

**Note**: The fallback value can only be inherited by stages deployed in the same AWS account and region.

Confirm the secret value using [`sst secrets list`](https://docs.sst.dev/config#sst-secrets)

```sh
$ npx sst secrets list --region us-east-2
PRIVATE_KEY MgCZG7...= (fallback)

$ npx sst secrets list --region us-west-2 --stage prod
PRIVATE_KEY M...=
```

#### `PRIVATE_KEY`

The [`multibase`](https://github.com/multiformats/multibase) encoded ED25519 keypair used as the signing key for the upload-api.

Generated by [@ucanto/principal `EdSigner`](https://github.com/web3-storage/ucanto) via [`ucan-key`](https://www.npmjs.com/package/ucan-key)

_Example:_ `MgCZG7EvaA...1pX9as=`

#### `CONTENT_CLAIMS_PRIVATE_KEY`

The `base64pad` [`multibase`](https://github.com/multiformats/multibase) encoded ED25519 keypair used as the signing key for [content-claims](https://github.com/web3-storage/content-claims).

Generated by [@ucanto/principal `EdSigner`](https://github.com/web3-storage/ucanto) via [`ucan-key`](https://www.npmjs.com/package/ucan-key)

_Example:_ `MgCZG7EvaA...1pX9as=`

#### `UCAN_INVOCATION_POST_BASIC_AUTH`

The HTTP Basic auth token for the UCAN Invocation entrypoint, where UCAN invocations can be stored and proxied to the UCAN Stream.

_Example:_ `MgCZG7EvaA...1pX9as=`

#### `STRIPE_SECRET_KEY`

Stripe API key for reporting per customer usage.

## HTTP API

A UCAN based [RPC] API over HTTP.

### `POST /`

The RPC endpoint for invoking UCAN cababilities. Supported abilities are defined below in [UCAN Capabilities](#ucan-capabilities)

The POST body must contain a [CAR encoded UCAN](https://github.com/web3-storage/ucanto/blob/main/Readme.md#transport).

`Content-Type: application/car` header must be present in the the request headers.

### `POST /stripe`

An endpoint for receiving signed Stripe webhooks.

### `GET /version`

Returns version info for this api in JSON

```json
{
  "name": "@storacha/upload-api",
  "did": "did:foo:bar",
  "version": "3.0.0",
  "commit": "sha1",
  "branch": "main"
}
```

[SST]: https://sst.dev
[UCAN]: https://github.com/ucan-wg/spec/
[Ucanto]: https://www.npmjs.com/package/ucanto
[seed.run]: https://seed.run
[upload-service]: https://github.com/storacha/upload-service
[upload-client]: https://www.npmjs.com/package/@storacha/upload-client
