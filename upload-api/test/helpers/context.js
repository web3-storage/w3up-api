import anyTest from 'ava'

/**
 * @typedef {object} DynamoContext
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @typedef {object} S3Context
 * @property {import('@aws-sdk/client-s3').S3Client} s3
 * @typedef {import('@ucanto/principal/ed25519').Signer.Signer<`did:web:${string}`, import('@ucanto/principal/ed25519').SigAlg>} Signer
 * @typedef {object} ServiceContext
 * @property {Signer} service
 * @typedef {object} GetMetricsContext
 * @property {import('../../types.js').MetricsTable} metricsTable
 * @property {string} tableName
 *
 * @typedef {import("ava").TestFn<DynamoContext & S3Context & ServiceContext>} Test
 * @typedef {import("ava").TestFn<DynamoContext>} TestDynamo
 * @typedef {import("ava").TestFn<S3Context>} TestS3
 * @typedef {import("ava").TestFn<DynamoContext & GetMetricsContext>} TestGetMetrics
 * @typedef {import("ava").TestFn<ServiceContext>} TestService
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const s3 = /** @type {TestS3} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const dynamo = /** @type {TestDynamo} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const test = /** @type {Test} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testGetMetrics = /** @type {TestGetMetrics} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const service = /** @type {TestService} */ (anyTest)

