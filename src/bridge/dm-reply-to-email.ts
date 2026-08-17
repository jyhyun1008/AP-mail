import type { Config } from "../config";
import type { NotesRepo } from "../store/notes.repo";
import { logger } from "../util/logger";
import { stripHtml } from "../util/strip-html";
import type { ReplyEmailParams } from "../mail/send";
import { resolveRootEmailThread } from "./thread-resolver";

export interface DmReplyToEmailDeps {
  config: Pick<Config, "bridgeUsername" | "bridgeDomain">;
  notesRepo: NotesRepo;
  sendReplyEmail: (params: ReplyEmailParams) => Promise<void>;
}

interface ApNoteObject {
  id?: string;
  inReplyTo?: string;
  content?: string;
  /** Misskey-specific extension: the reply's original MFM text, cleaner than stripping the rendered `content` HTML. */
  source?: { content?: string };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Misskey's reply compose box auto-prepends "@<botuser>@<botdomain> " to whatever the
 * user types — standard reply-mention UX for a human audience, but meaningless noise to
 * the email recipient on the other end, who has no idea what a fediverse handle is.
 * Strips it (only our own bot's handle specifically, not any mention — an actual
 * mention of someone else the user typed on purpose is left alone).
 */
function stripLeadingSelfMention(text: string, botHandle: string): string {
  const pattern = new RegExp(`^@${escapeRegExp(botHandle)}\\s*`, "i");
  let result = text;
  for (let i = 0; i < 3 && pattern.test(result); i++) {
    result = result.replace(pattern, "");
  }
  return result.trimStart();
}

/** Prefers Misskey's `source.content` (raw text) over stripping HTML out of the rendered `content`. */
function extractReplyText(note: ApNoteObject, botHandle: string): string {
  const raw =
    typeof note.source?.content === "string" && note.source.content.trim().length > 0
      ? note.source.content.trim()
      : stripHtml(note.content || "");
  const cleaned = stripLeadingSelfMention(raw, botHandle);
  return cleaned || "(empty reply)";
}

function buildReplySubject(originalSubject: string | null): string {
  const base = originalSubject || "(no subject)";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/**
 * Orchestrates the outbound leg: a verified, allowed reply Create{Note} -> resolve which
 * email thread it answers -> send the reply email, threaded via In-Reply-To/References ->
 * record this reply Note too, so a *further* reply-to-this-reply in Misskey still resolves
 * back to the same original sender.
 */
export async function onInboxReplyActivity(note: ApNoteObject, deps: DmReplyToEmailDeps): Promise<void> {
  if (!note.id || !note.inReplyTo) {
    logger.warn({ noteId: note.id }, "reply Note missing id or inReplyTo; dropping");
    return;
  }

  const thread = resolveRootEmailThread(deps.notesRepo, note.inReplyTo);
  if (!thread) {
    logger.warn({ inReplyTo: note.inReplyTo }, "could not resolve reply to a known email thread; dropping");
    return;
  }

  const botHandle = `${deps.config.bridgeUsername}@${deps.config.bridgeDomain}`;
  const replyText = extractReplyText(note, botHandle);
  const references = [thread.emailReferences, thread.emailMessageId].filter(Boolean).join(" ");

  await deps.sendReplyEmail({
    to: thread.senderEmail,
    subject: buildReplySubject(thread.subject),
    text: replyText,
    inReplyToMessageId: thread.emailMessageId,
    referencesHeaderValue: references || undefined,
  });

  deps.notesRepo.insertNote({
    noteId: note.id,
    parentNoteId: note.inReplyTo,
    senderEmail: null,
    subject: null,
    emailMessageId: null,
    emailReferences: null,
    direction: "outbound_email_sent",
  });

  logger.info({ to: thread.senderEmail, noteId: note.id }, "sent reply email for Misskey DM reply");
}
