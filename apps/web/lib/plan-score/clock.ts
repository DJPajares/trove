/**
 * Plan Score timestamps are the server's. Judging them against a device clock
 * that runs even a second behind makes a freshly computed assessment look like
 * it comes from the future, so freshness is judged in server time: the API
 * stamps every response, and the offset from that stamp corrects the device.
 */

/** Matches the API's `SERVED_AT_HEADER`. */
const SERVED_AT_HEADER = 'x-trove-served-at';

/**
 * How far ahead of the corrected clock a server timestamp may be and still be
 * trusted: covers response latency and any request served before an offset is
 * known.
 */
export const CLOCK_LEEWAY_MS = 60_000;

let offsetMs = 0;

/** Learns the device's offset from a response's serving time. */
export function observeServerTime(response: Pick<Response, 'headers'>, receivedAt = Date.now()) {
  const servedAt = Date.parse(response.headers.get(SERVED_AT_HEADER) ?? '');
  if (Number.isFinite(servedAt)) offsetMs = servedAt - receivedAt;
}

/** The server's time for a device instant, defaulting to now. */
export function serverNow(deviceMs = Date.now()) {
  return deviceMs + offsetMs;
}

/** Test seam: the offset is module state that outlives any one request. */
export function resetServerClock() {
  offsetMs = 0;
}
