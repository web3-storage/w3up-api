import { Link } from '@ucanto/server'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef { import('../lib/api.js').EgressTrafficData } EgressTrafficData
 * @typedef { import('../types.js').InferStoreRecord<EgressTrafficData> & { pk: string, sk: string } } EgressTrafficStoreRecord
 * @typedef {{ pk: string, sk: string }} EgressTrafficKeyStoreRecord
 */

export const egressSchema = Schema.struct({
  space: Schema.did({ method: 'key' }),
  customer: Schema.did({ method: 'mailto' }),
  resource: Schema.link(),
  bytes: Schema.number(),
  servedAt: Schema.date(),
  cause: Schema.link(),
})

/** @type {import('../lib/api.js').Validator<EgressTrafficData>} */
export const validate = input => egressSchema.read(input)

/** @type {import('../lib/api.js').Encoder<EgressTrafficData, EgressTrafficStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        pk: `${input.space.toString()}#${input.resource.toString()}`,
        sk: `${input.servedAt.toISOString()}#${input.cause.toString()}`,
        space: input.space.toString(),
        customer: input.customer.toString(),
        resource: input.resource.toString(),
        bytes: Number(input.bytes),
        servedAt: input.servedAt.toISOString(),
        cause: input.cause.toString(),
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding string egress event: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api.js').Encoder<import('../lib/api.js').EgressTrafficData, string>} */
export const encodeStr = input => {
  try {
    const data = encode(input)
    if (data.error) throw data.error
    return { ok: JSON.stringify(data.ok) }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding string egress event: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api.js').Decoder<import('../types.js').StoreRecord, import('../lib/api.js').EgressTrafficData>} */
export const decode = input => {
  try {
    return {
      ok: {
        space: Schema.did({ method: 'key' }).from(input.space),
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        resource: Link.parse(/** @type {string} */(input.resource)),
        bytes: Number(input.bytes),
        servedAt: new Date(input.servedAt),
        cause: Link.parse(/** @type {string} */(input.cause)),
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding egress event: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api.js').Decoder<string, import('../lib/api.js').EgressTrafficData>} */
export const decodeStr = input => {
  try {
    return decode(JSON.parse(input))
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding str egress traffic event: ${err.message}`, { cause: err })
    }
  }
}

export const lister = {
  /** @type {import('../lib/api.js').Encoder<import('../lib/api.js').EgressTrafficEventListKey, EgressTrafficKeyStoreRecord>} */
  encodeKey: input => ({
    ok: {
      pk: `${input.space.toString()}#${input.resource.toString()}`,
      sk: `${input.servedAt.toISOString()}#${input.cause.toString()}`,
    }
  }),
  /** @type {import('../lib/api.js').Decoder<EgressTrafficKeyStoreRecord, import('../lib/api.js').EgressTrafficEventListKey>} */
  decodeKey: input => {
    try {
      const [space, resource] = input.pk.split('#')
      const [servedAt, cause] = input.sk.split('#')
      return {
        ok: {
          space: Schema.did({ method: 'key' }).from(space),
          resource: Link.parse(resource),
          servedAt: new Date(servedAt),
          cause: Link.parse(cause),
        }
      }
    } catch (/** @type {any} */ err) {
      return {
        error: new DecodeFailure(`decoding egress traffic event list key: ${err.message}`, { cause: err })
      }
    }
  }
}