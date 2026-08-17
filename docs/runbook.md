# Runbook

Operational notes for running apmail day-to-day. Assumes the Docker deployment
(`docker/docker-compose.snippet.yml`); bare-metal equivalents are noted where they
differ.

## Redeploying after a code change

```bash
git pull
docker compose build apmail
docker compose up -d apmail
```

The actor keypair and SQLite DB live in named volumes (`apmail-keys`, `apmail-db`,
`apmail-attachments`) — they survive container recreation. Nothing in the redeploy path
touches them.

Bare metal: `npm ci && npm run build && systemctl restart apmail` (or however you've
wrapped `node dist/index.js` as a service).

## Logs

```bash
docker compose logs -f apmail
```

Structured JSON via `pino` — pipe through `| npx pino-pretty` for readability, or set
`LOG_LEVEL=debug` in `.env` temporarily for more detail (restart to apply).

## Rotating the actor keypair

Not something to do casually — every remote server that has ever fetched the actor
document has your *old* public key cached, and Misskey/Mastodon-side re-fetch behavior
for actor updates varies. If you do need to rotate (e.g. suspected key compromise):

```bash
docker compose exec apmail sh -c "rm /data/keys/actor-*.pem"
docker compose restart apmail   # generates a fresh keypair on next boot
```

Your Misskey account will likely need to re-follow the bot afterward (see
[misskey-followup-caveat.md](./misskey-followup-caveat.md)) since the old
Follow relationship was tied to the old key's actor document caching on Misskey's side.

## Inspecting the SQLite DB

```bash
docker compose cp apmail:/data/db/apmail.sqlite ./apmail.sqlite
sqlite3 apmail.sqlite "SELECT note_id, sender_email, subject, direction, created_at FROM notes ORDER BY created_at DESC LIMIT 20;"
```

Or open a shell directly in the running container: `docker compose exec apmail sh` (note:
the runtime image doesn't ship a `sqlite3` CLI — copy the file out as above, or add
`sqlite3` to the Dockerfile's runtime stage if you want it in-container).

## Recovering a "stuck" thread mapping

If a reply in Misskey isn't producing an outbound email, the bridge logs
`"could not resolve reply to a known email thread; dropping"` — meaning the note you
replied to (or the note *it* replied to, recursively) isn't in the `notes` table. This
happens if:

- You're replying to a Misskey note that didn't originate from this bridge.
- The original DM's row was somehow deleted (nothing in the codebase does this — the
  `notes` table is kept indefinitely by design — so this would mean manual DB surgery).

There's no repair mechanism beyond manually `INSERT`ing a corrective row into `notes`
with the right `note_id`/`parent_note_id`/`sender_email`/`email_message_id`, matched by
hand against the Misskey note IDs involved. Not expected to come up in normal use.

## Attachment retention

Attachment binaries are purged automatically once a day
(`ATTACHMENTS_RETENTION_DAYS`, default 30) — see `src/media/attachment-store.ts`'s
`purgeExpiredAttachments`, wired into `src/index.ts`'s `setInterval`. The `notes` table's
metadata (sender/subject/Message-ID) is **not** subject to this and is kept indefinitely,
by explicit choice — an old attachment link in a long-dead thread will 404 once purged,
but the thread's ability to route further replies is unaffected (attachments aren't part
of thread resolution).

## Health check

`GET /healthz` → `{"status":"ok"}` once the HTTP server is up. Doesn't currently probe
the DB or SMTP listener — a 200 confirms the process is alive and routable, not that
every subsystem is healthy. `docker compose ps` shows the Docker-level healthcheck
status (same endpoint, via the `HEALTHCHECK` in `docker/Dockerfile`).
