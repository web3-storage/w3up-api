<h1 align="center">⁂<br/>web3.storage</h1>
<p align="center">The Upload API for <a href="https://web3.storage">https://web3.storage</a></p>

A [UCAN] based API to for storing CARs and registering uploads, built on [ucanto] and [SST].

The server-side implementation of the `store/*` and `upload/*` capabilities defined in [w3protocol].

## Getting Started

The repo contains the infra deployment code and the api implementation.

```
├── api     - lambda & dynamoDB implementation of the upload-api http gateway
└── stacks  - sst and aws cdk code to deploy all the things 
```

To work on this codebase **you need**:

- Node.js >= v16 (prod env is node v16)
- An AWS account with the AWS CLI configured locally
- Copy `.env.tpl` to `.env.local`
- Install the deps with `npm i`

Deploy dev services to your aws account and start dev console

```console
npm start
```

See: https://docs.sst.dev for more info on how things get deployed.

## Deployment 

Deployment is managed by [seed.run]. PR's are deployed automatically to `https://<pr#>.up.web3.storage`. 

The `main` branch is deployed to https://staging.up.web3.storage and staging builds are promoted to prod manually via the UI at https://console.seed.run

### Environment Variables

Ensure the following variables are set in the env when deploying

#### `HOSTED_ZONE`

The root domain to deploy the API to. e.g `up.web3.storage`. The value should match a hosted zone configured in route53 that your aws account has access to.

#### `ACCESS_SERVICE_DID`

DID of the w3access service.

#### `ACCESS_SERVICE_URL`

URL of the w3access service.

### `R2_ACCESS_KEY_ID`

Access key for S3 like cloud object storage to replicate content into.

### `R2_SECRET_ACCESS_KEY`

Secret access key for S3 like cloud object storage to replicate content into.

### `R2_ENDPOINT`

Endpoint for S3 like cloud object storage to replicate content into.

### `R2_CAR_BUCKET_NAME`

Bucket name to replicate written CAR files.

### `R2_SATNAV_BUCKET_NAME`

Bucket name to replicate written .idx files.

### `R2_DUDEWHERE_BUCKET_NAME`

Bucket name to replicate root CID to car CIDs mapping.

### `SENTRY_DSN`

Data source name for Sentry application monitoring service.

### Secrets

Set production secrets in aws SSM via [`sst secrets`](https://docs.sst.dev/config#sst-secrets). The region must be set to the one you deploy that stage to

```sh
# set `PRIVATE_KEY` for prod
$ npx sst secrets set --region us-west-2 --stage prod PRIVATE_KEY "MgCblCY...="
```

To set a fallback value for `staging` or an ephmeral PR build use [`sst secrets set-fallback`](https://docs.sst.dev/config#fallback-values)

```sh
# set `PRIVATE_KEY` for any stage in us-east-2
$ npx sst secrets set-fallback --region us-east-2 PRIVATE_KEY "MgCZG7...="
```

**note** The fallback value can only be inherited by stages deployed in the same AWS account and region.

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

## HTTP API

A UCAN based [RPC] API over HTTP.

### `POST /`

The RPC endpoint for invoking UCAN cababilities. Supported abilities are defined below in [UCAN Capabilities](#ucan-capabilities)

The POST body must contain a [CAR encoded UCAN](https://github.com/web3-storage/ucanto/blob/main/Readme.md#transport).

`Content-Type: application/car` header must be present in the the request headers.

### `GET /version`

Returns version info for this api in JSON

```json
{ "name": "@web3-storage/upload-api", "did": "did:foo:bar", "version": "3.0.0", "commit": "sha1", "branch": "main" }
```

## UCAN Capabilities

Implements `store/*` and `upload/*` capabilities defined in [w3protocol]

### `store/add`

Register a CAR CID to be stored. Returns an S3 compatible signed upload URL usable for that CAR.

Source: [api/service/store/add.js](api/service/store/add.js)

### `store/list`

List the CAR CIDs for the issuer.

Source: [api/service/store/list.js](api/service/store/list.js)

### `store/remove`

Remove a CAR by CAR CID.

Source: [api/service/upoload/remove.js](api/service/store/remove.js)

### `upload/add`

Source: [api/service/upload/add.js](api/service/store/add.js)

### `upload/list`

Source: [api/service/upload/list.js](api/service/store/list.js)

### `upload/remove`

Source: [api/service/upload/remove.js](api/service/store/remove.js)

## Examples

Use the JS [upload-client] to handle the details of content-addressing your files, encoding them into a CAR, and sending it to the service with a valid UCAN.

```js
import { Agent } from '@web3-storage/access'
import { store } from '@web3-storage/access/capabilities/store'
import { uploadFile } from '@web3-storage/upload-client'

// holds your identity on this device
const agent = await Agent.create()

// your upload... either from a <input type=file> or from a path on your fs using `files-from-path`
const file = new Blob(['Hello World!'])

// the Content-Address for your file, derived client side before sending to the service.
// Returns once your data is safely stored.
const cid = await uploadFile({
  issuer: agent.issuer,
  with: agent.currentSpace(),
  proofs: agent.getProofs([store, upload]),
}, file)
```


[SST]: https://sst.dev
[UCAN]: https://github.com/ucan-wg/spec/
[ucanto]: https://www.npmjs.com/package/ucanto
[seed.run]: https://seed.run
[w3protocol]: https://github.com/web3-storage/w3protocol
[upload-client]: https://www.npmjs.com/package/@web3-storage/upload-client
