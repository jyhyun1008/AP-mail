import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRootEmailThread } from "../../src/bridge/thread-resolver";
import { openDatabase } from "../../src/store/db";
import { createNotesRepo, type NotesRepo } from "../../src/store/notes.repo";

let dbPath: string;
let db: ReturnType<typeof openDatabase>;
let notesRepo: NotesRepo;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apmail-thread-")), "test.sqlite");
  db = openDatabase(dbPath);
  notesRepo = createNotesRepo(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

describe("resolveRootEmailThread", () => {
  it("resolves directly when inReplyTo points straight at the root DM", () => {
    notesRepo.insertNote({
      noteId: "note://dm-1",
      parentNoteId: null,
      senderEmail: "alice@example.com",
      subject: "Hello",
      emailMessageId: "<msg-1@example.com>",
      emailReferences: null,
      direction: "inbound_dm",
    });

    const result = resolveRootEmailThread(notesRepo, "note://dm-1");

    expect(result).toEqual({
      senderEmail: "alice@example.com",
      subject: "Hello",
      emailMessageId: "<msg-1@example.com>",
      emailReferences: null,
    });
  });

  it("walks a multi-hop reply-to-a-reply chain back to the root", () => {
    notesRepo.insertNote({
      noteId: "note://dm-1",
      parentNoteId: null,
      senderEmail: "alice@example.com",
      subject: "Hello",
      emailMessageId: "<msg-1@example.com>",
      emailReferences: null,
      direction: "inbound_dm",
    });
    // first Misskey reply -> outbound email sent, tracked with no email fields of its own
    notesRepo.insertNote({
      noteId: "note://reply-1",
      parentNoteId: "note://dm-1",
      senderEmail: null,
      subject: null,
      emailMessageId: null,
      emailReferences: null,
      direction: "outbound_email_sent",
    });
    // second Misskey reply, replying to the first reply
    notesRepo.insertNote({
      noteId: "note://reply-2",
      parentNoteId: "note://reply-1",
      senderEmail: null,
      subject: null,
      emailMessageId: null,
      emailReferences: null,
      direction: "outbound_email_sent",
    });

    const result = resolveRootEmailThread(notesRepo, "note://reply-2");

    expect(result?.senderEmail).toBe("alice@example.com");
    expect(result?.emailMessageId).toBe("<msg-1@example.com>");
  });

  it("returns undefined for a note id it has never seen", () => {
    expect(resolveRootEmailThread(notesRepo, "note://unknown")).toBeUndefined();
  });

  it("returns undefined when the chain never reaches a root (all rows lack sender_email)", () => {
    notesRepo.insertNote({
      noteId: "note://orphan",
      parentNoteId: "note://nowhere",
      senderEmail: null,
      subject: null,
      emailMessageId: null,
      emailReferences: null,
      direction: "outbound_email_sent",
    });

    expect(resolveRootEmailThread(notesRepo, "note://orphan")).toBeUndefined();
  });
});
