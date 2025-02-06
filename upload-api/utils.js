const STREAM_TYPE = {
  WORKFLOW: 'workflow',
  RECEIPT: 'receipt'
}

/**
 * @param {import('./types.js').UcanStreamInvocation} ucanInvocation 
 */
export function hasOkReceipt (ucanInvocation) {
  return ucanInvocation.type === STREAM_TYPE.RECEIPT && Boolean(ucanInvocation.out?.ok)
}
