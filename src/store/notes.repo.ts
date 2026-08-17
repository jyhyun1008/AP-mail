import type Database from "better-sqlite3";

export type NoteDirection = "inbound_dm" | "outbound_email_sent";

export interface NewNoteRow {
  noteId: string;
  parentNoteId: string | null;
  senderEmail: string | null;
  subject: string | null;
  emailMessageId: string | null;
  emailReferences: string | null;
  direction: NoteDirection;
}

export interface NoteRow extends NewNoteRow {
  createdAt: string;
}

export interface RootThreadInfo {
  senderEmail: string;
  subject: string | null;
  emailMessageId: string;
  emailReferences: string | null;
}

export interface NotesRepo {
  insertNote(row: NewNoteRow): void;
  findNoteByNoteId(noteId: string): NoteRow | undefined;
  /**
   * Walks parent_note_id from `noteId` up to the nearest ancestor that carries
   * sender_email (the root row inserted by email-to-dm.ts) — resolving a reply,
   * or a reply-to-a-reply, back to the email it should ultimately answer.
   * Returns undefined if `noteId` is unknown or the chain never reaches a root.
   */
  findRootThreadInfo(noteId: string): RootThreadInfo | undefined;
}

interface NotesTableRow {
  note_id: string;
  parent_note_id: string | null;
  sender_email: string | null;
  subject: string | null;
  email_message_id: string | null;
  email_references: string | null;
  direction: NoteDirection;
  created_at: string;
}

function toNoteRow(row: NotesTableRow): NoteRow {
  return {
    noteId: row.note_id,
    parentNoteId: row.parent_note_id,
    senderEmail: row.sender_email,
    subject: row.subject,
    emailMessageId: row.email_message_id,
    emailReferences: row.email_references,
    direction: row.direction,
    createdAt: row.created_at,
  };
}

/** Typed CRUD over the `notes` correlation table. See src/store/schema.sql for the DDL. */
export function createNotesRepo(db: Database.Database): NotesRepo {
  const insertStmt = db.prepare(
    `INSERT INTO notes (note_id, parent_note_id, sender_email, subject, email_message_id, email_references, direction)
     VALUES (@noteId, @parentNoteId, @senderEmail, @subject, @emailMessageId, @emailReferences, @direction)`,
  );
  const findByNoteIdStmt = db.prepare(`SELECT * FROM notes WHERE note_id = ?`);

  // depth-capped to guard against a cyclic parent_note_id chain runaway-looping the query;
  // 50 hops is far more than any real reply-to-a-reply-to-a-reply thread should ever reach.
  const findRootThreadInfoStmt = db.prepare(`
    WITH RECURSIVE chain(note_id, parent_note_id, sender_email, subject, email_message_id, email_references, depth) AS (
      SELECT note_id, parent_note_id, sender_email, subject, email_message_id, email_references, 0
      FROM notes WHERE note_id = @noteId
      UNION ALL
      SELECT n.note_id, n.parent_note_id, n.sender_email, n.subject, n.email_message_id, n.email_references, c.depth + 1
      FROM notes n
      JOIN chain c ON n.note_id = c.parent_note_id
      WHERE c.depth < 50
    )
    SELECT sender_email, subject, email_message_id, email_references
    FROM chain
    WHERE sender_email IS NOT NULL
    LIMIT 1
  `);

  return {
    insertNote(row) {
      insertStmt.run(row);
    },
    findNoteByNoteId(noteId) {
      const row = findByNoteIdStmt.get(noteId) as NotesTableRow | undefined;
      return row ? toNoteRow(row) : undefined;
    },
    findRootThreadInfo(noteId) {
      const row = findRootThreadInfoStmt.get({ noteId }) as
        | { sender_email: string; subject: string | null; email_message_id: string; email_references: string | null }
        | undefined;
      if (!row) return undefined;
      return {
        senderEmail: row.sender_email,
        subject: row.subject,
        emailMessageId: row.email_message_id,
        emailReferences: row.email_references,
      };
    },
  };
}
