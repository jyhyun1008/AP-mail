import { signRequest } from "../signatures/sign";

export interface DeliverNoteParams {
  activity: Record<string, unknown>;
  inboxUrl: string;
  privateKeyPem: string;
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

  // Host is intentionally omitted here — it's derived from `inboxUrl` by both the
  // signer (see signRequest) and fetch's own request line, so they always agree.
  const signed = signRequest({
    privateKeyPem: params.privateKeyPem,
    keyId: params.keyId,
    method: "POST",
    url: params.inboxUrl,
    body,
  });

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
