import { signRequest } from "../signatures/sign";
import { verifySignature } from "../signatures/verify";
import { logger } from "../util/logger";

export interface DeliverNoteParams {
  activity: Record<string, unknown>;
  inboxUrl: string;
  privateKeyPem: string;
  /** Paired with privateKeyPem — used only for the pre-flight self-check below, never sent anywhere. */
  publicKeyPem: string;
  /** `${actorId}#main-key` */
  keyId: string;
}

/**
 * Signs and POSTs an activity to a remote inbox. No retry in v1 — a failed delivery
 * is logged by the caller and the email is simply not bridged; revisit if this proves
 * to matter in practice.
 */
export async function deliverNoteToInbox(params: DeliverNoteParams): Promise<void> {
  const body = JSON.stringify(params.activity);
  const target = new URL(params.inboxUrl);

  // Host is intentionally omitted here — it's derived from `inboxUrl` by both the
  // signer (see signRequest) and fetch's own request line, so they always agree.
  const signed = signRequest({
    privateKeyPem: params.privateKeyPem,
    keyId: params.keyId,
    method: "POST",
    url: params.inboxUrl,
    body,
  });

  // Pre-flight self-check: verify our own just-built signature with our own verify.ts,
  // using the same public key the remote side will fetch. This can't catch every
  // possible interop quirk with a specific remote implementation, but it does prove
  // whether our sign/verify pair is internally consistent on *this* real request (not
  // just in unit test fixtures) — added while chasing a persistent, otherwise
  // unexplained "signature verification failed" on the remote end after ruling out
  // stale caches, wrong key paths, key mismatches, and clock skew.
  try {
    await verifySignature(
      {
        method: "POST",
        path: `${target.pathname}${target.search}`,
        headers: { host: signed.Host, date: signed.Date, digest: signed.Digest, signature: signed.Signature },
        rawBody: body,
      },
      async () => params.publicKeyPem,
    );
    logger.info({ inboxUrl: params.inboxUrl }, "pre-flight self-check passed: our own signature verifies against our own key");
  } catch (err) {
    logger.error({ err, inboxUrl: params.inboxUrl }, "pre-flight self-check FAILED — this is a real bug in our own sign/verify, not a remote-side issue");
  }

  // Logged unconditionally (not just on failure): a remote inbox commonly returns 2xx
  // just for *queuing* the activity, with signature verification happening later in an
  // async job — so a successful response here is no guarantee the signature actually
  // checked out on the other end. This is the only record we have of exactly what we
  // signed/sent for a given delivery, to cross-reference against a remote-side failure.
  logger.info(
    {
      inboxUrl: params.inboxUrl,
      keyId: params.keyId,
      host: signed.Host,
      date: signed.Date,
      digest: signed.Digest,
      requestTarget: `post ${target.pathname}${target.search}`,
    },
    "signed activity delivery",
  );

  const response = await fetch(params.inboxUrl, {
    method: "POST",
    headers: {
      "content-type": "application/activity+json",
      accept: "application/activity+json",
      date: signed.Date,
      digest: signed.Digest,
      signature: signed.Signature,
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Delivery to ${params.inboxUrl} failed: HTTP ${response.status} ${detail}`.trim());
  }
}
