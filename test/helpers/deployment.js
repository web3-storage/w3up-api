import fs from 'fs'
import path from 'path'

import { createRequire } from 'module'
import { S3Client } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

// Either seed.run deployment, or development deploy outputs-file
// https://seed.run/docs/adding-a-post-deploy-phase.html#post-deploy-phase-environment
export function getStage () {
  const stage = process.env.SST_STAGE || process.env.SEED_STAGE_NAME
  if (stage) {
    return stage
  }

  return fs.readFileSync(path.join(process.cwd(), '.sst', 'stage'), 'utf8')
}

export const getStackName = () => {
  const stage = getStage()
  return `${stage}-w3infra`
}

export const getCloudflareBucketClient = () => new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || '',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

export const getAwsBucketClient = (region = getAwsRegion()) => new S3Client({
  region
})

export const getApiEndpoint = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    const stage = getStage()
    return `https://${stage}.up.storacha.network`
  }

  const require = createRequire(import.meta.url)
  const testEnv = require(path.join(
    process.cwd(),
    '.sst/outputs.json'
  ))

  // Get Upload API endpoint
  const id = 'UploadApiStack'
  return JSON.parse(testEnv[`${getStackName()}-${id}`].ApiEndpoints)[0]
}

export const getRoundaboutEndpoint = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    const stage = getStage()
    return `https://${stage}.roundabout.web3.storage`
  }

  const require = createRequire(import.meta.url)
  const testEnv = require(path.join(
    process.cwd(),
    '.sst/outputs.json'
  ))

  // Get Roundabout API endpoint
  const id = 'RoundaboutStack'
  return testEnv[`${getStackName()}-${id}`].ApiEndpoint
}

export const getReceiptsEndpoint = () => {
  return `${getApiEndpoint()}/receipt/`
}

export const getCarparkBucketInfo = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    const stage = getStage()
    return {
      Bucket: `carpark-${stage}-0`,
      Region: 'us-east-2'
    }
  }

  const require = createRequire(import.meta.url)
  const testEnv = require(path.join(
    process.cwd(),
    '.sst/outputs.json'
  ))

  // Get Carpark metadata
  const id = 'CarparkStack'
  return {
    Bucket: testEnv[`${getStackName()}-${id}`].BucketName,
    Region: testEnv[`${getStackName()}-${id}`].Region,
  }
}

export const getAwsRegion = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    return 'us-east-2'
  }

  return 'us-west-2'
}

/**
 * @param {string} tableName 
 */
export const getDynamoDb = (tableName) => {
  const region = getAwsRegion()
  const endpoint = `https://dynamodb.${region}.amazonaws.com`

  return {
    client: new DynamoDBClient({
      region,
      endpoint
    }),
    tableName: `${getStackName()}-${tableName}`,
    region,
    endpoint
  }
}
