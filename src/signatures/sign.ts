import { createHash, createSign } from "node:crypto";

export interface SignRequestParams {
  privateKeyPem: string;
  /** e.g. `${actorId}#main-key` */
  keyId: string;
  method: string;
  /** Absolute URL of the target request. */
  url: string;
  /** Raw request body that will actually be sent (Digest is computed over these exact bytes). */
  body: string;
}

export interface SignedHeaders {
  Host: string;
  Date: string;
  Digest: string;
  Signature: string;
}

const SIGNED_HEADER_NAMES = "(request-target) host date digest";

/**
 * Builds the Host/Date/Digest/Signature headers for an outbound AP delivery,
 * per the HTTP Signatures draft that Mastodon/Misskey use in practice.
 */
export function signRequest(params: SignRequestParams): SignedHeaders {
  const { privateKeyPem, keyId, method, url, body } = params;
  const target = new URL(url);

  const host = target.host;
  const date = new Date().toUTCString();
  const digest = `SHA-256=${createHash("sha256").update(body).digest("base64")}`;
  const requestTarget = `${method.toLowerCase()} ${target.pathname}${target.search}`;

  const signingString = [
    `(request-target): ${requestTarget}`,
    `host: ${host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join("\n");

  const signature = createSign("RSA-SHA256").update(signingString).sign(privateKeyPem, "base64");

  const signatureHeader = [
    `keyId="${keyId}"`,
    `algorithm="rsa-sha256"`,
    `headers="${SIGNED_HEADER_NAMES}"`,
    `signature="${signature}"`,
  ].join(",");

  return {
    Host: host,
    Date: date,
    Digest: digest,
    Signature: signatureHeader,
  };
}
