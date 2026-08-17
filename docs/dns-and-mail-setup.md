# DNS, Postfix, and reverse proxy setup

Everything here is a manual, one-time step on whatever server(s) you choose — none of it
is something the bridge can do for you.

**Note on topology**: this bridge doesn't need to run anywhere near your Misskey
instance — the two only ever talk over plain HTTPS federation (WebFinger + signed
activities), exactly like any two unrelated ActivityPub servers. The only thing that
does need to be reachable is Postfix, wherever you decide to put it (same host as the
bridge, or a separate one) — both are covered below.

## 1. DNS

On the domain that will host the bridge (`BRIDGE_DOMAIN` — a dedicated subdomain, e.g.
`mail.example.com`; doesn't need to relate to your Misskey instance's domain at all):

| Record | Value |
|---|---|
| `A`/`AAAA` | `mail.example.com` → the bridge's server IP (for HTTPS: WebFinger/actor/inbox/media) |
| `MX` | `mail.example.com` → `mail.example.com`, priority 10 (or a dedicated mail hostname) |
| `TXT` (SPF) | `v=spf1 mx ~all` (adjust if Postfix also relays through something else) |
| `TXT` (DKIM) | published once you've run `opendkim-genkey` — see step 2 |
| `TXT` (DMARC) | `_dmarc.mail.example.com` → e.g. `v=DMARC1; p=none; rua=mailto:you@wherever` |

Also set the mail server's **reverse DNS (PTR)** to resolve to the mail hostname, if
your provider allows it — this affects deliverability more than almost anything else.

**Expect outbound mail from a brand-new domain/IP to land in spam at Gmail/Outlook/etc.
at first**, regardless of correct SPF/DKIM/DMARC. This is normal cold-reputation
behavior, not a misconfiguration — it improves over weeks of legitimate, low-volume
sending. Already priced in given this is a from-scratch domain.

## 2. Postfix

Where Postfix runs changes a couple of values below but not the shape of the config.

**Inbound** — route the bridge's mail domain to its inbound SMTP listener instead of
local mailbox delivery:

```
# /etc/postfix/main.cf
virtual_mailbox_domains = mail.example.com
transport_maps = hash:/etc/postfix/transport
```

```
# /etc/postfix/transport
mail.example.com   smtp:<bridge-host>:<INBOUND_SMTP_PORT>
```

```
postmap /etc/postfix/transport
systemctl reload postfix
```

- **Postfix on the same host as the bridge**: `<bridge-host>` = `127.0.0.1`,
  `<INBOUND_SMTP_PORT>` defaults to `2525` — matches `.env`'s defaults directly.
- **Postfix on a different host**: `<bridge-host>` = the bridge's real
  hostname/IP, and the bridge's Docker deployment needs that port actually published to
  the network (see the Docker section below) rather than bound to `127.0.0.1` only —
  firewall it to just this Postfix server's IP rather than leaving it open.

Double-check `mail.example.com` isn't already claimed by an existing
`virtual_alias_maps`/catch-all entry that would intercept mail before the transport rule
applies.

**DKIM** (recommended, via `opendkim`):

```
opendkim-genkey -b 2048 -d mail.example.com -s mail -D /etc/opendkim/keys
# publish the resulting mail._domainkey.mail.example.com TXT record
# wire opendkim into Postfix's milter chain (opendkim's own docs cover this — it's a
# one-time systemwide Postfix config change, not specific to this bridge)
```

**Outbound submission** (the bridge relays *out* through Postfix too, for reply emails —
`MAIL_RELAY_HOST`/`MAIL_RELAY_PORT` in `.env`):

- **Postfix on the same host**: confirm `mynetworks` in `main.cf` includes
  `127.0.0.1/32` (bare metal) so Postfix accepts local relaying without auth. Docker
  deployments should use `MAIL_RELAY_HOST=host.docker.internal` instead of `127.0.0.1`
  — see the Docker section.
- **Postfix on a different host**: "trust localhost" doesn't apply across a network —
  set `MAIL_RELAY_USER`/`MAIL_RELAY_PASS` in `.env` and configure Postfix's submission
  port (587) to require SMTP AUTH.

## 3. Reverse proxy

The bridge needs a reverse proxy in front of it for TLS — this can be a proxy you
already run for something else (Misskey or otherwise) or a dedicated one, doesn't
matter. New server block for `mail.example.com`, forwarding to the bridge's HTTP port
(`HTTP_PORT`, default 8080). No path-based routing is needed — every route
(`/.well-known/webfinger`, `/users/...`, `/media/...`, `/healthz`) forwards
straightforwardly. Example (nginx):

```nginx
server {
    listen 443 ssl http2;
    server_name mail.example.com;

    ssl_certificate     /etc/letsencrypt/live/mail.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mail.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If the proxy is on a different host than the bridge, point `proxy_pass` at the bridge's
real address instead of `127.0.0.1`, and make sure the bridge's HTTP port is actually
reachable from there (see the Docker section's port-publishing notes).

Make sure `Host` is passed through unmodified — the bridge's actor IDs are derived from
`BRIDGE_DOMAIN`, and they need to match what's actually reachable at that host.

Optional but sensible for an internet-facing endpoint: add a basic `limit_req` zone in
front of `/users/`/`/inbox`/`/.well-known/` if you want request-rate limiting — the
bridge itself doesn't rate-limit (personal, low-traffic by design), so this is better
handled at the proxy layer if you want it at all.

## 4. Misskey-side follow/DM-acceptance check

See [misskey-followup-caveat.md](./misskey-followup-caveat.md) — this is the one step
that can only be verified empirically, after everything above is live.

## Docker: same-host vs. remote Postfix

`docker/docker-compose.yml` runs the bridge on a normal Docker bridge network (not
`network_mode: host`), specifically so it doesn't assume anything about where Postfix
ends up:

- **Postfix on the same host, outside Docker** (the common case): the compose file's
  default port bindings (`127.0.0.1:...`) already work — Postfix reaches the bridge at
  `127.0.0.1:<INBOUND_SMTP_PORT>` exactly as in the bare-metal instructions above, and
  the bridge reaches Postfix via `MAIL_RELAY_HOST=host.docker.internal` (the compose
  file's `extra_hosts` entry makes that resolve correctly on Linux, where Docker doesn't
  do this automatically the way Docker Desktop does).
- **Postfix on a different host entirely**: edit the `ports:` entries in
  `docker/docker-compose.yml` to drop the `127.0.0.1:` prefix (so the port is reachable
  from outside this host — firewall it to just that Postfix server's IP), and set
  `MAIL_RELAY_HOST`/`MAIL_RELAY_USER`/`MAIL_RELAY_PASS` in `.env` to that host's real
  address and SMTP AUTH credentials.

Either way, `INBOUND_SMTP_HOST` doesn't need to be touched in `.env` — the compose file
overrides it to `0.0.0.0` itself (see its comments), which is what makes Docker's port
publishing reach the process at all.
