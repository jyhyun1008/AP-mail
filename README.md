# apmail

A personal mail ↔ ActivityPub (Misskey) DM bridge.

Send an email to `<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>` and it arrives as a direct message
on your Misskey account, from a small custom-built bot actor
(`@<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>`). Reply to that DM in Misskey and the reply is sent
back to the original sender's email address, correctly threaded
(`In-Reply-To`/`References`).

Single-user by design — see [docs/architecture.md](./docs/architecture.md) for how it
works and why.

## Status

All three functional milestones are done and tested:

- **M1** — AP actor identity, WebFinger, HTTP Signatures
- **M2** — inbound email → DM, with attachment relay
- **M3** — Misskey reply → outbound email, with multi-hop thread resolution
- **M4** (this) — hardening, Docker packaging, docs

## Quickstart (local dev)

```bash
npm install
cp .env.example .env   # fill in BRIDGE_DOMAIN, BRIDGE_USERNAME, ALLOWED_ACTOR_URI at minimum
npm run dev             # tsx watch, no build step
```

```bash
npm test          # vitest — 42 unit + integration tests
npm run typecheck  # tsc over src/ + test/ + scripts/ (see tsconfig.typecheck.json)
npm run build      # tsc -> dist/, plus copies schema.sql alongside it
```

`npm run gen-keys` pre-generates the actor RSA keypair without booting the full server.
`npm run smoke:send-note` sends a real test DM to your configured `ALLOWED_ACTOR_URI` —
useful right after deploying (see
[docs/misskey-followup-caveat.md](./docs/misskey-followup-caveat.md)).

## Deploying

This needs a domain you control (for the bridge's own subdomain), a VPS, and a
self-hosted Postfix instance — none of which the bridge sets up for you. Once those
exist:

1. [docs/dns-and-mail-setup.md](./docs/dns-and-mail-setup.md) — DNS records, Postfix
   config, reverse proxy.
2. `docker/docker-compose.snippet.yml` — merge into your existing Misskey compose setup
   (runs with `network_mode: host`; the doc comment there explains why).
3. [docs/misskey-followup-caveat.md](./docs/misskey-followup-caveat.md) — the one thing
   that has to be verified empirically after deploy, not guaranteed by the code.
4. [docs/runbook.md](./docs/runbook.md) — redeploying, logs, key rotation, inspecting
   the DB, attachment retention.

```bash
docker compose -f docker-compose.yml -f docker/docker-compose.snippet.yml build apmail
docker compose -f docker-compose.yml -f docker/docker-compose.snippet.yml up -d apmail
```

(or copy the service block directly into your existing compose file — either works.)

## Configuration

All configuration is environment variables — see [.env.example](./.env.example) for the
full list with defaults and comments. `src/config.ts` fails fast at boot if a required
one (`BRIDGE_DOMAIN`, `BRIDGE_USERNAME`, `ALLOWED_ACTOR_URI`) is missing.

## What's deliberately out of scope

- Multi-user / multi-recipient support — `ALLOWED_ACTOR_URI` is a single hardcoded
  allowlist entry, by design (see [docs/architecture.md](./docs/architecture.md)).
- Relaying attachments larger than `ATTACHMENTS_MAX_TOTAL_BYTES` (default 8MB/email) —
  named in the DM text instead of being saved/linked.
- Retrying failed AP deliveries — a failed delivery is logged, not retried.
- In-process rate limiting — recommended at the reverse proxy layer instead
  (see dns-and-mail-setup.md), given the low-traffic single-user threat model.
