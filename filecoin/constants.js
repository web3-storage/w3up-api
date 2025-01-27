import {
  aggregateOffer,
  aggregateAccept
} from '@storacha/capabilities/filecoin/dealer'

export const STREAM_TYPE = {
  WORKFLOW: 'workflow',
  RECEIPT: 'receipt'
}

// UCAN protocol
export const AGGREGATE_OFFER = aggregateOffer.can
export const AGGREGATE_ACCEPT = aggregateAccept.can

// Admin Metrics
export const METRICS_NAMES = {
  AGGREGATE_OFFER_TOTAL: `${AGGREGATE_OFFER}-total`,
  AGGREGATE_OFFER_PIECES_TOTAL: `${AGGREGATE_OFFER}-pieces-total`,
  AGGREGATE_OFFER_PIECES_SIZE_TOTAL: `${AGGREGATE_OFFER}-pieces-size-total`,
  AGGREGATE_ACCEPT_TOTAL: `${AGGREGATE_ACCEPT}-total`,
}
