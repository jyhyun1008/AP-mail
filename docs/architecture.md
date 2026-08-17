# Architecture

apmail is a personal, single-user bridge between email and a Misskey account, built
around one custom-implemented ActivityPub actor (the "bot"). It is **not** a Misskey
account — it's a small standalone AP server that only ever talks to one other actor
(your real Misskey account, `ALLOWED_ACTOR_URI`).

## Identity

- The bot's AP handle and its inbound email address are the *same string*, by design:
  `<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>` is both `mailto:` and, with a leading `@`,
  the fediverse handle (`@jay@mail.example.com`).
- It lives on its own subdomain (`BRIDGE_DOMAIN`, e.g. `mail.example.com`) specifically
  so its WebFinger/actor routes never collide with your Misskey instance's own routes on
  its domain.
- Its RSA-4096 keypair is generated once on first boot and persisted to disk
  (`ACTOR_PRIVATE_KEY_PATH`/`ACTOR_PUBLIC_KEY_PATH`) — see `src/actor/keys.ts`.

## Inbound flow: email → DM

```
sender ──SMTP──▶ Postfix ──SMTP (transport_maps)──▶ src/mail/smtp-listener.ts
                                                            │ parse (src/mail/parse.ts)
                                                            ▼
                                          src/bridge/email-to-dm.ts
                                            ├─ relay or skip attachments (src/bridge/attachment-relay.ts)
                                            ├─ compose + sanitize DM text
                                            ├─ build Create{Note} (src/bridge/outbound-note.ts)
                                            └─ sign + POST to your Misskey inbox (src/bridge/deliver-note.ts)
                                                            │
                                                            ▼
                                          notes table: this Note's id ↔ sender email
```

The Note is addressed `to: [ALLOWED_ACTOR_URI]` only — no `cc: Public` — which is what
makes Misskey render it as a DM rather than a public post.

## Outbound flow: Misskey reply → email

```
you reply in Misskey ──Create{Note}──▶ POST /users/:username/inbox (src/routes/inbox.route.ts)
                                              │ verify HTTP Signature (src/signatures/verify.ts)
                                              │ — keyId's actor must equal ALLOWED_ACTOR_URI
                                              │   *before* any network fetch happens (SSRF guard)
                                              ▼
                                     src/bridge/inbound-activity.ts
                                       ├─ actor/signer cross-check, allowlist check
                                       └─ Create{Note} → src/bridge/dm-reply-to-email.ts
                                                            │ resolve thread (src/bridge/thread-resolver.ts,
                                                            │   WITH RECURSIVE walk up parent_note_id)
                                                            ▼
                                                     src/mail/send.ts → Postfix → original sender
```

## Data kept

- `notes` table (SQLite, `src/store/schema.sql`): one row per Note in either direction.
  Root rows (from an inbound email) carry `sender_email`/`subject`/`email_message_id`/
  `email_references`. Reply rows carry only `note_id`/`parent_note_id` and are looked up
  recursively to find their root. **No email or DM body text is ever stored** — kept
  indefinitely by explicit choice, since it's metadata-only.
- `actor_key_cache` table: TTL cache of the one allowed actor's public key + inbox URL.
- Attachments (if relayed): raw files under `ATTACHMENTS_DIR`, one UUID directory per
  file, purged after `ATTACHMENTS_RETENTION_DAYS` (default 30) — independent of the
  `notes` table's indefinite retention.

## Why not just use Mastodon/Misskey's own API for the bot side?

The bot identity was deliberately built as a raw AP actor rather than a second Misskey
account, per how this was scoped: registering a real account still means administering
it through Misskey (bot flags, API tokens, following state) for something that only ever
needs to speak two activity types (`Create{Note}` out, `Create{Note}`/`Follow` in). A
~600-line hand-rolled actor turned out to be less surface area than integrating with a
full Misskey account's lifecycle for a single-purpose relay.
