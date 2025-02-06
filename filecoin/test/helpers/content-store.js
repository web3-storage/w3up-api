import { useContentStore } from '../../store/content.js'
import http from 'http'
import { CID } from 'multiformats'
import { sha256 } from 'multiformats/hashes/sha2'
import * as raw from 'multiformats/codecs/raw'

/**
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 * @typedef {import('@storacha/filecoin-api/test/types').TestContentStore<UnknownLink, Uint8Array>} TestContentStoreInterface
 * @typedef {import('@storacha/filecoin-api/storefront/api').ContentStore<UnknownLink, Uint8Array>} ContentStore
 */

/**
 * Test content store implementation.
 * Enables tests imported from `filecoin-api/storefront` to Put content into the store before adding
 * messages to submit queue to have Pieces derived from content bytes so that PieceCID provided is checked.
 * A HTTP Server is created to better emulate the production setup using roundabout under the hood.
 * 
 * @implements {TestContentStoreInterface}
 */
export class TestContentStore {
  static async activate() {
    const contentStorage = new Map()
    // Create Content Store HTTP Server to simulate Roundabout
    const server = http.createServer(async (request, response) => {
      if (request.method === 'GET') {
        const { pathname } = new URL(request.url || '/', url)
        const blobBytes = contentStorage.get(pathname.replaceAll('/', ''))
        if (!blobBytes) {
          response.writeHead(404)
        } else {
          response.writeHead(200)
          response.write(blobBytes)
        }
      } else {
        response.writeHead(405)
      }

      response.end()
      // otherwise it keep connection lingering
      response.destroy()
    })
    await new Promise((resolve) => server.listen(resolve))

    // @ts-ignore - this is actually what it returns on http
    const port = server.address().port
    const url = new URL(`http://localhost:${port}`)

    return new TestContentStore(
      useContentStore(url),
      server,
      contentStorage
    )
  }

  /**
   * @returns {Promise<void>}
   */
  async deactivate() {
    const { server } = this
    if (server) {
      await new Promise((resolve, reject) => {
        // does not exist in node 16
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections()
        }

        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve(undefined)
          }
        })
      })
    }
  }

  /**
   * @param {ContentStore} contentStore
   * @param {import('http').Server} server
   * @param {Map<string, Uint8Array>} contentStorage
   */
  constructor(contentStore, server, contentStorage) {
    this.server = server
    this.contentStore = contentStore
    this.contentStorage = contentStorage
  }

  /**
   * 
   * @param {import('@ucanto/interface').UnknownLink} cid 
   */
  async stream (cid) {
    return await this.contentStore.stream(cid)
  }

  /**
   * @param {Uint8Array} bytes 
   */
  async put (bytes) {
    // Put raw CID to content Storage, as this is going to be requested in tests this way
    // Content Storage in production may not how to differentiate between Blob, CAR, etc.
    const hash = await sha256.digest(bytes)
    const cid = CID.create(1, raw.code, hash)
    this.contentStorage.set(cid.toString(), bytes)

    return {
      ok: {}
    }
  }
}

