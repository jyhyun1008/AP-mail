import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleInboxActivity, type InboundActivityDeps } from "../../src/bridge/inbound-activity";
import type { ReplyEmailParams } from "../../src/mail/send";
import { openDatabase } from "../../src/store/db";
import { createNotesRepo, type NotesRepo } from "../../src/store/notes.repo";

const ALLOWED_ACTOR_URI = "https://misskey.example.com/users/jay";
const OTHER_ACTOR_URI = "https://misskey.example.com/users/someone-else";

let dbPath: string;
let db: ReturnType<typeof openDatabase>;
let notesRepo: NotesRepo;
let sendReplyEmail: ReturnType<typeof vi.fn<(params: ReplyEmailParams) => Promise<void>>>;
let deps: InboundActivityDeps;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apmail-guard-")), "test.sqlite");
  db = openDatabase(dbPath);
  notesRepo = createNotesRepo(db);
  sendReplyEmail = vi.fn().mockResolvedValue(undefined);

  deps = {
    config: { allowedActorUri: ALLOWED_ACTOR_URI, bridgeDomain: "mail.example.com", bridgeUsername: "jay" },
    actorCache: {
      resolvePublicKeyPem: vi.fn().mockResolvedValue("unused"),
      resolveInboxUrl: vi.fn().mockResolvedValue("https://misskey.example.com/users/jay/inbox"),
    },
    notesRepo,
    privateKeyPem: "unused",
    keyId: "https://mail.example.com/users/jay#main-key",
    sendReplyEmail,
  };
});

afterEach(() => {
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("handleInboxActivity — authorization guard", () => {
  it("rejects (403) an activity from a verified actor that is not the allowed one, even with a well-formed payload", async () => {
    const result = await handleInboxActivity(
      { type: "Create", actor: OTHER_ACTOR_URI, object: { type: "Note", id: "note://x", inReplyTo: "note://y" } },
      OTHER_ACTOR_URI,
      deps,
    );

    expect(result.status).toBe(403);
    expect(sendReplyEmail).not.toHaveBeenCalled();
  });

  it("rejects (400) when activity.actor disagrees with the cryptographically verified signer", async () => {
    const result = await handleInboxActivity(
      { type: "Create", actor: OTHER_ACTOR_URI, object: { type: "Note", id: "note://x", inReplyTo: "note://y" } },
      ALLOWED_ACTOR_URI, // signature actually verified as the allowed actor, but claims to be someone else
      deps,
    );

    expect(result.status).toBe(400);
    expect(sendReplyEmail).not.toHaveBeenCalled();
  });

  it("processes a Create{Note} reply from the allowed actor and sends the reply email", async () => {
    notesRepo.insertNote({
      noteId: "note://dm-1",
      parentNoteId: null,
      senderEmail: "alice@example.com",
      subject: "Hello",
      emailMessageId: "<msg-1@example.com>",
      emailReferences: null,
      direction: "inbound_dm",
    });

    const result = await handleInboxActivity(
      {
        type: "Create",
        actor: ALLOWED_ACTOR_URI,
        object: { type: "Note", id: "note://reply-1", inReplyTo: "note://dm-1", content: "<p>thanks!</p>" },
      },
      ALLOWED_ACTOR_URI,
      deps,
    );

    expect(result.status).toBe(202);
    expect(sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alice@example.com", subject: "Re: Hello", text: "thanks!" }),
    );
    expect(notesRepo.findNoteByNoteId("note://reply-1")).toBeDefined();
  });

  it("silently drops a Create{Note} reply that doesn't resolve to a known thread", async () => {
    const result = await handleInboxActivity(
      { type: "Create", actor: ALLOWED_ACTOR_URI, object: { type: "Note", id: "note://reply-1", inReplyTo: "note://unknown" } },
      ALLOWED_ACTOR_URI,
      deps,
    );

    expect(result.status).toBe(202);
    expect(sendReplyEmail).not.toHaveBeenCalled();
  });

  it("delivers Accept in response to Follow from the allowed actor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    // Follow handling actually signs an Accept activity for real (unlike the other cases
    // here), so it needs a real PEM keypair rather than the "unused" placeholder.
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    deps.privateKeyPem = privateKey;

    const result = await handleInboxActivity({ type: "Follow", actor: ALLOWED_ACTOR_URI, id: "follow://1" }, ALLOWED_ACTOR_URI, deps);

    expect(result.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    const sentActivity = JSON.parse(requestInit.body as string);
    expect(sentActivity.type).toBe("Accept");
  });

  it("no-ops (202) for Undo/Delete and unknown activity types", async () => {
    for (const type of ["Undo", "Delete", "SomethingUnknown"]) {
      const result = await handleInboxActivity({ type, actor: ALLOWED_ACTOR_URI }, ALLOWED_ACTOR_URI, deps);
      expect(result.status).toBe(202);
    }
    expect(sendReplyEmail).not.toHaveBeenCalled();
  });
});
