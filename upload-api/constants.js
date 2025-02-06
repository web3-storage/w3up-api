import { 
  add as storeAdd,
  remove as storeRemove
} from '@storacha/capabilities/store'
import {
  add as uploadAdd,
  remove as uploadRemove
} from '@storacha/capabilities/upload'
import {
  add as blobAdd,
  remove as blobRemove
} from '@storacha/capabilities/space/blob'

// UCAN protocol
export const BLOB_ADD = blobAdd.can
export const BLOB_REMOVE = blobRemove.can
export const STORE_ADD = storeAdd.can
export const STORE_REMOVE = storeRemove.can
export const UPLOAD_ADD = uploadAdd.can
export const UPLOAD_REMOVE = uploadRemove.can

// Admin Metrics
export const METRICS_NAMES = {
  UPLOAD_ADD_TOTAL: `${UPLOAD_ADD}-total`,
  UPLOAD_REMOVE_TOTAL: `${UPLOAD_REMOVE}-total`,
  BLOB_ADD_TOTAL: `${BLOB_ADD}-total`,
  BLOB_ADD_SIZE_TOTAL: `${BLOB_ADD}-size-total`,
  BLOB_REMOVE_TOTAL: `${BLOB_REMOVE}-total`,
  BLOB_REMOVE_SIZE_TOTAL: `${BLOB_REMOVE}-size-total`,
  STORE_ADD_TOTAL: `${STORE_ADD}-total`,
  STORE_ADD_SIZE_TOTAL: `${STORE_ADD}-size-total`,
  STORE_REMOVE_TOTAL: `${STORE_REMOVE}-total`,
  STORE_REMOVE_SIZE_TOTAL: `${STORE_REMOVE}-size-total`,
}

// Space Metrics
export const SPACE_METRICS_NAMES = {
  UPLOAD_ADD_TOTAL: `${UPLOAD_ADD}-total`,
  UPLOAD_REMOVE_TOTAL: `${UPLOAD_REMOVE}-total`,
  BLOB_ADD_TOTAL: `${BLOB_ADD}-total`,
  BLOB_ADD_SIZE_TOTAL: `${BLOB_ADD}-size-total`,
  BLOB_REMOVE_TOTAL: `${BLOB_REMOVE}-total`,
  BLOB_REMOVE_SIZE_TOTAL: `${BLOB_REMOVE}-size-total`,
  STORE_ADD_TOTAL: `${STORE_ADD}-total`,
  STORE_ADD_SIZE_TOTAL: `${STORE_ADD}-size-total`,
  STORE_REMOVE_TOTAL: `${STORE_REMOVE}-total`,
  STORE_REMOVE_SIZE_TOTAL: `${STORE_REMOVE}-size-total`,
}
