/**
 * Reason string sent when a page's stored snapshot can't be loaded. Sent with tldraw's fatal
 * close code (4099) so the sync client reports it as an error instead of reconnecting forever.
 */
export const SNAPSHOT_LOAD_FAILED_REASON = 'snapshot-load-failed'
