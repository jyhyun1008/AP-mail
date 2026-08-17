import type { Config } from "../config";
import type { ParsedInboundEmail } from "../mail/parse";
import type { ActorCache } from "../signatures/actor-cache";
import type { NotesRepo } from "../store/notes.repo";
import { logger } from "../util/logger";
import { relayAttachments, type AttachmentRelayResult } from "./attachment-relay";
import { deliverNoteToInbox } from "./deliver-note";
import { buildCreateNoteActivity } from "./outbound-note";

export interface EmailToDmDeps {
  config: Pick<
    Config,
    "bridgeDomain" | "bridgeUsername" | "allowedActorUri" | "dmMaxBodyChars" | "attachmentsDir" | "attachmentsMaxTotalBytes"
  >;
  actorCache: ActorCache;
  notesRepo: NotesRepo;
  privateKeyPem: string;
  publicKeyPem: string;
  /** `${actorId}#main-key` */
  keyId: string;
}

/**
 * Neutralizes leading `@`/`#` runs (mentions/hashtags in Misskey Flavored Markdown)
 * by slipping a zero-width space right after the symbol. Best-effort defense: arbitrary
 * inbound email is attacker-controlled text, and we don't want a signature block or a
 * quoted "From: someone@instance.example" line to render as a live mention/hashtag link
 * (or, worse, trip some remote-mention handling) once it lands as DM content.
 */
export function neutralizeMentionsAndHashtags(text: string): string {
  return text.replace(/([@#])(\S)/g, "$1​$2");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function truncate(text: string, maxChars: number): { text: string; originalLength: number; truncated: boolean } {
  if (text.length <= maxChars) return { text, originalLength: text.length, truncated: false };
  return { text: text.slice(0, maxChars), originalLength: text.length, truncated: true };
}

/**
 * Composes the DM body from a parsed email: sender line + subject + sanitized/truncated
 * body + a note about attachments — relayed ones get a "here they are" line, oversized
 * ones (see attachment-relay.ts) get a "not relayed, ask them to resend" line instead.
 * Exported for direct unit testing (see test/unit/email-to-dm.spec.ts).
 */
export function formatDmBody(email: ParsedInboundEmail, maxBodyChars: number, attachmentResult: AttachmentRelayResult): string {
  const fromLabel = email.fromName ? `${email.fromName} <${email.from}>` : email.from;
  const safeText = neutralizeMentionsAndHashtags(email.text);
  const { text: bodyText, originalLength, truncated } = truncate(safeText, maxBodyChars);

  const lines = [`New email from ${fromLabel}`, `Subject: ${email.subject}`, "", bodyText];

  if (truncated) {
    lines.push("", `[...truncated — original message was ${originalLength} characters]`);
  }

  if (attachmentResult.relayed.length > 0) {
    const list = attachmentResult.relayed.map((a) => a.name).join(", ");
    lines.push("", `📎 ${attachmentResult.relayed.length} attachment(s) attached to this note: ${list}`);
  }

  if (attachmentResult.skipped.length > 0) {
    const list = attachmentResult.skipped.map((a) => `${a.filename} (${formatBytes(a.size)})`).join(", ");
    lines.push("", `📎 ${attachmentResult.skipped.length} attachment(s) not relayed (over size limit): ${list}`);
  }

  return lines.join("\n");
}

/**
 * Orchestrates the inbound leg: parsed email -> attachments relayed (or skipped) -> signed
 * DM Create{Note} delivered to the one allowed recipient -> thread-correlation row
 * recorded so a later reply can find its way back to sender_email.
 */
export async function onInboundEmail(email: ParsedInboundEmail, deps: EmailToDmDeps): Promise<void> {
  const attachmentResult = relayAttachments(deps.config, email.attachments);
  const dmText = formatDmBody(email, deps.config.dmMaxBodyChars, attachmentResult);

  const { activity, noteId } = buildCreateNoteActivity(deps.config, dmText, deps.config.allowedActorUri, attachmentResult.relayed);

  const inboxUrl = await deps.actorCache.resolveInboxUrl(deps.config.allowedActorUri);

  await deliverNoteToInbox({
    activity,
    inboxUrl,
    privateKeyPem: deps.privateKeyPem,
    publicKeyPem: deps.publicKeyPem,
    keyId: deps.keyId,
  });

  deps.notesRepo.insertNote({
    noteId,
    parentNoteId: null,
    senderEmail: email.from,
    subject: email.subject,
    emailMessageId: email.messageId,
    emailReferences: email.references ?? null,
    direction: "inbound_dm",
  });

  logger.info(
    { from: email.from, subject: email.subject, noteId, attachmentsRelayed: attachmentResult.relayed.length, attachmentsSkipped: attachmentResult.skipped.length },
    "delivered inbound email as DM",
  );
}
