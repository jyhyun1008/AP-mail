import type { NotesRepo, RootThreadInfo } from "../store/notes.repo";

/**
 * Resolves the Note a Misskey reply was made `inReplyTo` back to the original email
 * thread it should answer, walking through any number of reply-to-a-reply hops (see
 * notes.repo.ts's findRootThreadInfo for the actual recursive walk). Returns undefined
 * if the note is unknown to us or the chain never reaches a root row.
 */
export function resolveRootEmailThread(notesRepo: Pick<NotesRepo, "findRootThreadInfo">, inReplyToNoteId: string): RootThreadInfo | undefined {
  if (!inReplyToNoteId) return undefined;
  return notesRepo.findRootThreadInfo(inReplyToNoteId);
}
