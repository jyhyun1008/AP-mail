import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";

export interface ParsedAttachment {
  filename: string;
  size: number;
  contentType: string;
  /** Raw bytes — held in memory only through the parse -> relay-decision pipeline, never persisted unless relayed (see bridge/attachment-relay.ts). */
  content: Buffer;
}

export interface ParsedInboundEmail {
  /** Sender's bare email address (the DM's reply target). */
  from: string;
  fromName?: string;
  subject: string;
  /** Plaintext body — falls back to a stripped version of the HTML part if no text part exists. */
  text: string;
  /** Message-ID header. Synthesized if the sender's mail somehow omitted one, so we always have a stable key. */
  messageId: string;
  /** Raw References header (space-separated Message-IDs), if present. */
  references?: string;
  /** Whether relayed as an AP attachment or just named in the DM text is decided downstream (see bridge/attachment-relay.ts), based on total size. */
  attachments: ParsedAttachment[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parses a raw RFC 822 message into the fields the bridge actually needs. */
export async function parseInboundEmail(raw: Buffer | string): Promise<ParsedInboundEmail> {
  const parsed = await simpleParser(raw);

  const fromAddress = parsed.from?.value?.[0];
  if (!fromAddress?.address) {
    throw new Error("Inbound email has no parseable From address");
  }

  const subject = parsed.subject?.trim() || "(no subject)";

  const plainText = parsed.text?.trim();
  const text = plainText && plainText.length > 0 ? plainText : stripHtml(String(parsed.html || "")) || "(empty message)";

  const messageId = parsed.messageId || `<generated-${randomUUID()}@apmail.local>`;

  const referencesRaw = parsed.references;
  const references = Array.isArray(referencesRaw) ? referencesRaw.join(" ") : referencesRaw || undefined;

  const attachments: ParsedAttachment[] = (parsed.attachments || []).map((a) => ({
    filename: a.filename || "attachment",
    size: a.size,
    contentType: a.contentType || "application/octet-stream",
    content: a.content,
  }));

  return {
    from: fromAddress.address,
    fromName: fromAddress.name || undefined,
    subject,
    text,
    messageId,
    references,
    attachments,
  };
}
