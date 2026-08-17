import { randomUUID } from "node:crypto";
import { actorId } from "../config";
import type { Config } from "../config";

export interface BuiltNote {
  activity: Record<string, unknown>;
  noteId: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text -> the minimal HTML AP clients expect in Note.content (escaped, newlines as <br>). */
function textToNoteContent(text: string): string {
  return escapeHtml(text).split("\n").join("<br>");
}

export interface NoteAttachment {
  url: string;
  mediaType: string;
  name: string;
}

/**
 * Builds a direct-message Create{Note} activity: addressed only `to: [toActorUri]`,
 * no `cc: Public` — this is what makes Misskey/Mastodon render it as a DM rather than
 * a public post. `dmText` should already be fully composed/sanitized/truncated by the
 * caller (see bridge/email-to-dm.ts) — this function only handles AP object shape.
 * `attachments`, if given, become the Note's `attachment` array (AP Document objects) —
 * the receiving server fetches each `url` itself to cache the media, we don't push bytes.
 */
export function buildCreateNoteActivity(
  config: Pick<Config, "bridgeDomain" | "bridgeUsername">,
  dmText: string,
  toActorUri: string,
  attachments: NoteAttachment[] = [],
): BuiltNote {
  const id = actorId(config);
  const publishedAt = new Date().toISOString();
  const noteId = `${id}/notes/${randomUUID()}`;
  const activityId = `${noteId}/activity`;

  const note = {
    id: noteId,
    type: "Note",
    attributedTo: id,
    to: [toActorUri],
    content: textToNoteContent(dmText),
    published: publishedAt,
    ...(attachments.length > 0
      ? {
          attachment: attachments.map((a) => ({
            type: "Document",
            mediaType: a.mediaType,
            url: a.url,
            name: a.name,
          })),
        }
      : {}),
  };

  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityId,
    type: "Create",
    actor: id,
    to: [toActorUri],
    published: publishedAt,
    object: note,
  };

  return { activity, noteId };
}
