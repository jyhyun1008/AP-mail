-- One row per DM Note the bridge sent to Misskey (direction='inbound_dm', meaning
-- "an inbound email produced this DM"), or per reply Note the bridge received and
-- turned into an outbound email (direction='outbound_email_sent'). Together these let
-- thread-resolver.ts walk parent_note_id back to whichever ancestor row carries the
-- original sender_email/email_message_id.
CREATE TABLE IF NOT EXISTS notes (
  note_id             TEXT PRIMARY KEY,   -- the AP object id (URI) of the Note this row represents
  parent_note_id      TEXT,               -- inReplyTo target, if this Note is a reply; NULL for a thread root
  sender_email        TEXT,               -- original email "From" address (populated on the root row)
  subject             TEXT,               -- original email subject (populated on the root row)
  email_message_id    TEXT,               -- Message-ID header of the original inbound email (populated on the root row)
  email_references    TEXT,               -- References header chain of the original inbound email (populated on the root row)
  direction           TEXT NOT NULL CHECK (direction IN ('inbound_dm', 'outbound_email_sent')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes(parent_note_id);
CREATE INDEX IF NOT EXISTS idx_notes_email_message_id ON notes(email_message_id);

-- Cache of remote actors' public keys + inbox URLs, so we don't refetch WebFinger/the
-- actor document on every inbound signature verification or outbound delivery.
CREATE TABLE IF NOT EXISTS actor_key_cache (
  actor_uri           TEXT PRIMARY KEY,
  public_key_pem      TEXT NOT NULL,
  inbox_url           TEXT NOT NULL,
  fetched_at          TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at          TEXT NOT NULL
);
