# DNS, Postfix, and reverse proxy setup

Everything here is a manual, one-time step on your VPS/DNS provider — none of it is
something the bridge can do for you.

## 1. DNS

On the domain that will host the bridge (`BRIDGE_DOMAIN` — a dedicated subdomain, e.g.
`mail.example.com`, kept separate from your Misskey instance's own domain):

| Record | Value |
|---|---|
| `A`/`AAAA` | `mail.example.com` → your VPS IP (for HTTPS: WebFinger/actor/inbox/media) |
| `MX` | `mail.example.com` → `mail.example.com`, priority 10 (or a dedicated mail hostname) |
| `TXT` (SPF) | `v=spf1 mx ~all` (adjust if Postfix also relays through something else) |
| `TXT` (DKIM) | published once you've run `opendkim-genkey` — see step 2 |
| `TXT` (DMARC) | `_dmarc.mail.example.com` → e.g. `v=DMARC1; p=none; rua=mailto:you@wherever` |

Also set the VPS's **reverse DNS (PTR)** to resolve to the mail hostname, if your
provider allows it — this affects deliverability more than almost anything else.

**Expect outbound mail from a brand-new domain/IP to land in spam at Gmail/Outlook/etc.
at first**, regardless of correct SPF/DKIM/DMARC. This is normal cold-reputation
behavior, not a misconfiguration — it improves over weeks of legitimate, low-volume
sending. Already priced in given this is a from-scratch domain.

## 2. Postfix

Add the bridge's mail domain and route it to the bridge's inbound SMTP listener instead
of local mailbox delivery:

```
# /etc/postfix/main.cf
virtual_mailbox_domains = mail.example.com
transport_maps = hash:/etc/postfix/transport
```

```
# /etc/postfix/transport
mail.example.com   smtp:127.0.0.1:2525
```

```
postmap /etc/postfix/transport
systemctl reload postfix
```

Adjust `127.0.0.1:2525` to match `INBOUND_SMTP_HOST`/`INBOUND_SMTP_PORT` in `.env` — the
defaults match this example. Double-check `mail.example.com` isn't already claimed by an
existing `virtual_alias_maps`/catch-all entry that would intercept mail before the
transport rule applies.

**DKIM** (recommended, via `opendkim`):

```
opendkim-genkey -b 2048 -d mail.example.com -s mail -D /etc/opendkim/keys
# publish the resulting mail._domainkey.mail.example.com TXT record
# wire opendkim into Postfix's milter chain (opendkim's own docs cover this — it's a
# one-time systemwide Postfix config change, not specific to this bridge)
```

**Outbound submission** (the bridge relays *out* through Postfix too, for reply emails):
confirm `mynetworks` in `main.cf` includes `127.0.0.1/32` so Postfix accepts local
relaying without auth, or set `MAIL_RELAY_USER`/`MAIL_RELAY_PASS` in `.env` if you'd
rather require SMTP AUTH even from localhost.

## 3. Reverse proxy

Whatever already fronts your Misskey instance (nginx/Caddy/Traefik) needs a new
server block for `mail.example.com`, forwarding to the bridge's HTTP port
(`HTTP_PORT`, default 8080) with TLS (Let's Encrypt, same as your Misskey setup).
No path-based routing is needed — every route (`/.well-known/webfinger`, `/users/...`,
`/media/...`, `/healthz`) forwards straightforwardly. Example (nginx):

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

Make sure `Host` is passed through unmodified — the bridge's actor IDs are derived from
`BRIDGE_DOMAIN`, and they need to match what's actually reachable at that host.

Optional but sensible for an internet-facing endpoint: add a basic `limit_req` zone in
front of `/users/`/`/inbox`/`/.well-known/` if you want request-rate limiting — the
bridge itself doesn't rate-limit (personal, low-traffic by design), so this is better
handled at the proxy layer if you want it at all.

## 4. Misskey-side follow/DM-acceptance check

See [misskey-followup-caveat.md](./misskey-followup-caveat.md) — this is the one step
that can only be verified empirically, after everything above is live.

## Docker note

If deploying via `docker/docker-compose.snippet.yml` (`network_mode: host`), all of the
above is unchanged — `127.0.0.1` inside the container is the same as the host's, so
Postfix's `transport_maps` and the bridge's `MAIL_RELAY_HOST` both keep working exactly
as described.
