/**
 * RFC 7231 §7.1.1.1 IMF-fixdate, e.g. "Sun, 06 Nov 1994 08:49:37 GMT".
 * Node's Date#toUTCString() already produces this exact format.
 */
export function httpDateNow(): string {
  return new Date().toUTCString();
}

export function httpDateFrom(date: Date): string {
  return date.toUTCString();
}
