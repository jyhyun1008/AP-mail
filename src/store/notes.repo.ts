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

export interface NotesRepo {
  insertNote(row: NewNoteRow): void;
  findNoteByNoteId(noteId: string): NoteRow | undefined;
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

  return {
    insertNote(row) {
      insertStmt.run(row);
    },
    findNoteByNoteId(noteId) {
      const row = findByNoteIdStmt.get(noteId) as NotesTableRow | undefined;
      return row ? toNoteRow(row) : undefined;
    },
  };
}
