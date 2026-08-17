import { createHash, createVerify, timingSafeEqual } from "node:crypto";
import { SignatureVerificationError } from "../util/errors";

export interface ParsedSignature {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

/** Parses a `Signature: keyId="...",algorithm="...",headers="...",signature="..."` header value. */
export function parseSignatureHeader(headerValue: string): ParsedSignature {
  const fields: Record<string, string> = {};
  const pattern = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(headerValue)) !== null) {
    fields[match[1]] = match[2];
  }

  if (!fields.keyId || !fields.signature) {
    throw new SignatureVerificationError("Signature header missing keyId or signature");
  }

  return {
    keyId: fields.keyId,
    algorithm: fields.algorithm || "rsa-sha256",
    headers: (fields.headers || "date").split(" ").filter(Boolean),
    signature: fields.signature,
  };
}

export interface VerifyRequestParams {
  method: string;
  /** Request path + query string, e.g. "/inbox" or "/users/jay/inbox" — as sent on the wire, not an absolute URL. */
  path: string;
  /** Request headers, lowercase keys (as Node/Fastify already provide). */
  headers: Record<string, string | string[] | undefined>;
  /** The exact raw bytes of the request body, as a string. */
  rawBody: string;
}

function getHeader(headers: VerifyRequestParams["headers"], name: string): string {
  const value = headers[name.toLowerCase()];
  if (value === undefined) {
    throw new SignatureVerificationError(`Missing required signed header: ${name}`);
  }
  return Array.isArray(value) ? value[0] : value;
}

function verifyDigestMatchesBody(digestHeaderValue: string, rawBody: string): void {
  const separatorIndex = digestHeaderValue.indexOf("=");
  if (separatorIndex === -1) {
    throw new SignatureVerificationError("Malformed Digest header");
  }
  const algorithm = digestHeaderValue.slice(0, separatorIndex).toUpperCase();
  if (algorithm !== "SHA-256") {
    throw new SignatureVerificationError(`Unsupported Digest algorithm: ${algorithm}`);
  }
  const claimedDigest = digestHeaderValue.slice(separatorIndex + 1);
  const actualDigest = createHash("sha256").update(rawBody).digest("base64");

  const claimedBuf = Buffer.from(claimedDigest, "base64");
  const actualBuf = Buffer.from(actualDigest, "base64");
  if (
    claimedBuf.length !== actualBuf.length ||
    !timingSafeEqual(claimedBuf, actualBuf)
  ) {
    throw new SignatureVerificationError("Digest header does not match request body");
  }
}

/**
 * Verifies an inbound HTTP-signed request. Resolves the signer's public key via the
 * injected `resolvePublicKeyPem` callback (kept as an injected dependency, rather than
 * importing the actor cache directly, so this module is unit-testable without network
 * access). Throws SignatureVerificationError on any failure; returns the verified keyId
 * on success (callers resolve keyId -> actor identity themselves).
 */
export async function verifySignature(
  params: VerifyRequestParams,
  resolvePublicKeyPem: (keyId: string) => Promise<string>,
): Promise<{ keyId: string }> {
  const signatureHeader = getHeader(params.headers, "signature");
  const parsed = parseSignatureHeader(signatureHeader);

  if (parsed.algorithm.toLowerCase() !== "rsa-sha256") {
    throw new SignatureVerificationError(`Unsupported signature algorithm: ${parsed.algorithm}`);
  }

  if (parsed.headers.includes("digest")) {
    const digestHeader = getHeader(params.headers, "digest");
    verifyDigestMatchesBody(digestHeader, params.rawBody);
  }

  const signingString = parsed.headers
    .map((name) => {
      if (name === "(request-target)") {
        return `(request-target): ${params.method.toLowerCase()} ${params.path}`;
      }
      return `${name}: ${getHeader(params.headers, name)}`;
    })
    .join("\n");

  const publicKeyPem = await resolvePublicKeyPem(parsed.keyId);

  const isValid = createVerify("RSA-SHA256").update(signingString).verify(publicKeyPem, parsed.signature, "base64");

  if (!isValid) {
    throw new SignatureVerificationError("Signature does not verify against signer's public key");
  }

  return { keyId: parsed.keyId };
}
