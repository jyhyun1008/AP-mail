import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signRequest } from "../../src/signatures/sign";
import { SignatureVerificationError } from "../../src/util/errors";
import { verifySignature } from "../../src/signatures/verify";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048, // small for fast tests; production uses 4096 (see actor/keys.ts)
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const keyId = "https://mail.example.com/users/jay#main-key";
const url = "https://mail.example.com/users/jay/inbox";
const path = "/users/jay/inbox";
const method = "POST";
const body = JSON.stringify({ type: "Create", object: { type: "Note", content: "hello" } });

function resolveKnownKey(id: string): Promise<string> {
  expect(id).toBe(keyId);
  return Promise.resolve(publicKey);
}

function signedHeaders() {
  const signed = signRequest({ privateKeyPem: privateKey, keyId, method, url, body });
  return {
    host: signed.Host,
    date: signed.Date,
    digest: signed.Digest,
    signature: signed.Signature,
  };
}

describe("signRequest / verifySignature round trip", () => {
  it("verifies a correctly signed request and returns the keyId", async () => {
    const headers = signedHeaders();

    const result = await verifySignature({ method, path, headers, rawBody: body }, resolveKnownKey);

    expect(result.keyId).toBe(keyId);
  });

  it("rejects when the body does not match the Digest header", async () => {
    const headers = signedHeaders();
    const tamperedBody = body.replace("hello", "goodbye");

    await expect(
      verifySignature({ method, path, headers, rawBody: tamperedBody }, resolveKnownKey),
    ).rejects.toThrow(SignatureVerificationError);
  });

  it("rejects a corrupted signature value", async () => {
    const headers = signedHeaders();
    headers.signature = headers.signature.replace('signature="', 'signature="AAAA');

    await expect(
      verifySignature({ method, path, headers, rawBody: body }, resolveKnownKey),
    ).rejects.toThrow(SignatureVerificationError);
  });

  it("rejects a request signed with a different keypair than the one resolved", async () => {
    const otherKeypair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const signed = signRequest({ privateKeyPem: otherKeypair.privateKey, keyId, method, url, body });
    const headers = {
      host: signed.Host,
      date: signed.Date,
      digest: signed.Digest,
      signature: signed.Signature,
    };

    // resolveKnownKey still returns the *original* public key, simulating a forged signature.
    await expect(
      verifySignature({ method, path, headers, rawBody: body }, resolveKnownKey),
    ).rejects.toThrow(SignatureVerificationError);
  });

  it("rejects a request with no Signature header at all", async () => {
    await expect(
      verifySignature({ method, path, headers: {}, rawBody: body }, resolveKnownKey),
    ).rejects.toThrow(SignatureVerificationError);
  });
});
