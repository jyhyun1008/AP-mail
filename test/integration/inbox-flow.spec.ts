import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/server";
import { signRequest } from "../../src/signatures/sign";
import type { ActorCache } from "../../src/signatures/actor-cache";
import { openDatabase } from "../../src/store/db";
import { createNotesRepo, type NotesRepo } from "../../src/store/notes.repo";
import type { Config } from "../../src/config";

// Full round trip through the real HTTP layer (via Fastify's .inject(), no socket bound):
// a self-signed Create{Note} reply activity, as Misskey would send it, POSTed to /inbox ->
// signature verified against a stubbed actor cache (no real network) -> guard passes ->
// thread resolved from a seeded `notes` row -> the injected sendReplyEmail is called with
// the right recipient/threading fields.

const config: Config = {
  bridgeDomain: "mail.example.com",
  bridgeUsername: "jay",
  bridgeActorType: "Service",
  bridgeActorName: undefined,
  bridgeActorIconUrl: undefined,
  allowedActorUri: "https://misskey.example.com/users/jay",
  httpPort: 0,
  httpHost: "127.0.0.1",
  actorPrivateKeyPath: "",
  actorPublicKeyPath: "",
  dbPath: "",
  inboundSmtpHost: "127.0.0.1",
  inboundSmtpPort: 0,
  inboundMaxMessageBytes: 0,
  dmMaxBodyChars: 2000,
  attachmentsDir: "",
  attachmentsMaxTotalBytes: 0,
  attachmentsRetentionDays: 30,
  mailRelayHost: "127.0.0.1",
  mailRelayPort: 0,
  mailRelayUser: undefined,
  mailRelayPass: undefined,
  mailFromAddress: "jay@mail.example.com",
  actorCacheTtlHours: 24,
  logLevel: "silent",
};

const remoteActorId = "https://misskey.example.com/users/jay";
const remoteKeyId = `${remoteActorId}#main-key`;

let dbPath: string;
let db: ReturnType<typeof openDatabase>;
let notesRepo: NotesRepo;
let remoteKeys: { publicKey: string; privateKey: string };

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apmail-inbox-flow-")), "test.sqlite");
  db = openDatabase(dbPath);
  notesRepo = createNotesRepo(db);

  remoteKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  notesRepo.insertNote({
    noteId: "note://dm-1",
    parentNoteId: null,
    senderEmail: "alice@example.com",
    subject: "Hello",
    emailMessageId: "<msg-1@example.com>",
    emailReferences: null,
    direction: "inbound_dm",
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("POST /users/:username/inbox — full signature-verify-to-email flow", () => {
  it("verifies the signature, resolves the thread, and calls sendReplyEmail", async () => {
    const stubActorCache: ActorCache = {
      resolvePublicKeyPem: vi.fn().mockResolvedValue(remoteKeys.publicKey),
      resolveInboxUrl: vi.fn().mockResolvedValue(`${remoteActorId}/inbox`),
    };
    const sendReplyEmail = vi.fn().mockResolvedValue(undefined);

    const app = buildServer(config, {
      publicKeyPem: "unused-in-this-test",
      config,
      actorCache: stubActorCache,
      notesRepo,
      privateKeyPem: "unused-in-this-test",
      keyId: "https://mail.example.com/users/jay#main-key",
      sendReplyEmail,
    });

    const body = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://misskey.example.com/notes/reply-1/activity",
      type: "Create",
      actor: remoteActorId,
      object: {
        id: "https://misskey.example.com/notes/reply-1",
        type: "Note",
        inReplyTo: "note://dm-1",
        content: "<p>Thanks for letting me know!</p>",
      },
    });

    const url = "https://mail.example.com/users/jay/inbox";
    const signed = signRequest({ privateKeyPem: remoteKeys.privateKey, keyId: remoteKeyId, method: "POST", url, body });

    const response = await app.inject({
      method: "POST",
      url: "/users/jay/inbox",
      headers: {
        host: signed.Host,
        date: signed.Date,
        digest: signed.Digest,
        signature: signed.Signature,
        "content-type": "application/activity+json",
      },
      payload: body,
    });

    expect(response.statusCode).toBe(202);
    expect(sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alice@example.com",
        subject: "Re: Hello",
        text: "Thanks for letting me know!",
        inReplyToMessageId: "<msg-1@example.com>",
      }),
    );

    await app.close();
  });

  it("rejects with 401 when the signature does not verify", async () => {
    const stubActorCache: ActorCache = {
      resolvePublicKeyPem: vi.fn().mockResolvedValue(remoteKeys.publicKey),
      resolveInboxUrl: vi.fn(),
    };
    const sendReplyEmail = vi.fn();

    const app = buildServer(config, {
      publicKeyPem: "unused",
      config,
      actorCache: stubActorCache,
      notesRepo,
      privateKeyPem: "unused",
      keyId: "https://mail.example.com/users/jay#main-key",
      sendReplyEmail,
    });

    const body = JSON.stringify({ type: "Create", actor: remoteActorId, object: { type: "Note", id: "x", inReplyTo: "note://dm-1" } });
    // Sign with a *different* (unrelated) keypair than the one resolvePublicKeyPem returns.
    const forgedKeys = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const signed = signRequest({
      privateKeyPem: forgedKeys.privateKey,
      keyId: remoteKeyId,
      method: "POST",
      url: "https://mail.example.com/users/jay/inbox",
      body,
    });

    const response = await app.inject({
      method: "POST",
      url: "/users/jay/inbox",
      headers: {
        host: signed.Host,
        date: signed.Date,
        digest: signed.Digest,
        signature: signed.Signature,
        "content-type": "application/activity+json",
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(sendReplyEmail).not.toHaveBeenCalled();

    await app.close();
  });

  it("never fetches the signer's actor document when keyId claims an actor other than ALLOWED_ACTOR_URI (SSRF guard)", async () => {
    const resolvePublicKeyPem = vi.fn().mockResolvedValue(remoteKeys.publicKey);
    const stubActorCache: ActorCache = { resolvePublicKeyPem, resolveInboxUrl: vi.fn() };
    const sendReplyEmail = vi.fn();

    const app = buildServer(config, {
      publicKeyPem: "unused",
      config,
      actorCache: stubActorCache,
      notesRepo,
      privateKeyPem: "unused",
      keyId: "https://mail.example.com/users/jay#main-key",
      sendReplyEmail,
    });

    const body = JSON.stringify({ type: "Create", actor: "https://attacker.example/actor", object: { type: "Note", id: "x", inReplyTo: "note://dm-1" } });
    // A validly-signed request, but the keyId's actor is attacker-controlled — e.g. a
    // cloud metadata URL — and must never reach actorCache.resolvePublicKeyPem.
    const maliciousKeyId = "http://169.254.169.254/latest/meta-data/#main-key";
    const signed = signRequest({
      privateKeyPem: remoteKeys.privateKey,
      keyId: maliciousKeyId,
      method: "POST",
      url: "https://mail.example.com/users/jay/inbox",
      body,
    });

    const response = await app.inject({
      method: "POST",
      url: "/users/jay/inbox",
      headers: {
        host: signed.Host,
        date: signed.Date,
        digest: signed.Digest,
        signature: signed.Signature,
        "content-type": "application/activity+json",
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(resolvePublicKeyPem).not.toHaveBeenCalled();
    expect(sendReplyEmail).not.toHaveBeenCalled();

    await app.close();
  });
});
